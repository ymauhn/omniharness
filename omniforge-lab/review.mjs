// Review and merge of a task run: the worktree's full diff, a gated merge into the owner's root, the Gauntlet on
// the owner's request and an evidence bundle per task. This runs git in the owner's real repository, so: argv only
// (never a shell), no repository hooks, no reset, no force, no branch or worktree deletion, and the root's working tree is
// touched only by `git merge` and `git merge --abort`. The task's worktree gets only the Gauntlet's self-ignoring report folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './lib/fsutil.mjs';
import { gitEnv, withoutGitLocation } from './lib/git-env.mjs';

const MAX_PATCH = 256 * 1024;
const MAX_LISTING = 16 * 1024 * 1024;
const MAX_TAIL = 4096;
const MAX_ATTEMPTS = 20;
const MAX_TEXT = 2000;
const TEST_TIMEOUT_MS = 10 * 60_000;
const MAX_REPORT = 64 * 1024;
const RUNNING = new Set(['starting', 'working', 'blocked']);
const ACTIVE = new Set([...RUNNING, 'idle']);
// The agent's turn is over: it exited, or its session waits for a new prompt (idle).
const FINISHED = new Set(['idle', 'done', 'failed']);
const PRESETS = new Set(['rapido', 'padrao']);
const SEVERITIES = [['high', 'ALTA'], ['medium', 'M[ÉE]DIA'], ['low', 'BAIXA'], ['unverified', 'SEM VERIFICA[ÇC][ÃA]O']];
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
const STRICT_IDENTITY = ['-c', 'user.useConfigOnly=true'];
// No repository hook runs in any git call here: a pre-commit hook (lint-staged, or one the agent wrote in an ignored
// husky folder) could stage content the owner never reviewed, a post-commit hook add commits, and post-index-change or
// reference-transaction run on every add and merge. The hooks folder is this very file: a file holds no hooks, and
// whatever could turn it into a folder could already rewrite the Lab. The command line's -c outranks every config file.
const NO_HOOKS = ['-c', `core.hooksPath=${fileURLToPath(import.meta.url)}`];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

// A refusal is a gate that said no: it is recorded as an evidence attempt, unlike a bad request.
function refuse(reason) {
  throw Object.assign(new Error(reason), { status: 409, refused: true });
}

function git(dir, args, { env = gitEnv(), limit = MAX_LISTING } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', ...NO_HOOKS, '-C', dir, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
// staged into a throwaway copy of the worktree's index so the agent's own index never changes. `tree` names that
// content: the merge takes it only when the worktree still holds the same tree.
async function worktreeDiff(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-diff-'));
  try {
    const index = path.join(temp, 'index');
    const real = path.resolve(run.worktree, (await gitOk(run.worktree, ['rev-parse', '--git-path', 'index'])).trim());
    if (fs.existsSync(real)) fs.copyFileSync(real, index);
    const env = gitEnv({ GIT_INDEX_FILE: index });
    await gitOk(run.worktree, ['add', '-A'], { env });
    const diff = (...format) => ['diff', '--cached', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', ...format, run.baseSha, '--'];
    const [numstat, names, patch, tree] = await Promise.all([
      gitOk(run.worktree, diff('--numstat', '-z'), { env }),
      gitOk(run.worktree, diff('--name-status', '-z'), { env }),
      git(run.worktree, diff(), { env, limit: MAX_PATCH }),
      gitOk(run.worktree, ['write-tree'], { env }),
    ]);
    if (patch.code !== 0) fail(`Falha do git: ${firstLine(patch.err)}`, 500);
    const { counts, stat } = summarize(numstat);
    const parts = names.split('\0'), files = [];
    for (let i = 0; i + 1 < parts.length; i += 2) files.push({ path: parts[i + 1], status: parts[i], ...counts.get(parts[i + 1]) });
    return { baseSha: run.baseSha, branch: run.branch, tree: tree.trim(), files, stat, patch: patch.out, truncated: patch.truncated };
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
  // The owner's tests run git in this worktree, never in a repository or index the Lab's own environment points at.
  const child = spawn(file, args, { cwd, env: withoutGitLocation(process.env), windowsHide: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] });
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

// A task branch equal to the base would commit and merge in the root itself; git keeps a branch in one
// worktree only, so this also rules out worktree === root.
const validRun = run => /^[0-9a-f]{40,64}$/.test(run.baseSha) && run.branch !== run.baseBranch &&
  [run.branch, run.baseBranch].every(name => typeof name === 'string' && name && !name.startsWith('-')) &&
  [run.root, run.worktree].every(dir => typeof dir === 'string' && path.isAbsolute(dir));

// Of `paths` (the ones the merge writes that the root's HEAD does not track), those something untracked in the root
// already occupies, or whose parent folder is an untracked file there. Git treats ignored files as expendable: the
// merge would overwrite them, or `merge --abort` delete them. A parent in `replaced` is a file the root's HEAD tracks
// and the task turned into a folder: git replaces it itself.
function untrackedInTheWay(root, paths, replaced) {
  const found = new Set();
  for (const name of paths) {
    const parts = name.split('/');
    for (let n = 1; n <= parts.length; n++) {
      const prefix = parts.slice(0, n).join('/');
      const stat = fs.lstatSync(path.join(root, prefix), { throwIfNoEntry: false });
      if (stat?.isDirectory() && n < parts.length) continue;
      if (stat && !replaced.has(prefix)) found.add(prefix);
      break; // nothing on disk here, or not a folder: nothing below it either
    }
  }
  return [...found];
}

/** Severity counts of a Gauntlet Phase 3 report ("🔴 ALTA (n)", gauntlet/SKILL.md), or 'desconhecido' when it states
 * none. A level the report does not state is left out, never counted as 0. */
export function gauntletSummary(text) {
  const counts = {};
  for (const [key, label] of SEVERITIES) {
    const match = new RegExp(`${label}\\s*\\((\\d+)\\)`, 'i').exec(text);
    if (match) counts[key] = Number(match[1]);
  }
  return Object.keys(counts).length ? counts : 'desconhecido';
}

// The report folder ignores itself (a `*` .gitignore, as .pytest_cache does): the report never enters the task's
// diff or merge. A folder that is a link could make the Lab write outside the worktree, so it is refused.
function reportFolder(worktree) {
  const dir = path.join(worktree, '.gauntlet');
  try { fs.mkdirSync(dir); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!fs.lstatSync(dir).isDirectory()) fail('.gauntlet na worktree da tarefa não é uma pasta comum; mova-o antes do Gauntlet', 409);
  try { fs.writeFileSync(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}

// The newest Markdown report saved in <worktree>/.gauntlet/ since the run started, resolved inside the worktree
// (a link out of it is never followed) and read up to MAX_REPORT bytes. Null when there is none to read.
function gauntletReport(run) {
  try {
    const dir = path.join(run.worktree, '.gauntlet'), started = Date.parse(run.startedAt);
    let newest = null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isFile() && stat.mtimeMs >= started && (!newest || stat.mtimeMs > newest.mtimeMs)) newest = { file, mtimeMs: stat.mtimeMs };
    }
    if (!newest) return null;
    const inside = path.relative(fs.realpathSync.native(run.worktree), fs.realpathSync.native(newest.file));
    if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
    const fd = fs.openSync(newest.file, 'r'), buffer = Buffer.alloc(MAX_REPORT);
    try { return { file: newest.file, text: buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, MAX_REPORT, 0)) }; }
    finally { fs.closeSync(fd); }
  } catch { return null; }
}

/** Routes GET /api/tasks/:id/diff, GET /api/tasks/:id/evidence, POST /api/tasks/:id/merge and POST /api/tasks/:id/gauntlet;
 * `recordGauntlet(run)` adds a finished Gauntlet run to its task's evidence. `getRun(taskId, kind)` returns the engine's
 * latest agent run for the task (or of that kind, 'gauntlet'), or null; `startRun(taskId, options)` is the engine's run. */
export function createReview({ store, getRun = () => null, startRun, runTest = runTestCommand, token = '', onEvidence = () => {} }) {
  // The task being merged. ponytail: one merge at a time for the whole Lab; per-root locks if parallel merges ever matter.
  let merging = null;
  const evidenceFile = taskId => path.join(store.dataDir, 'evidence', `${taskId}.json`);
  const readEvidence = taskId => {
    try { return JSON.parse(fs.readFileSync(evidenceFile(taskId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { taskId, attempts: [] }; throw error; }
  };
  // `list` is 'attempts' (merges) or 'gauntlet'; a bundle written before the Gauntlet has no 'gauntlet' list yet.
  const record = (task, entry, list = 'attempts') => {
    const bundle = readEvidence(task.id);
    bundle[list] = [...(bundle[list] ?? []), entry].slice(-MAX_ATTEMPTS);
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

  const taskCurrent = (taskId, expectedRevision) => {
    const task = store.task(taskId);
    if (task.revision !== expectedRevision) refuse('Tarefa alterada em outra janela durante a revisão; confira o estado atual e tente de novo');
    if (task.dependsOn.some(id => store.task(id).status !== 'done')) refuse('Dependências não concluídas');
  };

  async function gatedMerge(task, run, attempt, { testCommand, expectedRevision, reviewedTree }) {
    if (!run) refuse('Nenhuma execução registrada para esta tarefa');
    if (!validRun(run)) refuse('Registro de execução inválido');
    if (RUNNING.has(run.state)) refuse(`O agente ainda está em execução (${run.state}); aguarde terminar`);
    // Its hunters may still be writing probe files in the worktree, which the commit below would take.
    if (ACTIVE.has(getRun(task.id, 'gauntlet')?.state)) refuse('O Gauntlet ainda está revisando esta tarefa; aguarde o relatório e encerre a sessão dele antes do merge');
    // An agent process that may outlive its session could still be writing in the worktree the commit below takes.
    const uncertain = store.uncertainSessionIn(task.projectId, run.worktree);
    if (uncertain) refuse(`A sessão “${uncertain.name}” na worktree da tarefa está incerta; confira se o processo dela terminou e confirme a verificação antes do merge`);
    taskCurrent(task.id, expectedRevision);
    await rootReady(run);
    for (const ident of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
      if ((await git(run.root, [...STRICT_IDENTITY, 'var', ident])).code !== 0) refuse('O git não tem identidade configurada (user.name e user.email); configure-a antes do merge');
    }
    if (await currentBranch(run.worktree) !== run.branch) refuse(`A worktree da tarefa não está na branch ${run.branch}`);
    await gitOk(run.worktree, ['add', '-A']);
    // The commit takes this index: it must hold the tree of the diff the owner reviewed, not what arrived since.
    if ((await gitOk(run.worktree, ['write-tree'])).trim() !== reviewedTree) refuse('O conteúdo da worktree mudou desde a revisão; abra o diff de novo');
    if (token && (await git(run.worktree, ['grep', '--cached', '-q', '-F', '-e', token])).code === 0) refuse('O conteúdo da tarefa contém o token local do Lab; remova-o antes do merge');
    if ((await git(run.worktree, ['diff', '--cached', '--quiet'])).code !== 0) {
      const commit = await git(run.worktree, [...STRICT_IDENTITY, 'commit', '-q', '--no-verify', '-m', `omniforge: ${task.title}`]);
      if (commit.code !== 0) refuse(`O commit na branch da tarefa falhou: ${firstLine(commit.err)}`);
    }
    attempt.headSha = (await gitOk(run.worktree, ['rev-parse', 'HEAD'])).trim();
    // Whatever else wrote in the worktree meanwhile, the commit tested and merged is the tree the owner reviewed.
    if ((await gitOk(run.worktree, ['rev-parse', `${attempt.headSha}^{tree}`])).trim() !== reviewedTree) refuse('O commit da tarefa não tem o conteúdo revisado; abra o diff de novo');
    attempt.diffStat = summarize(await gitOk(run.worktree, ['diff', '--numstat', '-z', '--no-renames', run.baseSha, attempt.headSha, '--'])).stat;
    if ((await git(run.root, ['merge-base', '--is-ancestor', attempt.headSha, 'HEAD'])).code === 0) refuse('Nada para integrar: a branch da tarefa já está na raiz');
    if (testCommand) {
      attempt.test = await runTest({ command: testCommand, cwd: run.worktree });
      if (attempt.test.timedOut) refuse('O comando de teste excedeu o tempo limite');
      if (attempt.test.exitCode !== 0) refuse(`O comando de teste falhou (código ${attempt.test.exitCode})`);
    }
    await rootReady(run); // the owner may have used the root while the test ran
    const before = (await gitOk(run.root, ['rev-parse', 'HEAD'])).trim();
    const status = async () => new Set((await gitOk(run.root, ['status', '--porcelain', '-z'])).split('\0').filter(Boolean));
    const statusBefore = await status();
    // The paths the merge writes that the root's HEAD does not track: the task's own changes since the merge base
    // (before...head), deletions aside, that are new against the root's HEAD. A file the root stopped tracking counts
    // only when the task changed it; the root's own deletions the task never touched are not written.
    const names = async (...range) => (await gitOk(run.root, ['diff', '--name-only', '-z', '--no-renames', ...range, '--'])).split('\0').filter(Boolean);
    const [touched, untracked, replaced] = await Promise.all([names('--diff-filter=d', `${before}...${attempt.headSha}`),
      names('--diff-filter=A', before, attempt.headSha), names('--diff-filter=D', before, attempt.headSha)]);
    const unowned = new Set(untracked), written = touched.filter(name => unowned.has(name));
    // Nothing awaits from here to the merge's spawn, so the task cannot change in between.
    const inTheWay = untrackedInTheWay(run.root, written, new Set(replaced));
    if (inTheWay.length) refuse(`A raiz tem arquivos não rastreados ou ignorados onde o merge escreveria: ${inTheWay.slice(0, 20).join(', ')}; mova-os antes do merge`);
    taskCurrent(task.id, expectedRevision);
    // The tested commit, not the branch name: the branch may have moved while the test ran.
    const merged = await git(run.root, [...STRICT_IDENTITY, 'merge', '--no-ff', '--no-edit', '--no-verify', '-m', `Merge branch '${run.branch}'`, attempt.headSha]);
    if (merged.code !== 0) {
      // Not gitOk: nothing may skip the abort below.
      const conflicts = (await git(run.root, ['diff', '--name-only', '--diff-filter=U', '-z'])).out.split('\0').filter(Boolean);
      if (await hasMergeHead(run.root)) await git(run.root, ['merge', '--abort']);
      // A merge git stopped partway (a file in use on Windows) leaves no MERGE_HEAD but may have written files. `git status`
      // lists no ignored file, so the merge's own untracked paths are looked up on disk too: none was there before, or
      // the gate above would have refused.
      const onDisk = name => { try { return Boolean(fs.lstatSync(path.join(run.root, name), { throwIfNoEntry: false })); } catch (error) { return error.code !== 'ENOTDIR'; } };
      const leftovers = [...new Set([...[...await status()].filter(entry => !statusBefore.has(entry)).map(entry => entry.slice(3)), ...written.filter(onDisk)])];
      const restored = (await gitOk(run.root, ['rev-parse', 'HEAD'])).trim() === before && !(await hasMergeHead(run.root)) && !leftovers.length;
      const cause = conflicts.length ? `Conflito de merge em ${conflicts.length} arquivo(s): ${conflicts.slice(0, 20).join(', ')}` : `O git recusou o merge: ${firstLine(merged.err || merged.out)}`;
      refuse(`${cause}. ` +
        (restored ? `A raiz voltou a ${before.slice(0, 7)} sem merge pendente.` : `A raiz NÃO voltou ao estado anterior${leftovers.length ? ` (${leftovers.slice(0, 20).join(', ')})` : ''}; confira-a manualmente.`));
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
    merging = task.id;
    try {
      await gatedMerge(task, run, attempt, { testCommand, expectedRevision: input.expectedRevision, reviewedTree: input.reviewedTree });
    } catch (error) {
      if (!error.refused) throw error;
      attempt.refused = { reason: error.message };
    } finally {
      merging = null;
    }
    // The outcome stands whatever the evidence write does: a refusal stays a refusal, and a merge that landed marks
    // the task done at its current revision. A failed write only adds evidenceError to the reply.
    let evidenceError;
    try { record(task, attempt); }
    catch (error) { evidenceError = `A evidência desta tentativa não foi salva: ${error.message}`; }
    const extra = evidenceError ? { evidenceError } : {};
    if (attempt.refused) return { status: 409, body: { error: attempt.refused.reason, ...extra } };
    return { status: 200, body: { task: store.setTaskStatus(task.id, 'done', store.task(task.id).revision), attempt, ...extra }, changed: true };
  }

  // The owner's confirmed request: a Gauntlet of the task's finished run, in its worktree, on a non-empty diff.
  async function gauntlet(task, input) {
    if (!PRESETS.has(input.preset)) fail('Preset do Gauntlet inválido');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== task.revision) fail('Tarefa alterada em outra janela; confira o estado atual antes de mudar', 409);
    const run = getRun(task.id);
    if (!run) fail('Nenhuma execução registrada para esta tarefa', 404);
    // validRun also keeps baseSha plain hex, so it can go into the prompt.
    if (!validRun(run)) fail('Registro de execução inválido', 409);
    if (!(await worktreeDiff(run)).files.length) fail('A worktree da tarefa não tem mudanças para revisar', 409);
    // After the diff, in the same tick as the start: the agent may have resumed, another run begun, or a merge begun, meanwhile.
    const current = getRun(task.id);
    if (current?.id !== run.id || !FINISHED.has(current.state)) fail('O agente da tarefa precisa ter terminado (ocioso, concluído ou falho) antes do Gauntlet', 409);
    // The merge's test runs in this worktree and its commit takes whatever is there: no hunters beside them.
    if (merging === task.id) fail('O merge desta tarefa está em andamento; aguarde-o terminar antes do Gauntlet', 409);
    reportFolder(run.worktree);
    // gauntlet/SKILL.md: report only (no fixes), no scope questions, scoped to what changed since the task's base.
    const prompt = `/gauntlet-loop ${input.preset} so-relatorio sem-perguntas desde=${run.baseSha}`;
    return startRun(task.id, { host: 'claude', expectedRevision: input.expectedRevision, kind: 'gauntlet', prompt });
  }

  function recordGauntlet(run) {
    const report = gauntletReport(run);
    record(store.task(run.taskId), { at: run.endedAt, runId: run.id, preset: /^\/gauntlet-loop (\w+)/.exec(run.prompt ?? '')?.[1] ?? null, exitCode: run.exitCode,
      usage: run.usage, reportPath: report?.file ?? null, summary: report ? gauntletSummary(report.text) : 'desconhecido' }, 'gauntlet');
  }

  async function handle({ method, url, input }) {
    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(diff|evidence|merge|gauntlet)$/);
    if (!match || !['GET diff', 'GET evidence', 'POST merge', 'POST gauntlet'].includes(`${method} ${match[2]}`)) return null;
    const task = store.task(match[1]);
    if (match[2] === 'evidence') return { status: 200, body: readEvidence(task.id) };
    if (match[2] === 'merge') return merge(task, input);
    if (match[2] === 'gauntlet') return { status: 200, body: await gauntlet(task, input), changed: true };
    const run = getRun(task.id);
    if (!run) fail('Nenhuma execução registrada para esta tarefa', 404);
    if (!validRun(run)) fail('Registro de execução inválido', 409);
    const body = await worktreeDiff(run), uncertain = store.uncertainSessionIn(task.projectId, run.worktree);
    // The merge gate's own check, so the page shows what the gate will say: an interrupted session is verified there.
    return { status: 200, body: { ...body, uncertainSession: uncertain && { id: uncertain.id, name: uncertain.name, status: uncertain.status } } };
  }

  // The server asks before a new agent run: the merge tests and commits this task's worktree, then marks it done.
  const isMerging = taskId => merging === taskId;

  return { handle, recordGauntlet, isMerging };
}
