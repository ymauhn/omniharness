import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import pty from 'node-pty';

const MAX_COMMAND = 4096;
const MAX_WRITE = 65536;
const MAX_OUTPUT_CHUNK = 8192;
const EXIT_TIMEOUT_MS = 5000;
const KILL_TIMEOUT_MS = 5000;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function executable(file) {
  try {
    const resolved = fs.realpathSync.native(file);
    if (!fs.statSync(resolved).isFile()) return null;
    fs.accessSync(resolved, fs.constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}

export function resolvePtyShell(shell = process.platform === 'win32' ? 'pwsh.exe' : 'sh', env = process.env) {
  if (typeof shell !== 'string' || !shell || shell.includes('\0')) fail('Shell local indisponível', 503);
  if (path.isAbsolute(shell)) {
    const found = executable(shell);
    if (found) return found;
    fail('Shell local indisponível', 503);
  }
  if (path.basename(shell) !== shell) fail('Shell local indisponível', 503);
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
  for (const directory of String(pathValue || '').split(path.delimiter)) {
    const clean = directory.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(clean)) continue;
    const candidate = executable(path.join(clean, shell));
    if (candidate) return candidate;
  }
  fail('Shell local indisponível', 503);
}

function emitOutput(coordinator, sessionId, value) {
  const text = String(value);
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + MAX_OUTPUT_CHUNK, text.length);
    if (end < text.length && end > offset && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    coordinator.emit('terminal', { sessionId, stream: 'stdout', text: text.slice(offset, end), at: new Date().toISOString() });
    offset = end;
  }
}

function defaultKillTree(pid) {
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); return Promise.resolve(true); }
    catch { return Promise.resolve(false); }
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  const taskkill = systemRoot && executable(path.join(systemRoot, 'System32', 'taskkill.exe'));
  if (!taskkill) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: KILL_TIMEOUT_MS }, error => resolve(!error));
  });
}

export class PtyCoordinator extends EventEmitter {
  constructor(store, { shell, spawnPty = pty.spawn, killTree = defaultKillTree, env = process.env, cols = 80, rows = 24, terminationTimeoutMs = KILL_TIMEOUT_MS + EXIT_TIMEOUT_MS } = {}) {
    super();
    this.store = store;
    this.shell = shell;
    this.spawnPty = spawnPty;
    this.killTree = killTree;
    this.env = env;
    this.cols = cols;
    this.rows = rows;
    this.terminationTimeoutMs = terminationTimeoutMs;
    this.processes = new Map();
    this.records = new Map();
    this.sealed = false;
    this.closed = false;
  }

  start(sessionId) {
    if (this.sealed) fail('Coordenador encerrado', 409);
    if (this.processes.has(sessionId)) fail('Sessão já iniciada');
    const session = this.store.session(sessionId);
    if (session.status !== 'starting') fail('Sessão não está pronta para iniciar; verifique a sessão interrompida', 409);
    const project = this.store.project(session.projectId);
    let child;
    try {
      const shell = resolvePtyShell(this.shell, this.env);
      child = this.spawnPty(shell, process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Set-PSReadLineOption -HistorySaveStyle SaveNothing'] : [], {
        cwd: project.root,
        cols: this.cols,
        rows: this.rows,
        name: 'xterm-256color',
        env: { ...this.env, OMNIFORGE_PROJECT_ID: project.id, OMNIFORGE_SESSION_ID: session.id },
      });
    } catch (error) {
      this.store.setSessionStatus(sessionId, 'interrupted');
      if (error.status) throw error;
      fail(`Shell local indisponível: ${error.message}`, 503);
    }
    if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) {
      try { child?.kill(); } catch { /* launch outcome is unknown */ }
      this.store.setSessionStatus(sessionId, 'interrupted');
      fail('Shell local indisponível: PID inválido', 503);
    }
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const record = { child, done, resolveDone, stopRequested: false, killResult: undefined, exitObserved: false, finalized: false, committed: false, uncertain: false, persistenceError: null };
    this.processes.set(sessionId, child);
    this.records.set(sessionId, record);
    child.onData(data => emitOutput(this, sessionId, data));
    child.onExit(event => {
      if (this.records.get(sessionId) !== record) return;
      record.exitObserved = true;
      record.code = Number.isInteger(event?.exitCode) ? event.exitCode : null;
      record.signal = Number.isInteger(event?.signal) ? event.signal : null;
      this.finishIfReady(sessionId, record);
    });
    try {
      this.store.setSessionStatus(sessionId, 'running', child.pid);
      record.committed = true;
    } catch (error) {
      // Keep the handle until the exact process tree request and PTY exit are
      // observed. An uncertain session blocks a replacement on restart.
      this.store.flagUncertainSession(sessionId);
      this.beginStop(sessionId, record);
      throw error;
    }
    return session;
  }

  active(sessionId) {
    if (this.sealed) fail('Coordenador encerrado', 409);
    const record = this.records.get(sessionId);
    if (!record || !record.committed || record.stopRequested || this.store.session(sessionId).status !== 'running') fail('Sessão não está ativa', 409);
    return record;
  }

  command(sessionId, input) {
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_COMMAND || /[\r\n]/u.test(input)) fail('Comando inválido');
    this.active(sessionId).child.write(`${input.trim()}\r`);
    return { sessionId, accepted: true };
  }

  write(sessionId, data) {
    if (typeof data !== 'string' || data.length > MAX_WRITE) fail('Dados de terminal inválidos');
    const record = this.active(sessionId);
    if (data) record.child.write(data);
    return { sessionId, accepted: true };
  }

  resize(sessionId, cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) fail('Tamanho de terminal inválido');
    this.active(sessionId).child.resize(cols, rows);
    return { sessionId, cols, rows };
  }

  markInterrupted(sessionId, record) {
    if (this.closed) return;
    try { this.store.setSessionStatus(sessionId, 'interrupted'); }
    catch (error) {
      record.persistenceError ||= error;
      this.store.flagUncertainSession(sessionId);
    }
    this.emit('state', { sessionId, status: 'interrupted' });
  }

  disposePty(record) {
    if (process.platform !== 'win32' || record.disposed) return;
    record.disposed = true;
    try { record.child.kill(); }
    catch (error) { record.killError ||= error; record.uncertain = true; }
  }

  finishIfReady(sessionId, record) {
    if (record.finalized || !record.exitObserved || (record.stopRequested && record.killResult === undefined)) return;
    record.finalized = true;
    clearTimeout(record.deadline);
    // node-pty keeps ConPTY handles open after onExit until kill() disposes them.
    // Do this only after taskkill has had its chance to enumerate descendants.
    this.disposePty(record);
    const confirmed = record.committed && record.stopRequested && record.killResult === true && !record.uncertain && !this.closed;
    if (!this.closed) {
      try { this.store.setSessionStatus(sessionId, confirmed ? 'stopped' : 'interrupted'); }
      catch (error) {
        record.persistenceError ||= error;
        this.store.flagUncertainSession(sessionId);
      }
    }
    this.records.delete(sessionId);
    this.processes.delete(sessionId);
    const outcome = { confirmed: confirmed && !record.persistenceError, persistenceError: record.persistenceError, killError: record.killError };
    record.resolveDone(outcome);
    this.emit('closed', { sessionId, code: record.code, signal: record.signal });
  }

  beginStop(sessionId, record) {
    if (record.stopRequested || record.finalized) return;
    record.stopRequested = true;
    if (record.committed) {
      try { this.store.setSessionStatus(sessionId, 'stopping'); }
      catch { record.uncertain = true; this.store.flagUncertainSession(sessionId); }
      this.emit('state', { sessionId, status: this.store.session(sessionId).status });
    }
    record.deadline = setTimeout(() => {
      if (record.finalized) return;
      record.uncertain = true;
      this.markInterrupted(sessionId, record);
      this.disposePty(record);
    }, this.terminationTimeoutMs);
    record.deadline.unref?.();
    record.killPromise = Promise.resolve().then(() => this.killTree(record.child.pid)).then(
      result => {
        record.killResult = result === true;
        if (!record.killResult) this.markInterrupted(sessionId, record);
        this.finishIfReady(sessionId, record);
        return record.killResult;
      },
      error => {
        record.killResult = false;
        record.killError = error;
        this.markInterrupted(sessionId, record);
        this.finishIfReady(sessionId, record);
        return false;
      },
    );
  }

  stop(sessionId) {
    const record = this.active(sessionId);
    this.beginStop(sessionId, record);
    return { sessionId, stopping: true };
  }

  async closeAll() {
    if (this.closePromise) return this.closePromise;
    this.sealed = true;
    this.closePromise = (async () => {
      const outcomes = await Promise.allSettled([...this.records].map(async ([sessionId, record]) => {
        if (!record.stopRequested) this.beginStop(sessionId, record);
        let timer;
        const outcome = await Promise.race([
          record.done,
          new Promise(resolve => { timer = setTimeout(() => resolve(null), this.terminationTimeoutMs); }),
        ]);
        clearTimeout(timer);
        if (!outcome) {
          record.uncertain = true;
          this.markInterrupted(sessionId, record);
          this.disposePty(record);
          throw new Error(`Encerramento do PTY ${record.child.pid} não confirmado`);
        }
        if (outcome.persistenceError) throw outcome.persistenceError;
        if (!outcome.confirmed) throw new Error(`Encerramento do PTY ${record.child.pid} não confirmado${outcome.killError ? `: ${outcome.killError.message}` : ''}`);
      }));
      this.closed = true;
      const failure = outcomes.find(outcome => outcome.status === 'rejected');
      if (failure) throw failure.reason;
    })();
    return this.closePromise;
  }
}
