import { spawn } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_INPUT = 65_536;
const MAX_OUTPUT = 262_144;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOOTSTRAP = 'import sys;sys.path.insert(0,sys.argv[1]);from harness.agent_arsenal_bridge import main;raise SystemExit(main(sys.argv[2:]))';
const STATUS = { invalid: 400, not_found: 404, conflict: 409, locked: 423, unavailable: 503, damaged: 503, full: 507 };
const MESSAGES = {
  400: 'Pedido de arsenal inválido',
  404: 'Perfil ou vínculo não encontrado neste projeto',
  409: 'O arsenal mudou; atualize antes de tentar novamente',
  429: 'Arsenal ocupado; tente novamente',
  503: 'Arsenal local indisponível',
};
// Registry states that reloading cannot fix; each names its own recovery.
const DETAILS = {
  locked: lock => `Gravação do arsenal travada por ${lock}. Outra gravação pode estar em curso: tente de novo em instantes. Se persistir sem nenhuma operação do arsenal em andamento, o arquivo sobrou de uma gravação interrompida; confira-o e remova-o para liberar o registro.`,
  damaged: () => 'Registro do arsenal deste projeto ilegível; o arquivo foi preservado para inspeção e nada foi alterado.',
  full: () => 'Limite do registro do arsenal atingido; o histórico foi preservado e nada foi alterado.',
};
const problem = (status, message = MESSAGES[status]) => Object.assign(new Error(message), { status });

function environment() {
  const allowed = {};
  // Do not pass model keys, host auth tokens, PYTHONPATH, user site or proxies.
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'LANG']) {
    if (process.env[key]) allowed[key] = process.env[key];
  }
  return { ...allowed, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
}

function unpack(raw, lock) {
  if (!isUtf8(raw)) throw problem(503);
  let message;
  try { message = JSON.parse(raw.toString('utf8')); }
  catch { throw problem(503); }
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw problem(503);
  if (message.ok === false && Object.keys(message).length === 2 && Object.hasOwn(STATUS, message.code)) {
    throw problem(STATUS[message.code], DETAILS[message.code]?.(lock));
  }
  if (message.ok !== true || Object.keys(message).length !== 2 || !Object.hasOwn(message, 'result')) throw problem(503);
  return message.result;
}

/** Short-lived, isolated-Python-process protocol for the existing Registry.
 * It grants no agent execution authority; the HTTP caller verifies project,
 * task, host and selected-source identities before request().
 */
export class ArsenalService {
  constructor({ dataDir, repoRoot, python, spawnProcess = spawn, timeoutMs = 20_000 } = {}) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || typeof repoRoot !== 'string' ||
        !path.isAbsolute(repoRoot) || typeof spawnProcess !== 'function' ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw problem(400);
    const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    this.python = python || process.env.OMNIHARNESS_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
    if (typeof this.python !== 'string' || !this.python || this.python.includes('\0')) throw problem(400);
    this.dataDir = dataDir;
    this.repoRoot = repoRoot;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.children = new Set();
    this.closed = false;
  }

  async request(input) {
    if (this.closed) throw problem(503);
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.op !== 'string' ||
        (input.op !== 'builtins' && (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)))) throw problem(400);
    if (this.children.size >= 4) throw problem(429);
    let serialized;
    try { serialized = JSON.stringify(input); }
    catch { throw problem(400); }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_INPUT) throw problem(400);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnProcess(this.python,
          ['-I', '-u', '-c', BOOTSTRAP, this.repoRoot, '--data-dir', this.dataDir],
          { cwd: this.repoRoot, env: environment(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch { reject(problem(503)); return; }
      const entry = { child, closed: null, resolveClosed: null };
      entry.closed = new Promise(done => { entry.resolveClosed = done; });
      this.children.add(entry);
      let bytes = 0;
      const chunks = [];
      let failure = false;
      let settled = false;
      const settle = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(cleanupTimer);
        if (error) reject(error); else resolve(result);
      };
      const abort = () => {
        if (failure || settled) return;
        failure = true;
        try { child.kill(); } catch { /* Report unavailable if close does not arrive. */ }
        cleanupTimer = setTimeout(() => settle(problem(503)), 2000);
        cleanupTimer.unref?.();
      };
      let cleanupTimer;
      entry.abort = abort;
      const timer = setTimeout(abort, this.timeoutMs);
      child.on('error', abort);
      child.stdin.on('error', abort);
      child.stdout.on('error', abort);
      child.stderr.on('error', abort);
      child.stdout.on('data', part => {
        if (failure) return;
        bytes += part.length;
        if (bytes > MAX_OUTPUT) { abort(); return; }
        chunks.push(part);
      });
      child.stderr.on('data', () => {}); // Never reveal paths, excerpt text or diagnostics.
      child.on('close', code => {
        this.children.delete(entry);
        entry.resolveClosed();
        if (failure || code !== 0) { settle(problem(503)); return; }
        try { settle(null, unpack(Buffer.concat(chunks), path.join(this.dataDir, 'arsenal', `${input.projectId}.json.lock`))); }
        catch (error) { settle(error.status ? error : problem(503)); }
      });
      try { child.stdin.end(serialized, 'utf8'); }
      catch { abort(); }
    });
  }

  async close() {
    this.closed = true;
    const pending = [...this.children];
    if (!pending.length) return;
    const all = Promise.all(pending.map(entry => entry.closed)).then(() => true);
    const drained = async () => {
      let timer;
      const result = await Promise.race([all, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
      clearTimeout(timer); return result;
    };
    // A kill is TerminateProcess on Windows: Python's finally never removes the
    // writer lock. Let in-flight requests finish before killing stragglers.
    if (await drained()) return;
    for (const entry of pending) entry.abort();
    if (!await drained()) throw problem(503);
  }
}
