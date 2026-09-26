import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { resolvePtyShell } from './pty.mjs';

const MAX_NOTE = 4000;
const MAX_CONTEXT_NOTES = 24;
const MAX_COMMAND = 4096;
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.wav', '.mp3', '.ogg', '.mp4', '.webm', '.glb', '.gltf']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.omniforge-lab']);
const UNREADABLE_DIR = new Set(['EACCES', 'EPERM', 'ENOENT', 'EBUSY', 'ENOTDIR']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function requiredText(value, label, limit = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label} inválido`);
  return value.trim();
}

function initialData() {
  return { schema: 1, projects: [], sessions: [], tasks: [], notes: [], memoryRevision: 0, layout: { split: 50 } };
}

const compatible = data => data?.schema === 1 && ['projects', 'sessions', 'tasks', 'notes'].every(key => Array.isArray(data[key]));

function writeDurable(file, data) {
  const fd = fs.openSync(file, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function noteVersion(note, operation) {
  const { revision, mutationSequence, text, source, updatedAt, archivedAt } = note;
  return { revision, mutationSequence, text, source, updatedAt, archivedAt, operation };
}

function currentNote(note) {
  const { history, ...current } = note;
  return structuredClone(current);
}

export class WorkspaceStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'state.json');
    this.backupFile = path.join(this.dataDir, 'state.json.bak');
    this.lockFile = path.join(this.dataDir, 'state.lock');
    this.lockNonce = randomUUID();
    this.uncertainSessions = new Set();
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.acquireLock();
    try {
      this.data = fs.existsSync(this.file) ? this.readState() : initialData();
      if (!compatible(this.data)) fail('Estado local incompatível', 500);
      this.durableData = structuredClone(this.data);
      // A layout may be restored, but a shell/process attempt cannot be resumed by assumption.
      let changed = !!this.recovery;
      for (const task of this.data.tasks) if (task.revision === undefined) { task.revision = 1; changed = true; }
      for (const note of this.data.notes) {
        if (note.mutationSequence === undefined) {
          // Historical cross-note ordering was not recorded; do not invent it.
          note.mutationSequence = 0;
          changed = true;
        }
        if (note.revision === undefined) {
          Object.assign(note, { revision: 1, updatedAt: note.createdAt, archivedAt: null });
          note.history = [noteVersion(note, 'create')];
          changed = true;
        }
      }
      if (this.data.memoryRevision === undefined) {
        this.data.memoryRevision = this.data.notes.reduce((total, note) => total + note.revision, 0);
        changed = true;
      }
      if (!Number.isSafeInteger(this.data.memoryRevision) || this.data.memoryRevision < 0) fail('Revisão de memória inválida', 500);
      for (const session of this.data.sessions) {
        if (['running', 'starting', 'stopping'].includes(session.status)) { session.status = 'interrupted'; changed = true; }
      }
      if (changed || !fs.existsSync(this.file)) this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  readState() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) {
      // A torn or zero-filled write parses as garbage; only then is the last good copy trusted.
      if (!(error instanceof SyntaxError)) throw error;
      let backup;
      try { backup = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')); } catch {}
      if (!compatible(backup)) fail(`Estado local ilegível e sem backup válido; inspecione ${this.file}`, 500);
      const preserved = path.join(this.dataDir, `state.json.corrupt-${randomUUID()}`);
      fs.copyFileSync(this.file, preserved);
      this.recovery = { backup: this.backupFile, preserved };
      console.warn(`OmniForge: state.json ilegível foi preservado em ${preserved}; estado restaurado de ${this.backupFile}. A última alteração pode ter sido perdida.`);
      return backup;
    }
  }

  acquireLock() {
    try {
      this.lockFd = fs.openSync(this.lockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize recovery. Without this guard, a second reader of the stale
      // lock could rename the first recoverer's newly created live lock.
      const recoveryFile = path.join(this.dataDir, 'state.recovery.lock');
      let recoveryFd;
      try { recoveryFd = fs.openSync(recoveryFile, 'wx', 0o600); }
      catch (guardError) {
        if (guardError.code === 'EEXIST') fail('Recuperação local em andamento ou incerta; inspecione o lock', 409);
        throw guardError;
      }
      try {
        let owner;
        try { owner = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); }
        catch { fail('Estado local bloqueado por outra instância ou lock incerto', 409); }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) fail('Lock local inválido; inspecione antes de recuperar', 409);
        // EPERM (elevated or other-user owner) fails closed like a live owner: treating it as
        // stale would let a second writer in beside an elevated Lab.
        // ponytail: a reused PID also reads as alive; verify the owner's image/start time if false 409s recur.
        let alive = true;
        try { process.kill(owner.pid, 0); }
        catch (check) { if (check.code === 'ESRCH') alive = false; else if (check.code !== 'EPERM') throw check; }
        if (alive) fail(`Outra instância OmniForge usa estes dados (PID ${owner.pid}). Se nenhum Lab estiver aberto, renomeie ${this.lockFile} e inicie de novo.`, 409);
        // Preserve the exact dead owner's lock. A crash during recovery leaves
        // the recovery guard visible and fails closed on the next startup.
        fs.renameSync(this.lockFile, path.join(this.dataDir, `state.lock.stale-${randomUUID()}`));
        this.lockFd = fs.openSync(this.lockFile, 'wx', 0o600);
      } finally {
        fs.closeSync(recoveryFd);
        fs.unlinkSync(recoveryFile);
      }
    }
    fs.writeSync(this.lockFd, JSON.stringify({ pid: process.pid, nonce: this.lockNonce }));
    fs.fsyncSync(this.lockFd);
  }

  close() {
    if (this.lockFd === undefined) return;
    try {
      const owner = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      if (owner.nonce === this.lockNonce) fs.unlinkSync(this.lockFile);
    } finally {
      fs.closeSync(this.lockFd);
      this.lockFd = undefined;
    }
  }

  save() {
    if (this.lockFd === undefined) fail('Estado local sem lock exclusivo', 409);
    const temp = path.join(this.dataDir, `state-${randomUUID()}.tmp`);
    try {
      // The new state is on disk before it replaces state.json; the backup is the last committed state.
      // ponytail: full-state backup per save; move to a journal if state.json grows past a few MB.
      writeDurable(temp, this.data);
      if (fs.existsSync(this.file)) writeDurable(this.backupFile, this.durableData);
      fs.renameSync(temp, this.file);
      this.durableData = structuredClone(this.data);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      this.data = structuredClone(this.durableData);
      throw error;
    }
  }

  snapshot() {
    return structuredClone(this.data);
  }

  addProject({ name, root }) {
    name = requiredText(name, 'Nome do projeto');
    root = requiredText(root, 'Caminho do projeto', 2048);
    const absolute = path.resolve(root);
    if (!path.isAbsolute(root) || !fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) fail('O projeto deve apontar para uma pasta local existente');
    const canonical = fs.realpathSync.native(absolute);
    const key = value => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
    const match = this.data.projects.find(project => key(project.root) === key(canonical));
    if (match) return match;
    const project = { id: randomUUID(), name, root: canonical, createdAt: new Date().toISOString() };
    this.data.projects.push(project);
    this.save();
    return project;
  }

  project(id) {
    const project = this.data.projects.find(item => item.id === id);
    if (!project) fail('Projeto não encontrado', 404);
    return project;
  }

  addSession({ projectId, name }) {
    const project = this.project(projectId);
    name = requiredText(name, 'Nome da sessão');
    if (this.data.sessions.some(item => item.projectId === project.id && (['stopping', 'interrupted'].includes(item.status) || this.uncertainSessions.has(item.id)))) fail('Há uma sessão incerta neste projeto; verifique o processo antes de continuar', 409);
    const session = { id: randomUUID(), projectId: project.id, name, host: 'local-pty', status: 'starting', createdAt: new Date().toISOString() };
    this.data.sessions.push(session);
    this.save();
    return session;
  }

  session(id) {
    const session = this.data.sessions.find(item => item.id === id);
    if (!session) fail('Sessão não encontrada', 404);
    return session;
  }

  setSessionStatus(id, status, pid = undefined) {
    const session = this.session(id);
    session.status = status;
    if (pid !== undefined) session.pid = pid;
    this.save();
  }

  flagUncertainSession(id) {
    this.uncertainSessions.add(id);
    this.session(id).status = 'interrupted';
    try { this.save(); }
    catch { this.session(id).status = 'interrupted'; }
  }

  acknowledgeInterruptedSession(id, verification) {
    const session = this.session(id);
    if (session.status !== 'interrupted') fail('Sessão não está interrompida', 409);
    verification = requiredText(verification, 'Verificação do operador', 500);
    session.status = 'stopped';
    session.recovery = { verification, acknowledgedAt: new Date().toISOString() };
    this.save();
    this.uncertainSessions.delete(id);
    return session;
  }

  addTask({ projectId, title, details = null, dependsOn = [] }) {
    this.project(projectId);
    title = requiredText(title, 'Título da tarefa', 240);
    if (details !== null) details = requiredText(details, 'Detalhes da tarefa', MAX_NOTE);
    if (!Array.isArray(dependsOn) || dependsOn.length > 20 || new Set(dependsOn).size !== dependsOn.length) fail('Dependências inválidas');
    for (const id of dependsOn) {
      const prerequisite = this.task(id);
      if (prerequisite.projectId !== projectId) fail('Dependência pertence a outro projeto');
    }
    const task = { id: randomUUID(), projectId, title, details, dependsOn, status: 'open', revision: 1, createdAt: new Date().toISOString() };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  task(id) {
    const task = this.data.tasks.find(item => item.id === id);
    if (!task) fail('Tarefa não encontrada', 404);
    return task;
  }

  setTaskStatus(id, status, expectedRevision) {
    const task = this.task(id);
    if (!['open', 'running', 'done', 'blocked'].includes(status)) fail('Estado de tarefa inválido');
    if (status === 'done' && task.dependsOn.some(dependency => this.task(dependency).status !== 'done')) fail('Dependências não concluídas', 409);
    if (task.status === 'done' && status !== 'done' && this.data.tasks.some(dependent => dependent.status === 'done' && dependent.dependsOn.includes(id))) fail('Tarefa concluída tem dependentes concluídos', 409);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('Revisão esperada inválida');
    if (expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar', 409);
    const leavingBlocked = task.status === 'blocked' && status !== 'blocked';
    task.status = status;
    task.revision++;
    delete task.blockedBy;
    // Deterministic replan: a blocked prerequisite blocks every open/running dependent, and unblocking it
    // restores only the dependents it blocked. Tasks blocked by hand keep their state.
    const dependents = root => this.data.tasks.filter(item => item.dependsOn.includes(root));
    if (status === 'blocked') {
      for (const pending = dependents(id); pending.length;) {
        const next = pending.shift();
        if (!['open', 'running'].includes(next.status)) continue;
        Object.assign(next, { status: 'blocked', blockedBy: id, revision: next.revision + 1 });
        pending.push(...dependents(next.id));
      }
    } else if (leavingBlocked) {
      for (const next of this.data.tasks.filter(item => item.blockedBy === id)) {
        Object.assign(next, { status: 'open', revision: next.revision + 1 });
        delete next.blockedBy;
      }
    }
    this.save();
    return task;
  }

  assignTask(id, { sessionId = null, worktree = null, expectedRevision } = {}) {
    const task = this.task(id);
    if (sessionId !== null && this.session(sessionId).projectId !== task.projectId) fail('A sessão pertence a outro projeto');
    if (worktree !== null) {
      worktree = requiredText(worktree, 'Worktree', 1024);
      if (!path.isAbsolute(worktree)) fail('A worktree deve ser um caminho absoluto');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar', 409);
    Object.assign(task, { sessionId, worktree, revision: task.revision + 1 });
    this.save();
    return task;
  }

  handoffTask(id, { toHost, summary, expectedRevision } = {}) {
    const task = this.task(id);
    if (!['claude', 'codex'].includes(toHost)) fail('Host de destino inválido');
    summary = requiredText(summary, 'Resumo do handoff', 500);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar', 409);
    // ponytail: the last 10 handoffs ride in state events; keep full transcripts in session notes.
    const entry = { to: toHost, summary, fromSession: task.sessionId ?? null, worktree: task.worktree ?? null, at: new Date().toISOString() };
    Object.assign(task, { handoffs: [...(task.handoffs ?? []), entry].slice(-10), revision: task.revision + 1 });
    this.save();
    return task;
  }

  memoryBinding({ scope, projectId = null, sessionId = null }) {
    if (!['global', 'project', 'session'].includes(scope)) fail('Escopo de memória inválido');
    if (scope === 'global' && (projectId !== null || sessionId !== null) || scope === 'project' && sessionId !== null) fail('Escopo de memória e seleção não coincidem');
    if (scope !== 'global') this.project(projectId);
    if (scope === 'session') {
      const session = this.session(sessionId);
      if (session.projectId !== projectId) fail('Sessão e projeto não coincidem');
    }
    return { scope, projectId, sessionId };
  }

  addNote({ scope, projectId, sessionId, source, text }) {
    const binding = this.memoryBinding({ scope, projectId, sessionId });
    text = requiredText(text, 'Texto da memória', MAX_NOTE);
    source = requiredText(source, 'Fonte da memória', 300);
    const now = new Date().toISOString();
    const note = { id: randomUUID(), ...binding, source, text, createdAt: now, updatedAt: now, revision: 1, mutationSequence: this.data.memoryRevision + 1, archivedAt: null };
    note.history = [noteVersion(note, 'create')];
    this.data.notes.push(note);
    this.data.memoryRevision++;
    this.save();
    return currentNote(note);
  }

  boundNote(id, selection) {
    const binding = this.memoryBinding(selection);
    const note = this.data.notes.find(item => item.id === id && item.scope === binding.scope && item.projectId === binding.projectId && item.sessionId === binding.sessionId);
    if (!note) fail('Memória não encontrada neste escopo', 404);
    return note;
  }

  updateNote(id, input, archive = false) {
    const note = this.boundNote(id, input);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Revisão esperada inválida');
    if (input.expectedRevision !== note.revision) fail('Memória alterada; recarregue antes de salvar', 409);
    if (note.archivedAt) fail('Memória arquivada não pode ser alterada', 409);
    const source = requiredText(input.source, 'Fonte da memória', 300);
    const text = archive ? note.text : requiredText(input.text, 'Texto da memória', MAX_NOTE);
    const now = new Date().toISOString();
    Object.assign(note, { source, text, updatedAt: now, revision: note.revision + 1, mutationSequence: this.data.memoryRevision + 1, archivedAt: archive ? now : null });
    note.history.push(noteVersion(note, archive ? 'archive' : 'update'));
    this.data.memoryRevision++;
    this.save();
    return currentNote(note);
  }

  archiveNote(id, input) {
    return this.updateNote(id, input, true);
  }

  noteHistory(id, selection) {
    return structuredClone(this.boundNote(id, selection).history);
  }

  noteHistoryPage(id, selection, { offset = 0, limit = 20 } = {}) {
    const note = this.boundNote(id, selection);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('Página de histórico inválida');
    return { noteId: id, offset, limit, total: note.history.length, hasMore: offset + limit < note.history.length,
      history: structuredClone(note.history.slice(offset, offset + limit)) };
  }

  notesFor({ projectId = null, sessionId = null, includeArchived = false } = {}) {
    if (projectId !== null) this.project(projectId);
    if (sessionId !== null && this.session(sessionId).projectId !== projectId) fail('Sessão e projeto não coincidem');
    return this.data.notes.filter(note => (includeArchived || !note.archivedAt) &&
      (note.scope === 'global' || note.scope === 'project' && note.projectId === projectId ||
       note.scope === 'session' && note.projectId === projectId && note.sessionId === sessionId)).map(currentNote);
  }

  contextBriefFor(sessionId, limit = 4000, projectId = undefined) {
    const session = this.session(sessionId);
    if (projectId !== undefined && projectId !== session.projectId) fail('Sessão e projeto não coincidem');
    const notes = this.notesFor({ projectId: session.projectId, sessionId });
    // New committed mutations outrank legacy records even when timestamps tie
    // or the clock moves backwards. Stable timestamp order is the legacy fallback.
    notes.sort((a, b) => (a.mutationSequence ?? 0) - (b.mutationSequence ?? 0) ||
      (a.updatedAt ?? a.createdAt).localeCompare(b.updatedAt ?? b.createdAt));
    const boundedLimit = Number.isInteger(limit) ? Math.max(128, Math.min(limit, 65536)) : 4000;
    const selected = [];
    let truncated = false;
    const fits = note => JSON.stringify({ notes: [...selected, note], truncated: false, limit: boundedLimit }).length <= boundedLimit;
    for (let index = notes.length - 1; index >= 0; index--) {
      const note = notes[index];
      if (selected.length >= MAX_CONTEXT_NOTES) { truncated = true; break; }
      if (fits(note)) { selected.push(note); continue; }
      let low = 0;
      let high = note.text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits({ ...note, text: note.text.slice(0, middle) })) low = middle;
        else high = middle - 1;
      }
      if (low > 0) selected.push({ ...note, text: note.text.slice(0, low) });
      truncated = true;
      break;
    }
    return { notes: selected.reverse(), truncated, limit: boundedLimit };
  }

  contextFor(sessionId, limit = 4000) {
    return this.contextBriefFor(sessionId, limit).notes;
  }

  setLayout(split) {
    if (!Number.isInteger(split) || split < 25 || split > 75) fail('Divisão de tela inválida');
    this.data.layout.split = split;
    this.save();
    return this.data.layout;
  }
}

export class ShellCoordinator extends EventEmitter {
  constructor(store, { shell, spawnProcess = spawn } = {}) {
    super();
    this.store = store;
    this.shell = shell;
    this.spawnProcess = spawnProcess;
    this.processes = new Map();
    this.sealed = false;
  }

  start(sessionId) {
    if (this.processes.has(sessionId)) fail('Sessão já iniciada');
    const session = this.store.session(sessionId);
    const project = this.store.project(session.projectId);
    const shell = this.shell ?? resolvePtyShell();
    const args = process.platform === 'win32' ? (path.basename(shell).toLowerCase() === 'cmd.exe' ? ['/Q', '/K'] : ['-NoLogo', '-NoProfile', '-Command', '-']) : [];
    const child = this.spawnProcess(shell, args, { cwd: project.root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, OMNIFORGE_PROJECT_ID: project.id, OMNIFORGE_SESSION_ID: session.id } });
    let launchFailed = false;
    child.on('error', error => {
      launchFailed = true;
      if (!this.sealed) this.store.setSessionStatus(sessionId, 'interrupted');
      this.emit('terminal', { sessionId, stream: 'error', text: error.message, at: new Date().toISOString() });
    });
    if (!child.pid) {
      this.store.setSessionStatus(sessionId, 'interrupted');
      fail('Shell local indisponível', 503);
    }
    this.processes.set(sessionId, child);
    this.store.setSessionStatus(sessionId, 'running', child.pid);
    const bindOutput = (stream, name) => {
      const decoder = new StringDecoder('utf8');
      stream.on('data', chunk => this.emit('terminal', { sessionId, stream: name, text: decoder.write(chunk), at: new Date().toISOString() }));
      stream.on('end', () => {
        const tail = decoder.end();
        if (tail) this.emit('terminal', { sessionId, stream: name, text: tail, at: new Date().toISOString() });
      });
    };
    bindOutput(child.stdout, 'stdout');
    bindOutput(child.stderr, 'stderr');
    child.on('close', (code, signal) => {
      this.processes.delete(sessionId);
      if (!this.sealed) this.store.setSessionStatus(sessionId, launchFailed ? 'interrupted' : 'stopped');
      this.emit('closed', { sessionId, code, signal });
    });
    return session;
  }

  command(sessionId, command) {
    command = requiredText(command, 'Comando', MAX_COMMAND);
    const child = this.processes.get(sessionId);
    if (!child || !child.stdin.writable) fail('Sessão não está ativa', 409);
    child.stdin.write(`${command}\n`);
    return { sessionId, accepted: true };
  }

  stop(sessionId) {
    const child = this.processes.get(sessionId);
    if (!child) fail('Sessão não está ativa', 409);
    void this.terminateTree(child).then(ok => {
      if (!ok && this.processes.has(sessionId)) this.emit('terminal', { sessionId, stream: 'error', text: 'Encerramento da árvore de processos não confirmado', at: new Date().toISOString() });
    });
    return { sessionId, stopping: true };
  }

  async terminateTree(child) {
    if (!child.pid) return false;
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); return true; }
      catch { try { child.kill('SIGKILL'); } catch {} return false; }
    }
    return await new Promise(resolve => {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => { try { child.kill(); } catch {} resolve(false); });
      killer.once('close', code => resolve(code === 0 || child.exitCode !== null));
    });
  }

  async closeAll() {
    try {
      const pending = [...this.processes.values()].map(child => {
        const closed = new Promise(resolve => child.once('close', resolve));
        return this.terminateTree(child).then(async ok => {
          if (!ok && this.processes.has(this.sessionIdForProcess(child))) throw new Error(`Encerramento da árvore do shell ${child.pid} não confirmado`);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Shell ${child.pid} não encerrou`)), 5000);
            closed.then(() => { clearTimeout(timer); resolve(); });
          });
        });
      });
      await Promise.all(pending);
    } catch (error) {
      for (const id of this.processes.keys()) this.store.setSessionStatus(id, 'interrupted');
      throw error;
    } finally {
      this.sealed = true;
    }
  }

  sessionIdForProcess(child) {
    for (const [id, process] of this.processes) if (process === child) return id;
    return null;
  }
}

export function listSkills(repoRoot) {
  const dir = path.join(repoRoot, '.agents', 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) return [];
    const match = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return [];
    const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || entry.name;
    const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
    return [{ id: entry.name, name, description, source: path.relative(repoRoot, file).replaceAll('\\', '/') }];
  });
}

export async function inventoryAssets(projectRoot, { maxFiles = 1000, maxEntries = 5000, maxDepth = 32, maxMs = 250 } = {}) {
  const files = [];
  const pending = [{ dir: projectRoot, depth: 0 }];
  const deadline = Date.now() + maxMs;
  let scannedEntries = 0;
  let unreadableDirectories = 0;
  let truncated = false;
  while (pending.length && files.length < maxFiles && scannedEntries < maxEntries && Date.now() < deadline) {
    const { dir, depth } = pending.pop();
    try {
      for await (const entry of await fs.promises.opendir(dir)) {
        if (scannedEntries >= maxEntries || files.length >= maxFiles || Date.now() >= deadline) {
          truncated = true;
          break;
        }
        scannedEntries++;
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          if (depth < maxDepth) pending.push({ dir: full, depth: depth + 1 });
          else truncated = true;
        }
        if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(path.relative(projectRoot, full).replaceAll('\\', '/'));
        if (files.length >= maxFiles) { truncated = true; break; }
      }
    } catch (error) {
      // One denied or vanished folder must not hide the rest of the project.
      if (!UNREADABLE_DIR.has(error.code)) throw error;
      if (depth === 0) fail('Pasta do projeto indisponível; confira se ela foi movida ou está sem permissão de leitura', 409);
      unreadableDirectories++;
    }
  }
  files.sort();
  return { files, truncated: truncated || pending.length > 0 || unreadableDirectories > 0, unreadableDirectories, scannedEntries,
    counts: files.reduce((out, file) => { const type = path.extname(file).toLowerCase(); out[type] = (out[type] || 0) + 1; return out; }, {}) };
}

export function defaultDataDir() {
  return path.join(os.homedir(), '.omniforge-lab');
}
