// Review and merge of a task run: the worktree's full diff, a gated merge into the owner's root, and an
// evidence bundle per task. This runs git in the owner's real repository, so: argv only (never a shell),
// no reset, no force, no branch or worktree deletion, and the root's working tree is touched only by
// `git merge` and `git merge --abort`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileAtomic } from './lib/fsutil.mjs';

const MAX_PATCH = 256 * 1024;
const MAX_LISTING = 16 * 1024 * 1024;
const MAX_TAIL = 4096;
const MAX_ATTEMPTS = 20;
const MAX_TEXT = 2000;
const TEST_TIMEOUT_MS = 10 * 60_000;
const RUNNING = new Set(['starting', 'working', 'blocked']);
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
// Variables that point git at another repository or index, as inside a git hook.
const GIT_LOCATION = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX)$/i;
const STRICT_IDENTITY = ['-c', 'user.useConfigOnly=true'];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

// A refusal is a gate that said no: it is recorded as an evidence attempt, unlike a bad request.
function refuse(reason) {
  throw Object.assign(new Error(reason), { status: 409, refused: true });
}

export function gitEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCATION.test(key)));
  return { ...env, GIT_TERMINAL_PROMPT: '0', ...extra };
}

function git(dir, args, { env = gitEnv(), limit = MAX_LISTING } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-C', dir, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, err = '';
    child.stdout.on('data', chunk => { if (size < limit) chunks.push(chunk); size += chunk.length; });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out: Buffer.concat(chunks).subarray(0, limit).toString('utf8'), truncated: size > limit, err }));
  });
}

const firstLine = text => text.split('\n').map(line => line.trim()).find(line => line && !/^(warning|hint):/i.test(line)) ?? '';

async function gitOk(dir, args, options) {
  const result = await git(dir, args, options);
  if (result.code !== 0 || result.truncated) fail(`Falha do git: ${firstLine(result.err) || `código ${result.code}`}`, 500);
  return result.out;
}

const currentBranch = async dir => (await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out.trim();
const hasMergeHead = async dir => (await git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0;

// `git diff --numstat -z --no-renames` rows are "added\tdeleted\tpath"; a binary file shows "-" counts.
function summarize(numstat) {
  const counts = new Map(), stat = { files: 0, additions: 0, deletions: 0 };
  for (const entry of numstat.split('\0')) {
    const [added, deleted, ...name] = entry.split('\t');
    if (!name.length) continue;
    const binary = added === '-';
    const row = { additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary };
    counts.set(name.join('\t'), row);
    stat.files++;
    stat.additions += row.additions;
    stat.deletions += row.deletions;
  }
  return { counts, stat };
}

// The worktree's whole content (tracked, uncommitted and untracked, .gitignore respected) against baseSha,
// staged into a throwaway copy of the worktree's index so the agent's own index never changes.
async function worktreeDiff(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-diff-'));
  try {
    const index = path.join(temp, 'index');
    const real = path.resolve(run.worktree, (await gitOk(run.worktree, ['rev-parse', '--git-path', 'index'])).trim());
    if (fs.existsSync(real)) fs.copyFileSync(real, index);
    const env = gitEnv({ GIT_INDEX_FILE: index });
    await gitOk(run.worktree, ['add', '-A'], { env });
    const diff = (...format) => ['diff', '--cached', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', ...format, run.baseSha, '--'];
    const [numstat, names, patch] = await Promise.all([
      gitOk(run.worktree, diff('--numstat', '-z'), { env }),
      gitOk(run.worktree, diff('--name-status', '-z'), { env }),
      git(run.worktree, diff(), { env, limit: MAX_PATCH }),
    ]);
    if (patch.code !== 0) fail(`Falha do git: ${firstLine(patch.err)}`, 500);
    const { counts, stat } = summarize(numstat);
    const parts = names.split('\0'), files = [];
    for (let i = 0; i + 1 < parts.length; i += 2) files.push({ path: parts[i + 1], status: parts[i], ...counts.get(parts[i + 1]) });
    return { baseSha: run.baseSha, branch: run.branch, files, stat, patch: patch.out, truncated: patch.truncated };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function killTree(pid) {
  if (process.platform !== 'win32') { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } return; }
  execFile(path.join(SYSTEM32, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}

// Last MAX_TAIL bytes as text, cut at a character boundary.
function tailText(buffer) {
  const bytes = Buffer.from(buffer.toString('utf8')).subarray(-MAX_TAIL);
  let start = 0;
  while ((bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

/** Run the owner's test command in `cwd`, handed as one argv entry to PowerShell (win32) or sh. Keeps the
 * SHA-256 of the whole combined stdout+stderr (arrival order) and only its last 4 KiB. */
export function runTestCommand({ command, cwd, timeoutMs = TEST_TIMEOUT_MS }) {
  const win = process.platform === 'win32';
  const [file, args] = win
    ? [path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command]]
    : ['/bin/sh', ['-c', command]];
  const started = Date.now(), hash = createHash('sha256');
  let tail = Buffer.alloc(0), timedOut = false;
  const child = spawn(file, args, { cwd, windowsHide: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = chunk => { hash.update(chunk); tail = Buffer.concat([tail, chunk]).subarray(-MAX_TAIL); };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  return new Promise(resolve => {
    let settled = false;
    const finish = exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command, exitCode, timedOut, outputSha256: hash.digest('hex'), outputTail: tailText(tail), durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // A descendant that keeps the pipes open must not hold the merge forever.
      setTimeout(() => finish(null), 5000).unref();
    }, timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', code => finish(code));
  });
}

function optionalText(value, label) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string' || value.length > MAX_TEXT) fail(`${label} inválido`);
  return value.trim();
}

const validRun = run => /^[0-9a-f]{40,64}$/.test(run.baseSha) &&
  [run.branch, run.baseBranch].every(name => typeof name === 'string' && name && !name.startsWith('-')) &&
  [run.root, run.worktree].every(dir => typeof dir === 'string' && path.isAbsolute(dir));

/** Routes GET /api/tasks/:id/diff, GET /api/tasks/:id/evidence and POST /api/tasks/:id/merge.
 * `getRun(taskId)` returns the engine's latest run record for the task, or null. */
export function createReview({ store, getRun = () => null, runTest = runTestCommand, token = '', onEvidence = () => {} }) {
  // ponytail: one merge at a time for the whole Lab; per-root locks if parallel merges ever matter.
  let merging = false;
  const evidenceFile = taskId => path.join(store.dataDir, 'evidence', `${taskId}.json`);
  const readEvidence = taskId => {
    try { return JSON.parse(fs.readFileSync(evidenceFile(taskId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { taskId, attempts: [] }; throw error; }
  };
  const record = (task, attempt) => {
    const bundle = readEvidence(task.id);
    bundle.attempts = [...bundle.attempts, attempt].slice(-MAX_ATTEMPTS);
    fs.mkdirSync(path.dirname(evidenceFile(task.id)), { recursive: true });
    // The token is hex, so it never needs JSON escaping; the bundle never carries it, whatever a note or test printed.
    const text = JSON.stringify(bundle, null, 2);
    writeFileAtomic(evidenceFile(task.id), token ? text.replaceAll(token, '[token]') : text, { mode: 0o600 });
    onEvidence({ taskId: task.id, projectId: task.projectId });
  };

  const rootReady = async run => {
    const branch = await currentBranch(run.root);
    if (branch !== run.baseBranch) refuse(`A raiz está em ${branch || 'HEAD destacado'}, não na branch base ${run.baseBranch}`);
    if (await hasMergeHead(run.root)) refuse('A raiz tem um merge em andamento; conclua-o ou aborte-o antes');
    if ((await gitOk(run.root, ['status', '--porcelain', '--untracked-files=no'])).trim()) refuse('A raiz tem mudanças não commitadas em arquivos rastreados; faça commit ou stash antes do merge');
  };

  async function gatedMerge(task, run, attempt, testCommand) {
    if (!run) refuse('Nenhuma execução registrada para esta tarefa');
    if (!validRun(run)) refuse('Registro de execução inválido');
    if (RUNNING.has(run.state)) refuse(`O agente ainda está em execução (${run.state}); aguarde terminar`);
    if (task.dependsOn.some(id => store.task(id).status !== 'done')) refuse('Dependências não concluídas');
    await rootReady(run);
    for (const ident of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
      if ((await git(run.root, [...STRICT_IDENTITY, 'var', ident])).code !== 0) refuse('O git não tem identidade configurada (user.name e user.email); configure-a antes do merge');
    }
    if (await currentBranch(run.worktree) !== run.branch) refuse(`A worktree da tarefa não está na branch ${run.branch}`);
    await gitOk(run.worktree, ['add', '-A']);
    if (token && (await git(run.worktree, ['grep', '--cached', '-q', '-F', '-e', token])).code === 0) refuse('O conteúdo da tarefa contém o token local do Lab; remova-o antes do merge');
    if ((await git(run.worktree, ['diff', '--cached', '--quiet'])).code !== 0) {
      const commit = await git(run.worktree, [...STRICT_IDENTITY, 'commit', '-q', '-m', `omniforge: ${task.title}`]);
      if (commit.code !== 0) refuse(`O commit na branch da tarefa falhou: ${firstLine(commit.err)}`);
    }
    attempt.headSha = (await gitOk(run.worktree, ['rev-parse', 'HEAD'])).trim();
    attempt.diffStat = summarize(await gitOk(run.worktree, ['diff', '--numstat', '-z', '--no-renames', run.baseSha, attempt.headSha, '--'])).stat;
    if ((await git(run.root, ['merge-base', '--is-ancestor', attempt.headSha, 'HEAD'])).code === 0) refuse('Nada para integrar: a branch da tarefa já está na raiz');
    if (testCommand) {
      attempt.test = await runTest({ command: testCommand, cwd: run.worktree });
      if (attempt.test.timedOut) refuse('O comando de teste excedeu o tempo limite');
      if (attempt.test.exitCode !== 0) refuse(`O comando de teste falhou (código ${attempt.test.exitCode})`);
    }
    await rootReady(run); // the owner may have used the root while the test ran
    const before = (await gitOk(run.root, ['rev-parse', 'HEAD'])).trim();
    const merged = await git(run.root, [...STRICT_IDENTITY, 'merge', '--no-ff', '--no-edit', run.branch]);
    if (merged.code !== 0) {
      // Not gitOk: nothing may skip the abort below.
      const conflicts = (await git(run.root, ['diff', '--name-only', '--diff-filter=U', '-z'])).out.split('\0').filter(Boolean);
      if (await hasMergeHead(run.root)) await git(run.root, ['merge', '--abort']);
      const restored = (await gitOk(run.root, ['rev-parse', 'HEAD'])).trim() === before && !(await hasMergeHead(run.root));
      const cause = conflicts.length ? `Conflito de merge em ${conflicts.length} arquivo(s): ${conflicts.slice(0, 20).join(', ')}` : `O git recusou o merge: ${firstLine(merged.err || merged.out)}`;
      refuse(`${cause}. ` +
        (restored ? `A raiz voltou a ${before.slice(0, 7)} sem merge pendente.` : 'A raiz NÃO voltou ao estado anterior; confira-a manualmente.'));
    }
    attempt.mergeSha = (await gitOk(run.root, ['rev-parse', 'HEAD'])).trim();
  }

  async function merge(task, input) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar', 409);
    const testCommand = optionalText(input.testCommand, 'Comando de teste');
    const note = optionalText(input.note, 'Nota do revisor');
    const run = getRun(task.id);
    const attempt = { at: new Date().toISOString(), runId: run?.id ?? null, host: run?.host ?? null, baseSha: run?.baseSha ?? null, branch: run?.branch ?? null,
      headSha: null, mergeSha: null, refused: null, diffStat: null, test: null, usage: run?.usage ?? null, note };
    if (merging) fail('Outro merge em andamento; aguarde', 409);
    merging = true;
    try {
      await gatedMerge(task, run, attempt, testCommand);
    } catch (error) {
      if (!error.refused) throw error;
      attempt.refused = { reason: error.message };
      record(task, attempt);
      throw error;
    } finally {
      merging = false;
    }
    record(task, attempt);
    return { task: store.setTaskStatus(task.id, 'done', input.expectedRevision), attempt };
  }

  return async function handle({ method, url, input }) {
    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(diff|evidence|merge)$/);
    if (!match || !['GET diff', 'GET evidence', 'POST merge'].includes(`${method} ${match[2]}`)) return null;
    const task = store.task(match[1]);
    if (match[2] === 'evidence') return { status: 200, body: readEvidence(task.id) };
    if (match[2] === 'merge') return { status: 200, body: await merge(task, input), changed: true };
    const run = getRun(task.id);
    if (!run) fail('Nenhuma execução registrada para esta tarefa', 404);
    if (!validRun(run)) fail('Registro de execução inválido', 409);
    return { status: 200, body: await worktreeDiff(run) };
  };
}
