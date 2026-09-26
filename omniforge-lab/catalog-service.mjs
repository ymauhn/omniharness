import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function unavailable() {
  const error = new Error('Catálogo indisponível. Verifique o Python local e atualize o índice.');
  error.status = 503;
  return error;
}

export function runCatalog(python, args, { cwd, input, timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(unavailable()); } else resolve(result);
    };
    const timer = setTimeout(() => finish(true), timeout);
    child.on('error', () => finish(true));
    child.stdin.on('error', () => finish(true));
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 8 * 1024 * 1024) return finish(true);
      chunks.push(data);
    });
    child.stderr.on('data', () => {}); // Consume diagnostics without exposing user paths.
    child.on('close', code => {
      if (code !== 0) return finish(true);
      try { finish(false, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(true); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

// The harness Python: OMNIHARNESS_PYTHON, else the Codex app's bundled runtime, else `python` on PATH.
export function harnessPython() {
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  return process.env.OMNIHARNESS_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
}

export class CatalogService {
  constructor({ repoRoot, dataDir, runner = runCatalog, python } = {}) {
    this.python = python || harnessPython();
    this.root = repoRoot;
    this.snapshot = path.join(dataDir, 'skill-catalog.json');
    this.runner = runner;
    this.ready = null;
    this.building = null;
    this.active = new Set();
    this.closed = false;
  }
  run(input) {
    if (this.closed) return Promise.reject(unavailable());
    if (this.active.size >= 4) return Promise.reject(Object.assign(new Error('Catálogo ocupado. Tente novamente.'), { status: 429 }));
    const attempt = Promise.resolve().then(() => this.runner(this.python, ['-m', 'harness.catalog_api', '--root', this.root, '--snapshot', this.snapshot], { cwd: this.root, input }));
    this.active.add(attempt);
    attempt.then(() => this.active.delete(attempt), () => this.active.delete(attempt));
    return attempt;
  }
  refresh() {
    if (this.building) return this.building;
    this.building = this.run({ op: 'build' }).then(result => {
      if (typeof result?.snapshot_id !== 'string' || !result.coverage) throw unavailable();
      this.ready = result;
      return result;
    }).catch(() => { this.ready = null; throw unavailable(); }).finally(() => { this.building = null; });
    return this.building;
  }
  async request(input) {
    if (!this.ready || this.building) await (this.building || this.refresh());
    return this.run(input);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.active]);
  }
}
