// Agent engine: runs a task as a real interactive Claude Code or Codex session in its own git worktree, tracks its
// state from the CLIs' own lifecycle hooks and process events (no model calls), and keeps the run record that
// review/merge consumes. The owner approves tools in the terminal: no permission or sandbox flag is changed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './lib/fsutil.mjs';
import { gitEnv } from './lib/git-env.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-hook.mjs');
const ACTIVE = new Set(['starting', 'working', 'blocked', 'idle']);
const CLAUDE_HOOKS = ['UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop'];
const EVENTS = new Set([...CLAUDE_HOOKS, 'agent-turn-complete']);
const LABEL = { claude: 'Claude', codex: 'Codex' };
// Prompts that wait on the owner but fire no hook, as lowercase text without spaces (TUIs place words with cursor moves).
const PROMPTS = [['trustthisfolder', 'trust_prompt'], ['hooksneedreview', 'hooks_review'], ['approachingratelimits', 'rate_limit_prompt'],
  ['wouldyouliketorun', 'approval_prompt'], ['wouldyouliketomake', 'approval_prompt']];
const plain = text => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, '').replace(/\s+/g, '').toLowerCase();

function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

/** Absolute path of a native executable: PATH first, then the installer's own folder. On Windows only `<name>.exe`
 * is accepted: a .cmd/.bat shim runs through cmd.exe, where a task title would become command injection. */
export function findExecutable(name, fallbackDir, env = process.env) {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
  const dirs = String(pathValue || '').split(path.delimiter).filter(dir => path.isAbsolute(dir));
  dirs.push(...[fallbackDir].flat().filter(Boolean));
  for (const dir of dirs) {
    const candidate = path.join(dir, file);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

/** Codex: PATH, then the Codex app's newest complete build (%LOCALAPPDATA%/OpenAI/Codex/bin/<build>/), then its
 * .sandbox-bin copy, which has no code-mode host: an agent there cannot use any tool (fails closed), so runs refuse it;
 * quota reads work. */
export function findCodex(env = process.env) {
  const bin = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  let builds = [];
  try { builds = fs.readdirSync(bin).map(name => path.join(bin, name)).filter(dir => fs.existsSync(path.join(dir, 'codex-code-mode-host.exe'))); }
  catch { /* no Codex app */ }
  builds.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return findExecutable('codex', [...builds, env.USERPROFILE && path.join(env.USERPROFILE, '.codex', '.sandbox-bin')], env);
}

// argv only, never a shell: branch names and paths do not pass through a command interpreter.
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };

const unknownUsage = reason => ({ status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, source: null, reason });
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const jsonLines = file => fs.readFileSync(file, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
// The first line only (Codex session_meta, ~25 KB): another session's rollout can pass 1 GB, over V8's string limit.
function firstLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, size).indexOf(10);
    return JSON.parse(buffer.toString('utf8', 0, end < 0 ? size : end));
  } catch { return null; } finally { fs.closeSync(fd); }
}

// Claude: <home>/.claude/projects/<any>/<session>.jsonl, found by file name (the folder encodes the cwd), plus its
// subagent transcripts (workflow subagents nest in subagents/workflows/wf_*/). One API message spans several lines repeating the same usage, so each message.id counts once.
export function claudeUsage(homeDir, sessionId, worktree) {
  const projects = path.join(homeDir, '.claude', 'projects');
  const file = (fs.existsSync(projects) ? fs.readdirSync(projects) : []).map(dir => path.join(projects, dir, `${sessionId}.jsonl`)).find(candidate => fs.existsSync(candidate));
  // Claude names the folder after the cwd; without Windows long paths a transcript path over 259 characters is never written.
  const expected = path.join(projects, String(worktree).replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  const tooLong = process.platform === 'win32' && expected.length > 259 ? ': o caminho esperado passa de 260 caracteres, o limite do Windows sem caminhos longos' : '';
  if (!file) return { usage: unknownUsage(`Transcrição da sessão Claude não encontrada${tooLong}`) };
  const subagents = path.join(path.dirname(file), sessionId, 'subagents');
  const files = [file, ...(fs.existsSync(subagents) ? fs.readdirSync(subagents, { recursive: true }).filter(name => name.endsWith('.jsonl')).map(name => path.join(subagents, name)) : [])];
  const messages = new Map();
  for (const row of files.flatMap(jsonLines)) if (row?.type === 'assistant' && row.message?.id && row.message.usage) messages.set(row.message.id, row.message.usage);
  if (!messages.size) return { usage: unknownUsage('A transcrição Claude não registra uso de mensagens') };
  const sum = key => [...messages.values()].reduce((total, usage) => total + (Number.isSafeInteger(usage[key]) ? usage[key] : 0), 0);
  return { usage: { status: 'observed', inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'), cacheReadTokens: sum('cache_read_input_tokens'),
    cacheCreationTokens: sum('cache_creation_input_tokens'), source: file, reason: null } };
}

// Codex: the newest <home>/.codex/sessions/**/rollout-*.jsonl whose session_meta cwd is this worktree and that began
// after the run; its last token_count total. Codex counts cached input inside input_tokens, Claude does not: the stored
// inputTokens is input_tokens minus cached_input_tokens (never negative), so every host reports input excluding cache reads.
function codexUsage(homeDir, run) {
  const root = path.join(homeDir, '.codex', 'sessions');
  const started = Date.parse(run.startedAt);
  let best = null;
  for (const name of fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }) : []) {
    const file = path.join(root, name);
    if (!/^rollout-.*\.jsonl$/.test(path.basename(name)) || fs.statSync(file).mtimeMs < started) continue;
    const head = firstLine(file);
    const meta = head?.type === 'session_meta' ? head.payload : null;
    const at = Date.parse(meta?.timestamp);
    if (typeof meta?.cwd === 'string' && samePath(meta.cwd, run.worktree) && at >= started && (!best || at > best.at)) best = { file, at, id: meta.id };
  }
  if (!best) return { usage: unknownUsage('Sessão do Codex desta worktree não encontrada') };
  // ponytail: the run's own rollout is read whole, so one over ~512 MiB reports unknown; read it from the end if that happens.
  const total = jsonLines(best.file).findLast(row => row?.payload?.type === 'token_count' && row.payload.info?.total_token_usage)?.payload.info.total_token_usage;
  if (!total) return { usage: unknownUsage('A sessão do Codex não registrou contagem de tokens'), hostSessionId: best.id };
  const input = Number.isSafeInteger(total.input_tokens) ? Math.max(0, total.input_tokens - (total.cached_input_tokens ?? 0)) : null;
  return { usage: { status: 'observed', inputTokens: input, outputTokens: total.output_tokens ?? null, cacheReadTokens: total.cached_input_tokens ?? null,
    cacheCreationTokens: total.cache_write_input_tokens ?? null, source: best.file, reason: null }, hostSessionId: best.id };
}

function readUsage(run, homeDir) {
  try { return run.host === 'claude' ? claudeUsage(homeDir, run.hostSessionId, run.worktree) : codexUsage(homeDir, run); }
  catch (error) { return { usage: unknownUsage(`Leitura de uso falhou: ${error.message}`) }; }
}

export class AgentEngine extends EventEmitter {
  /** `hosts` ({claude|codex: {file, args}}) is a test seam only: production resolves the real executables. */
  constructor({ store, shells, hookUrl, codexPath = null, homeDir = os.homedir(), env = process.env, hosts = null }) {
    super();
    Object.assign(this, { store, shells, hookUrl, codexPath, homeDir, env, hosts });
    this.file = path.join(store.dataDir, 'runs.json');
    this.runs = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.secrets = new Map();
    this.tails = new Map(); // recent output per run, for prompts without hooks
    // No PTY survives a Lab restart: an unfinished run is failed, never done.
    const orphans = this.runs.filter(run => ACTIVE.has(run.state));
    for (const run of orphans) this.finish(run, { state: 'failed', detail: 'interrompido', exitCode: null });
    if (orphans.length) this.save();
    // Exit code 0 is done; any other code is failed. No code, a signal, or a session the Lab stopped is an interruption:
    // on POSIX node-pty reports a process killed by the Lab's stop or shutdown as code 0 plus the signal; on Windows
    // taskkill ends it with code 1 and no signal, and the PTY layer has marked the session stopped before this event.
    shells.on('closed', ({ sessionId, code, signal }) => {
      const run = this.runs.find(item => item.sessionId === sessionId && ACTIVE.has(item.state));
      if (!run) return;
      const stoppedByLab = ['stopping', 'stopped'].includes(this.store.session(sessionId).status);
      this.finish(run, code === null || signal || stoppedByLab ? { state: 'failed', detail: 'interrompido', exitCode: null }
        : code === 0 ? { state: 'done', detail: '', exitCode: 0 } : { state: 'failed', detail: `saiu com código ${code}`, exitCode: code });
      // This runs inside node-pty's exit callback: a failed write must not take the Lab down.
      try { this.publish(run); }
      catch (error) { console.error(`OmniForge: fim da execução ${run.id} não foi salvo: ${error.message}`); }
    });
    // ponytail: a fixed text match on the run's own output; a redraw of an answered prompt shows blocked again until
    // the next Enter or hook. Read the CLIs' structured events instead if they ever expose these prompts.
    shells.on('terminal', ({ sessionId, text }) => {
      const run = this.runs.find(item => item.sessionId === sessionId && ACTIVE.has(item.state));
      if (!run) return;
      const tail = ((this.tails.get(run.id) ?? '') + plain(text)).slice(-400);
      const prompt = PROMPTS.find(([pattern]) => tail.includes(pattern));
      this.tails.set(run.id, prompt ? '' : tail);
      if (prompt) this.set(run, { state: 'blocked', detail: prompt[1] });
    });
  }

  save() {
    writeFileAtomic(this.file, JSON.stringify(this.runs, null, 2), { mode: 0o600 });
  }

  publish(run) {
    this.save();
    this.emit('agent', { taskId: run.taskId, projectId: run.projectId, runId: run.id, sessionId: run.sessionId, host: run.host, state: run.state, detail: run.detail,
      at: new Date().toISOString(), ...(run.kind && { kind: run.kind }) });
  }

  set(run, { state, detail }) {
    if (run.state === state && run.detail === detail) return;
    Object.assign(run, { state, detail });
    this.publish(run);
  }

  /** Ends a run and reads its usage from the CLI's own session files (no model call). The caller saves. */
  finish(run, { state, detail, exitCode }) {
    this.secrets.delete(run.id);
    this.tails.delete(run.id);
    const { usage, hostSessionId } = readUsage(run, this.homeDir);
    Object.assign(run, { state, detail, exitCode, endedAt: new Date().toISOString(), usage, hostSessionId: run.hostSessionId ?? hostSessionId ?? null });
  }

  /** The task's latest agent run, or with `kind` its latest run of that kind (a review such as 'gauntlet'). */
  runForTask(taskId, kind) {
    const run = this.runs.findLast(item => item.taskId === taskId && item.kind === kind);
    return run ? structuredClone(run) : null;
  }

  list(projectId = null) {
    if (projectId !== null) this.store.project(projectId);
    return structuredClone(this.runs.filter(run => projectId === null || run.projectId === projectId).reverse());
  }

  executable(host) {
    if (this.hosts) return this.hosts[host];
    const file = host === 'claude' ? findExecutable('claude', path.join(this.homeDir, '.local', 'bin'), this.env) : this.codexPath;
    if (!file || process.platform === 'win32' && !/\.exe$/i.test(file)) fail(`Executável nativo do ${LABEL[host]} não encontrado; o Lab não aceita atalhos .cmd/.bat nem shells`);
    // findCodex's last fallback: fine for the quota read, but an agent there fails every tool closed (V-08).
    if (path.basename(path.dirname(file)).toLowerCase() === '.sandbox-bin') {
      fail('O Codex encontrado é a cópia .sandbox-bin, onde toda ferramenta do agente falha; instale o Codex CLI ou o app do Codex');
    }
    return { file, args: [] };
  }

  // The project folder must be a git root on a branch with a commit: its HEAD is the base of a new worktree.
  checkedRoot(task) {
    const { root } = this.store.project(task.projectId);
    const prefix = tryGit(root, 'rev-parse', '--show-prefix');
    if (prefix === null) fail('A pasta do projeto não é um repositório git');
    if (prefix !== '') fail('A pasta do projeto precisa ser a raiz de um repositório git');
    const baseSha = tryGit(root, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}');
    if (!baseSha) fail('O repositório do projeto precisa de pelo menos um commit');
    const baseBranch = tryGit(root, 'symbolic-ref', '--quiet', '--short', 'HEAD');
    if (!baseBranch) fail('O repositório do projeto está em HEAD destacado; faça checkout de uma branch');
    return { root, baseSha, baseBranch };
  }

  // Synchronous from the checks to the PTY start, so two requests cannot both pass the "no active run" check.
  // A review run (`kind` with its own `prompt`: the Gauntlet) opens its own session in the worktree of the task's latest
  // agent run and leaves the task's owner and status alone; review.mjs checks that run before it asks for one.
  run(taskId, { host, expectedRevision, kind, prompt } = {}) {
    const task = this.store.task(taskId);
    if (!Object.hasOwn(LABEL, host)) fail('Host de agente inválido', 400);
    // Any active run blocks a new agent run, which would take the task over; a review waits only for its own kind.
    if (this.runs.some(item => item.taskId === taskId && ACTIVE.has(item.state) && (!kind || item.kind === kind))) {
      fail(kind ? 'A tarefa já tem uma revisão em execução' : 'A tarefa já tem um agente em execução');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar');
    // The prompt is one argv element: node-pty would split one starting with `"`, and the CLI reads a leading `-` as a flag.
    if (kind && !/^[^"-]/.test(prompt ?? '')) fail('Prompt de revisão inválido', 400);
    const base = kind ? this.runForTask(taskId) : this.checkedRoot(task);
    if (!base) fail('Nenhuma execução registrada para esta tarefa', 404);
    const { file, args: hostArgs } = this.executable(host);

    const id = randomUUID();
    // A short folder keeps Claude's transcript path (~/.claude/projects/<cwd as name>/<session>.jsonl) under 260 characters.
    // Canonical (realpath) like run.worktree: a session's folder is compared as text by the uncertainty guard, and an
    // alias of the data folder (8.3 short name, junction) would otherwise let a review in the same worktree bypass it.
    const worktreeDir = base.worktree ?? path.join(fs.realpathSync.native(this.store.dataDir), 'worktrees', id.slice(0, 8));
    const session = this.store.addSession({ projectId: task.projectId, name: `${LABEL[host]}${kind ? ` (${kind})` : ''} · ${task.title}`.slice(0, 120), cwd: worktreeDir });
    const { root, baseBranch, baseSha } = base;
    let { worktree, branch } = base;
    if (!kind) {
      const branchFor = n => `omniforge/${task.id.slice(0, 8)}-${n}`;
      let n = this.runs.filter(run => run.taskId === taskId).length + 1;
      while (tryGit(root, 'show-ref', '--verify', '--quiet', `refs/heads/${branchFor(n)}`) !== null) n++;
      branch = branchFor(n);
      // Only .git/worktrees and the new folder change: the root's working tree and index are never touched.
      try { git(root, 'worktree', 'add', '-q', '-b', branch, worktreeDir, baseSha); }
      catch (error) {
        this.store.setSessionStatus(session.id, 'stopped');
        fail(`Não foi possível criar a worktree: ${String(error.stderr || error.message).trim().slice(0, 300)}`, 500);
      }
      worktree = fs.realpathSync.native(worktreeDir);
    }
    const run = { id, taskId, projectId: task.projectId, host, sessionId: session.id, hostSessionId: host === 'claude' ? randomUUID() : null, root, worktree, branch, baseBranch, baseSha,
      state: 'starting', detail: '', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, usage: unknownUsage('Execução em andamento'), ...(kind && { kind, prompt }) };
    this.runs.push(run);
    try {
      this.publish(run);
      // A fixed prefix keeps the task's prompt from starting with `"` (node-pty would not re-quote it and it would split
      // into several arguments) or `-` (a CLI flag). The whole prompt is one argv element; no shell ever parses it.
      const text = (prompt ?? `Tarefa: ${task.title}${task.details ? `\n\n${task.details}` : ''}`).replaceAll('\0', '');
      let args;
      if (host === 'claude') {
        // Hooks only, outside the worktree; the owner's user and project settings are never rewritten.
        const settings = path.join(this.store.dataDir, 'runs', id, 'claude-settings.json');
        const command = { type: 'command', command: `"${process.execPath.replaceAll('\\', '/')}" "${HOOK.replaceAll('\\', '/')}"`, timeout: 5 };
        fs.mkdirSync(path.dirname(settings), { recursive: true });
        writeFileAtomic(settings, JSON.stringify({ hooks: Object.fromEntries(CLAUDE_HOOKS.map(name => [name, [{ hooks: [command] }]])) }, null, 2), { mode: 0o600 });
        args = ['--session-id', run.hostSessionId, '--settings', settings, text];
      } else {
        // A JSON string array is valid TOML (basic strings escape `\` and `"` the same way). This replaces the owner's
        // own `notify` for this session only. Codex has no signal for a pending approval, so it never reports blocked.
        // --no-daemon: a shared app-server would run the turn, and notify, outside this PTY's hook environment.
        args = ['--no-daemon', '-C', worktree, '-c', `notify=${JSON.stringify([process.execPath, HOOK])}`, text];
      }
      const secret = randomBytes(24).toString('hex');
      this.secrets.set(id, Buffer.from(secret));
      this.shells.start(session.id, { cwd: worktree, file, args: [...hostArgs, ...args],
        env: { OMNIFORGE_RUN_ID: id, OMNIFORGE_RUN_TOKEN: secret, OMNIFORGE_HOOK_URL: this.hookUrl() } });
    } catch (error) {
      // Still starting means nothing was spawned: a plain stop keeps the project unblocked (the PTY layer records its own failures).
      if (this.store.session(session.id).status === 'starting') this.store.setSessionStatus(session.id, 'stopped');
      this.finish(run, { state: 'failed', detail: error.message, exitCode: null });
      this.publish(run);
      throw error;
    }
    if (!kind) {
      const assigned = this.store.assignTask(taskId, { sessionId: session.id, worktree, expectedRevision });
      // Only an open task starts running; a blocked or done one keeps the status its owner gave it.
      if (assigned.status === 'open') this.store.setTaskStatus(taskId, 'running', assigned.revision);
    }
    this.set(run, { state: 'working', detail: '' });
    return structuredClone(run);
  }

  /** A hook event, authenticated by its own run's secret; it can change only that run's state. */
  event({ runId, event, detail } = {}, token) {
    const secret = typeof runId === 'string' && this.secrets.get(runId);
    const presented = Buffer.from(typeof token === 'string' ? token : '');
    if (!secret || presented.length !== secret.length || !timingSafeEqual(presented, secret)) fail('Evento de agente não autorizado', 403);
    if (!EVENTS.has(event)) fail('Evento de agente inválido', 400);
    detail = typeof detail === 'string' ? detail.slice(0, 200) : '';
    let state;
    // Working with no detail: the tool name would make every tool switch a runs.json write (fsync) and a broadcast that
    // reloads every window; a repeated working event is then a no-op set.
    if (event === 'UserPromptSubmit' || event === 'PreToolUse') [state, detail] = ['working', ''];
    // Claude's notification_type: permission_prompt/elicitation_dialog wait on the owner, idle_prompt waits for a
    // new prompt; older versions send only the message text. Anything else (auth_success) changes nothing.
    else if (event === 'Notification') state = /permission|elicitation/i.test(detail) ? 'blocked' : /idle|waiting/i.test(detail) ? 'idle' : null;
    else [state, detail] = ['idle', '']; // Stop, agent-turn-complete
    if (state) this.set(this.runs.find(run => run.id === runId), { state, detail });
    return { accepted: true };
  }

  /** Terminal input for a session. */
  input(sessionId, data) {
    const run = this.runs.find(item => item.sessionId === sessionId && ['idle', 'blocked'].includes(item.state));
    // ponytail: any Enter typed while the agent waits counts as an answer; a real answer is confirmed by the next hook
    // and a stray Enter shows working until the agent's next idle/blocked hook. Parse the TUI if that misleads.
    if (run && typeof data === 'string' && /[\r\n]/.test(data)) this.set(run, { state: 'working', detail: '' });
  }
}
