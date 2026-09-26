// OmniForge install manager for Windows: doctor, pack, install, start, update, rollback, repair, uninstall.
// Stdlib only. Entry point: scripts\omniforge.cmd <command>; see docs/omniforge/INSTALL.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from './lib/fsutil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const MANIFEST = 'omniforge-build.json';
// Written into data\ only when install creates it: a reinstall over kept data knows the folder is its own.
const DATA_MARK = '.omniforge-install';
const TIMEOUT = 10_000;
// What the installed Lab reads at runtime: server/demo/services here, skills and catalog tables for
// listSkills and harness.catalog_api, the arsenal bridge, and the Laya classifier worker and manifest.
export const RUNTIME = ['omniforge-lab', ':(exclude)omniforge-lab/test', 'scripts/omniforge.cmd', '.agents/skills',
  'harness/catalog_api.py', 'harness/skill_catalog.py', 'harness/agent_arsenal.py', 'harness/agent_arsenal_bridge.py',
  'harness/fsutil.py', 'harness/agent_profiles.json', 'harness/classifier_worker.py', 'harness/prompt_classifier.py',
  'docs/catalog/community-skills.md', 'docs/catalog/mcp-servers.md', 'docs/catalog/free-tiers.md',
  'docs/skills-graph/skill-metadata.json', 'docs/experiments/laya-artifacts-2026-09-25.json',
  'docs/omniforge/INSTALL.md', 'LICENSE'];
const NODE_HELP = 'install Node.js 22+: winget install -e --id OpenJS.NodeJS.LTS (or https://nodejs.org/en/download)';
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const PY_CHECK = "import sys, tomllib; print(sys.executable); print('%d.%d' % sys.version_info[:2])";
// Runs in a child so this process never maps conpty.node (a loaded addon would block uninstall).
const LAB_CHECK = `import fs from 'node:fs'; import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
createRequire(pathToFileURL('package.json'))('node-pty');
for (const file of ['@xterm/xterm/lib/xterm.mjs', '@xterm/xterm/css/xterm.css', '@xterm/addon-fit/lib/addon-fit.mjs']) fs.accessSync('node_modules/' + file);
const { resolvePtyShell } = await import(pathToFileURL('pty.mjs'));
console.log(JSON.stringify({ pty: JSON.parse(fs.readFileSync('node_modules/node-pty/package.json', 'utf8')).version, shell: resolvePtyShell() }));`;

// Windows (libuv and cmd.exe alike) looks in the current folder before PATH, so a stray git.exe or
// claude.cmd next to a downloaded zip would run. Programs are resolved from absolute PATH entries only.
function which(name, env = process.env, shell = true) {
  if (path.isAbsolute(name)) return name;
  // Without a shell Node can start only .exe/.com; a .bat/.cmd shim earlier on PATH (pyenv-win) must not hide the real program.
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(ext => ext && (shell || ext === '.exe' || ext === '.com')) : [];
  const names = !exts.length || exts.includes(path.extname(name).toLowerCase()) ? [name] : exts.map(ext => name + ext);
  for (const dir of (env.PATH || '').split(path.delimiter).map(entry => entry.replaceAll('"', '')).filter(entry => path.isAbsolute(entry))) {
    // lstat: a Store app alias is a reparse point that stat cannot open.
    for (const file of names.map(item => path.join(dir, item))) if (fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory() === false) return file;
  }
  return null;
}

export function run(file, args = [], { cwd, shell = false, timeout = TIMEOUT } = {}) {
  // shell only for fixed host-CLI commands (npm/claude/codex may be .cmd shims), never with caller input.
  const [name, ...rest] = shell ? file.split(' ') : [file];
  const exe = which(name, process.env, shell);
  if (!exe) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error(`${name} is not on PATH`), { code: 'ENOENT' }) };
  // The opt-out also covers what a child runs by name, such as the node an npm shim starts.
  const options = { cwd, encoding: 'utf8', timeout, windowsHide: true, env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } };
  const result = shell ? spawnSync([`"${exe}"`, ...rest, ...args].join(' '), { ...options, shell: true }) : spawnSync(exe, args, options);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const firstLine = text => String(text || '').trim().split(/\r?\n/)[0].slice(0, 160);

function writeJson(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Path equality as the file system sees it: win32 path.relative ignores case, so "c:\users\x" is "C:\Users\X".
const same = (a, b) => path.relative(a, b) === '';

function tar(args) {
  const result = spawnSync(TAR, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`tar failed: ${firstLine(result.stderr || result.error?.message)}`);
}

export function findPython({ env = process.env, exec = run, home = os.homedir() } = {}) {
  // Same order as the Lab services, plus the py launcher; start passes the winner as OMNIHARNESS_PYTHON.
  const bundled = path.join(home, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const candidates = env.OMNIHARNESS_PYTHON ? [[env.OMNIHARNESS_PYTHON, [], 'OMNIHARNESS_PYTHON']]
    : [fs.existsSync(bundled) && [bundled, [], 'bundled Codex runtime'], ['py', ['-3'], 'py -3'], ['python', [], 'python']].filter(Boolean);
  for (const [file, args, label] of candidates) {
    // Executing it rejects the WindowsApps Store alias, which exits 9009 without running Python.
    const result = exec(file, [...args, '-c', PY_CHECK], { timeout: TIMEOUT });
    const [executable, version = ''] = result.status === 0 ? result.stdout.trim().split(/\r?\n/) : [];
    const [major, minor] = version.split('.').map(Number);
    if (executable && (major > 3 || (major === 3 && minor >= 11))) return { executable, version, label };
  }
  return null;
}

function claudeLogin({ stdout }) {
  let status;
  try { status = JSON.parse(stdout); } catch { return null; }
  if (!status || typeof status !== 'object') return null;
  if (!status.loggedIn) return 'logged out';
  const method = /^[\w.-]{1,40}$/.test(status.authMethod ?? '') ? status.authMethod : 'unknown method';
  // Names only: apiKeySource is where a key comes from (for example ANTHROPIC_API_KEY), never the key.
  if (status.apiKeySource) return `API key (${/^[\w.-]{1,40}$/.test(status.apiKeySource) ? status.apiKeySource : 'configured'}; signed in via ${method})`;
  return method === 'claude.ai' ? 'subscription (claude.ai)' : `signed in via ${method}`;
}

function codexLogin({ stdout, stderr }) {
  const text = `${stdout}\n${stderr}`;
  if (/not logged in/i.test(text)) return 'logged out';
  if (/api key/i.test(text)) return 'API key';
  if (/chatgpt/i.test(text)) return 'subscription (ChatGPT)';
  return null;
}

export function doctor({ appDir = APP, env = process.env, exec = run, nodeVersion = process.versions.node } = {}) {
  const rows = [];
  const add = (name, required, status, detail, action) => rows.push({ name, required, status, detail, ...(status === 'ok' ? {} : { action }) });
  add('node', true, Number(nodeVersion.split('.')[0]) >= 22 ? 'ok' : 'missing', `Node.js ${nodeVersion}`, NODE_HELP);

  const lab = path.join(appDir, 'omniforge-lab');
  const fix = 'run `npm ci --prefix omniforge-lab` in a source checkout, or `omniforge repair` for an install';
  let pinned;
  try { pinned = readJson(path.join(lab, 'package.json')).dependencies['node-pty']; } catch { pinned = undefined; }
  const check = exec(process.execPath, ['--input-type=module', '-e', LAB_CHECK], { cwd: lab, timeout: 15_000 });
  let probe = null;
  try { probe = check.status === 0 ? JSON.parse(check.stdout) : null; } catch { probe = null; }
  if (!probe) add('lab', true, 'missing', `Lab dependencies or PTY shell did not load (${firstLine(check.stderr || check.error?.code) || `exit ${check.status}`})`, fix);
  // node-pty 1.1.0 hit a compiled-in ConPTY assert ("Microsoft Visual C++ Runtime Library" dialog); the lockfile pins the fix.
  else if (probe.pty !== pinned) add('lab', true, 'degraded', `node-pty ${probe.pty} installed but ${pinned} is pinned`, fix);
  else add('lab', true, 'ok', `node-pty ${probe.pty}; terminal shell ${probe.shell}`);

  const python = findPython({ env, exec });
  add('python', true, python ? 'ok' : 'missing',
    python ? `Python ${python.version} at ${python.executable} (via ${python.label})` : 'no Python 3.11+ with tomllib found (the Microsoft Store alias does not count)',
    'install Python 3.11+: winget install -e --id Python.Python.3.12 (or https://www.python.org/downloads/windows/), or set OMNIHARNESS_PYTHON');

  const git = exec('git', ['--version'], { timeout: TIMEOUT });
  add('git', false, git.status === 0 ? 'ok' : 'missing', git.status === 0 ? firstLine(git.stdout) : 'Git not found; only `pack` from a source checkout needs it', 'winget install -e --id Git.Git');

  // Read-only status commands of the host CLIs; no credential file is opened and no output is echoed.
  for (const [name, command, classify, installHelp, loginHelp] of [
    ['claude', 'claude auth status --json', claudeLogin, 'npm install -g @anthropic-ai/claude-code', 'claude auth login'],
    ['codex', 'codex login status', codexLogin, 'npm install -g @openai/codex', 'codex login'],
  ]) {
    // A localized cmd.exe reports an unknown command with exit 1, so ask where.exe first.
    const absent = process.platform === 'win32' && exec('where.exe', [name], { timeout: TIMEOUT }).status !== 0;
    const result = absent ? {} : exec(command, [], { shell: true, timeout: TIMEOUT });
    if (absent || result.error?.code === 'ENOENT' || result.status === 127) {
      add(name, false, 'missing', `${name} CLI not found`, `install it (${installHelp}), then run: ${loginHelp}`);
      continue;
    }
    const login = result.error ? null : classify(result);
    if (!login) add(name, false, 'degraded', `login status unknown (${result.error?.code || `exit ${result.status}`})`, `run \`${command}\` yourself to see why`);
    else if (login === 'logged out') add(name, false, 'degraded', 'installed but logged out', `run: ${loginHelp}`);
    else add(name, false, 'ok', `logged in: ${login}`);
  }
  return { ok: rows.every(row => !row.required || row.status === 'ok'), rows, python: python?.executable ?? null };
}

function printDoctor(report, out) {
  for (const row of report.rows) {
    out(`${row.status.padEnd(9)}${row.name.padEnd(7)}${row.detail}${row.required ? '' : ' (optional)'}`);
    if (row.action) out(`         -> ${row.action}`);
  }
  out(report.ok ? 'Doctor: required prerequisites are ready.' : 'Doctor: a required prerequisite is not ready; follow the -> line.');
}

const listFiles = root => fs.readdirSync(root, { recursive: true }).map(String)
  .filter(relative => fs.statSync(path.join(root, relative)).isFile())
  .map(relative => relative.replaceAll('\\', '/')).sort();

function buildId(manifest) {
  const id = `${manifest?.version}-${String(manifest?.sha).slice(0, 7)}`;
  if (!/^\d+\.\d+\.\d+[0-9A-Za-z.+-]*-[0-9a-f]{7}$/.test(id)) throw new Error('release manifest has an invalid version or sha');
  // Repair copies by these names; none may leave the app folder.
  const names = Object.keys(manifest.files ?? {});
  if (!names.length || names.some(name => path.isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..' || part === ''))) {
    throw new Error('release manifest has an invalid file list');
  }
  return id;
}

const damaged = (dir, manifest) => Object.entries(manifest.files).filter(([relative, digest]) => {
  try { return hashFile(path.join(dir, relative)) !== digest; } catch { return true; }
}).map(([relative]) => relative);

/** Write the build manifest into root, zip root and write the sibling .sha256. */
export function archive(root, outDir, { version, sha, node = process.version }) {
  const files = {};
  for (const relative of listFiles(root)) if (relative !== MANIFEST) files[relative] = hashFile(path.join(root, relative));
  const manifest = { name: 'omniforge', version, sha, node, builtAt: new Date().toISOString(), files };
  const id = buildId(manifest);
  fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.mkdirSync(outDir, { recursive: true });
  const zip = path.join(outDir, `omniforge-${id}-win-x64.zip`);
  fs.rmSync(zip, { force: true });
  tar(['-a', '-c', '-f', zip, '-C', root, ...fs.readdirSync(root)]);
  const sha256 = hashFile(zip);
  fs.writeFileSync(`${zip}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
  return { zip, id, sha256, root, files: Object.keys(files).length };
}

export async function pack({ repoDir = APP, outDir, exec = run } = {}) {
  if (!outDir) throw new Error('pack needs --out <dir>');
  const git = (...args) => {
    const result = exec('git', ['-C', repoDir, ...args], { timeout: 120_000 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${firstLine(result.stderr || result.error?.message)}`);
    return result.stdout.trim();
  };
  // Untracked files cannot leak: the release is cut from HEAD with git archive.
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('working tree is dirty; commit or stash tracked changes before pack');
  const sha = git('rev-parse', 'HEAD');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-pack-'));
  try {
    const root = path.join(staging, 'root');
    fs.mkdirSync(root);
    git('archive', '--format=tar', '-o', path.join(staging, 'source.tar'), 'HEAD', '--', ...RUNTIME);
    tar(['-x', '-f', path.join(staging, 'source.tar'), '-C', root]);
    // Production dependencies from the lockfile, bundled so install needs no network. The node-pty
    // install script is skipped on purpose: its win32 prebuilds load directly, as in a checkout.
    const npm = exec('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(root, 'omniforge-lab'), shell: true, timeout: 600_000 });
    if (npm.status !== 0) throw new Error(`npm ci failed: ${firstLine(npm.stderr || npm.error?.message)}`);
    const { root: _, ...release } = archive(root, outDir, { version: readJson(path.join(root, 'omniforge-lab', 'package.json')).version, sha });
    return release;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function defaultPrefix(env = process.env) {
  // Inside <prefix>\app\<version> the manager manages its own install.
  const installed = path.resolve(APP, '..', '..');
  if (path.basename(path.dirname(APP)) === 'app' && fs.existsSync(path.join(installed, 'current.json'))) return installed;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OmniForge');
}

function readCurrent(prefix) {
  try { return readJson(path.join(prefix, 'current.json')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function loadRecord(prefix) {
  try { return readJson(path.join(prefix, 'install.json')); }
  catch (error) { if (error.code === 'ENOENT') return { schema: 1, created: [], versions: {} }; throw error; }
}

function mark(record, file, kind) {
  if (!record.created.some(item => same(item.path, file))) record.created.push({ path: file, kind });
}

function ensureDir(record, dir, kind = 'dir') {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  mark(record, dir, kind);
}

function saveRecord(prefix, record) {
  mark(record, path.join(prefix, 'install.json'), 'file');
  writeJson(path.join(prefix, 'install.json'), record);
}

function verifyChecksum(zip) {
  let expected;
  try { expected = fs.readFileSync(`${zip}.sha256`, 'utf8').trim().split(/\s+/)[0].toLowerCase(); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`checksum file ${zip}.sha256 is missing`); throw error; }
  const actual = hashFile(zip);
  if (actual !== expected) throw new Error(`checksum mismatch for ${zip}: expected ${expected}, got ${actual}`);
  return actual;
}

function peek(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-peek-'));
  try {
    tar(['-x', '-f', zip, '-C', dir, MANIFEST]);
    return buildId(readJson(path.join(dir, MANIFEST)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Extract a verified zip to <prefix>\app\<id> and keep a copy under releases\ for repair.
function unpack(zip, sha256, prefix, record) {
  ensureDir(record, prefix);
  const apps = path.join(prefix, 'app');
  ensureDir(record, apps);
  const partial = path.join(apps, `.partial-${randomUUID()}`);
  fs.mkdirSync(partial);
  let id;
  try {
    tar(['-x', '-f', zip, '-C', partial]);
    const manifest = readJson(path.join(partial, MANIFEST));
    id = buildId(manifest);
    const bad = damaged(partial, manifest);
    if (bad.length) throw new Error(`archive content differs from its manifest: ${bad.slice(0, 3).join(', ')}`);
    const target = path.join(apps, id);
    if (!fs.existsSync(target)) fs.renameSync(partial, target);
    else if (damaged(target, manifest).length) throw new Error(`${target} differs from its manifest; run: omniforge repair`);
    mark(record, target, 'tree');
  } finally {
    fs.rmSync(partial, { recursive: true, force: true });
  }
  const releases = path.join(prefix, 'releases');
  ensureDir(record, releases);
  const copy = path.join(releases, path.basename(zip));
  if (!fs.existsSync(copy) || hashFile(copy) !== sha256) {
    fs.copyFileSync(zip, copy);
    fs.writeFileSync(`${copy}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
  }
  mark(record, copy, 'file');
  mark(record, `${copy}.sha256`, 'file');
  record.versions[id] ??= { zip: copy, sha256, installedAt: new Date().toISOString() };
  ensureDir(record, path.join(prefix, 'run'), 'tree');
  return id;
}

function activate(prefix, record, id, previous, backup = null) {
  const launcher = path.join(prefix, 'omniforge.cmd');
  // backup: the state copy update took before switching to id; rollback names exactly this file.
  writeJson(path.join(prefix, 'current.json'), { version: id, previous, backup, switchedAt: new Date().toISOString() });
  mark(record, path.join(prefix, 'current.json'), 'file');
  // Control passes to the version's own script, so rewriting this launcher mid-update is safe.
  fs.writeFileSync(launcher, `@"%~dp0app\\${id}\\scripts\\omniforge.cmd" %*\r\n`);
  mark(record, launcher, 'file');
}

// A {pid} file; unknown counts as live. ponytail: pid only, so a reused pid reads as live until its file is removed.
function ownerStatus(file, label) {
  let owner;
  try { owner = readJson(file); }
  catch (error) { return error.code === 'ENOENT' ? { live: false } : { live: true, reason: `${label} is unreadable` }; }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return { live: true, reason: `${label} has no valid pid` };
  try { process.kill(owner.pid, 0); return { live: true, reason: `pid ${owner.pid} holds ${label}` }; }
  catch (error) { return error.code === 'ESRCH' ? { live: false, deadPid: owner.pid } : { live: true, reason: `pid ${owner.pid}: ${error.code}` }; }
}

/** Read-only view of the Lab's WorkspaceStore lock (core.mjs); unknown counts as live. */
export function lockStatus(dataDir) {
  if (fs.existsSync(path.join(dataDir, 'state.recovery.lock'))) return { live: true, reason: 'state.recovery.lock is present' };
  return ownerStatus(path.join(dataDir, 'state.lock'), 'state.lock');
}

function refuseLive(prefix) {
  const lock = lockStatus(path.join(prefix, 'data'));
  if (lock.live) throw new Error(`OmniForge is running or its data lock is uncertain (${lock.reason}); stop it first`);
}

// start writes run\<pid>.json: a demo, or a Lab on another data folder, holds no data lock but keeps app files loaded.
function refuseStarted(prefix) {
  let names = [];
  try { names = fs.readdirSync(path.join(prefix, 'run')).filter(name => /^\d+\.json$/.test(name)); } catch { names = []; }
  for (const name of names) {
    const status = ownerStatus(path.join(prefix, 'run', name), `run\\${name}`);
    if (status.live) throw new Error(`a Lab or demo started from ${prefix} is running (${status.reason}); stop it first`);
  }
}

const launcherHint = prefix => `"${path.join(prefix, 'omniforge.cmd')}"`;

export function install({ from, prefix = defaultPrefix(), exec = run, env = process.env, out = console.log } = {}) {
  if (!from) throw new Error('install needs --from <zip>');
  const zip = path.resolve(from);
  prefix = path.resolve(prefix);
  const sha256 = verifyChecksum(zip);
  const id = peek(zip);
  const current = readCurrent(prefix);
  if (current && current.version !== id) throw new Error(`OmniForge ${current.version} is installed in ${prefix}; use: omniforge update --from ${zip}`);
  const record = loadRecord(prefix);
  unpack(zip, sha256, prefix, record);
  const data = path.join(prefix, 'data');
  if (!fs.existsSync(data)) {
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, DATA_MARK), 'Created by OmniForge install; uninstall --apply --remove-data removes this folder.\n');
  }
  // The mark also covers data that an uninstall without --remove-data kept; a folder without it was never ours.
  if (fs.existsSync(path.join(data, DATA_MARK))) mark(record, data, 'tree');
  else if (!record.created.some(item => same(item.path, data))) out(`${data} existed before install: the Lab uses it, and uninstall never removes it.`);
  activate(prefix, record, id, current?.previous ?? null, current?.backup ?? null);
  saveRecord(prefix, record);
  out(`Installed OmniForge ${id} in ${prefix} (data: ${path.join(prefix, 'data')})`);
  const report = doctor({ appDir: path.join(prefix, 'app', id), exec, env });
  printDoctor(report, out);
  out(`Start: ${launcherHint(prefix)} start`);
  return report.ok ? 0 : 1;
}

export function update({ from, prefix = defaultPrefix(), exec = run, env = process.env, out = console.log } = {}) {
  if (!from) throw new Error('update needs --from <zip>');
  const zip = path.resolve(from);
  prefix = path.resolve(prefix);
  const current = readCurrent(prefix);
  if (!current) throw new Error(`OmniForge is not installed in ${prefix}; use: omniforge install --from ${zip}`);
  refuseLive(prefix);
  const sha256 = verifyChecksum(zip);
  const id = peek(zip);
  if (id === current.version) { out(`OmniForge ${id} is already current.`); return 0; }
  const state = path.join(prefix, 'data', 'state.json');
  let backup = null;
  if (fs.existsSync(state)) {
    // Never overwrite a backup: after a rollback the next update keeps both the old and the newer state.
    const digest = hashFile(state);
    backup = `${state}.pre-${id}`;
    for (let n = 1; fs.existsSync(backup) && hashFile(backup) !== digest; n++) backup = `${state}.pre-${id}.${n}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(state, backup, fs.constants.COPYFILE_EXCL);
    out(`State backup: ${backup}`);
  }
  const record = loadRecord(prefix);
  unpack(zip, sha256, prefix, record);
  activate(prefix, record, id, current.version, backup);
  saveRecord(prefix, record);
  out(`Updated ${current.version} -> ${id}; ${current.version} stays installed side by side.`);
  const report = doctor({ appDir: path.join(prefix, 'app', id), exec, env });
  printDoctor(report, out);
  out(`To go back: ${launcherHint(prefix)} rollback`);
  return report.ok ? 0 : 1;
}

export function rollback({ prefix = defaultPrefix(), out = console.log } = {}) {
  prefix = path.resolve(prefix);
  const current = readCurrent(prefix);
  if (!current?.previous || !fs.existsSync(path.join(prefix, 'app', current.previous))) throw new Error('no previous installed version to roll back to');
  refuseLive(prefix);
  const record = loadRecord(prefix);
  activate(prefix, record, current.previous, current.version);
  saveRecord(prefix, record);
  out(`Switched back to ${current.previous}; ${current.version} stays installed.`);
  if (current.backup && fs.existsSync(current.backup)) out(`State from before ${current.version}: ${current.backup} (restore it by hand only if ${current.version} changed data you need back).`);
  return 0;
}

function staleLocks(dataDir) {
  const lines = [];
  const status = lockStatus(dataDir);
  if (status.deadPid) lines.push(`${path.join(dataDir, 'state.lock')}: stale lock of a stopped instance; pid ${status.deadPid} is not running and the Lab recovers it on start`);
  let names = [];
  try { names = fs.readdirSync(dataDir); } catch { names = []; }
  for (const name of names.filter(item => item.startsWith('state.lock.stale-'))) {
    lines.push(`${path.join(dataDir, name)}: dead owner's lock preserved by a past recovery; kept as evidence`);
  }
  if (names.includes('state.recovery.lock')) lines.push(`${path.join(dataDir, 'state.recovery.lock')}: interrupted recovery guard; the Lab refuses to start while it exists`);
  return lines;
}

export function repair({ prefix = defaultPrefix(), out = console.log } = {}) {
  prefix = path.resolve(prefix);
  const current = readCurrent(prefix);
  if (!current) throw new Error(`OmniForge is not installed in ${prefix}`);
  const id = current.version;
  const target = path.join(prefix, 'app', id);
  let manifest = null;
  try { manifest = readJson(path.join(target, MANIFEST)); } catch { manifest = null; }
  if (manifest && damaged(target, manifest).length === 0) out(`All ${Object.keys(manifest.files).length} files of ${id} match the build manifest.`);
  else {
    const zip = loadRecord(prefix).versions[id]?.zip;
    if (!zip) throw new Error(`no recorded release archive for ${id}; reinstall with: omniforge install --from <zip>`);
    verifyChecksum(zip);
    const fresh = path.join(prefix, 'app', `.repair-${randomUUID()}`);
    fs.mkdirSync(fresh);
    try {
      tar(['-x', '-f', zip, '-C', fresh]);
      // Judge against the archived manifest; the installed one may be the damaged file.
      const good = readJson(path.join(fresh, MANIFEST));
      if (buildId(good) !== id) throw new Error(`recorded archive ${zip} is not build ${id}`);
      const broken = damaged(target, good);
      for (const relative of [...broken, MANIFEST]) {
        fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
        fs.copyFileSync(path.join(fresh, relative), path.join(target, relative));
      }
      if (damaged(target, good).length) throw new Error(`repair could not restore ${target}`);
      out(`Restored ${broken.length} file(s) of ${id} from ${zip}: ${broken.slice(0, 5).join(', ')}${broken.length > 5 ? ', ...' : ''}`);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  }
  const locks = staleLocks(path.join(prefix, 'data'));
  if (!locks.length) out('No stale locks.');
  else {
    out('Stale lock files, listed for triage (repair never deletes them):');
    locks.forEach((line, index) => out(`${index + 1}. ${line}`));
  }
  return 0;
}

function describe(item, prefix) {
  const data = path.join(prefix, 'data');
  if (!fs.existsSync(item.path)) return 'recorded by install; already absent';
  if (same(item.path, data)) return `user data, removed only with --remove-data; ${fs.readdirSync(data).length} entries, the Lab's OMNIFORGE_DATA_DIR`;
  if (same(item.path, path.join(prefix, 'run'))) return `pid records of started Labs and demos; --apply refuses while one is running; ${fs.readdirSync(item.path).length} entries`;
  if (item.kind === 'tree') return `installed app ${path.basename(item.path)}; recorded in install.json, ${listFiles(item.path).length} files`;
  if (item.kind === 'dir') return 'install folder, removed only when empty; recorded in install.json';
  return `install file (${path.basename(item.path)}); recorded in install.json, ${fs.statSync(item.path).size} bytes`;
}

export function uninstall({ prefix = defaultPrefix(), apply = false, removeData = false, tempDir = os.tmpdir(), out = console.log } = {}) {
  prefix = path.resolve(prefix);
  const record = loadRecord(prefix);
  const data = path.join(prefix, 'data');
  // A recorded path outside the prefix is never removed, whatever install.json says.
  const ours = record.created.filter(item => same(item.path, prefix) || contains(prefix, item.path));
  const lines = ours.map(item => `${item.path}: ${describe(item, prefix)}`);
  for (const item of record.created.filter(entry => !ours.includes(entry))) lines.push(`${item.path}: outside ${prefix}; ignored, never removed`);
  out(lines.length ? `Recorded by install in ${prefix}:` : `No install record in ${prefix}.`);
  lines.forEach((line, index) => out(`${index + 1}. ${line}`));
  if (!apply) {
    out('Nothing removed. Re-run with --apply to remove these paths (data also needs --remove-data).');
    return 0;
  }
  refuseLive(prefix);
  refuseStarted(prefix);
  const installFile = path.join(prefix, 'install.json');
  // Containment, not string equality: nothing inside data\ goes on its own, data\ only with --remove-data,
  // and a folder above data\ (the prefix, whatever its recorded kind) is removed only when empty.
  const removable = ours.filter(item => !contains(data, item.path) && (removeData || !same(item.path, data)));
  const asDir = item => item.kind === 'dir' || contains(item.path, data);
  for (const item of removable.filter(entry => !asDir(entry) && !same(entry.path, installFile))) {
    fs.rmSync(item.path, { recursive: item.kind === 'tree', force: true });
  }
  fs.rmSync(installFile, { force: true });
  for (const item of removable.filter(asDir).sort((a, b) => b.path.length - a.path.length)) {
    try { fs.rmdirSync(item.path); }
    catch (error) { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST', 'EBUSY', 'EPERM'].includes(error.code)) throw error; }
  }
  const residue = [];
  if (fs.existsSync(prefix)) {
    const names = fs.readdirSync(prefix);
    const kept = removeData ? 'user data not recorded by install, so --remove-data left it' : 'user data kept (no --remove-data)';
    for (const name of names) residue.push(`${path.join(prefix, name)}: ${same(path.join(prefix, name), data) ? kept : 'not removable as recorded'}; left in place`);
    if (!names.length) residue.push(`${prefix}: empty folder not recorded as created by install, or in use; left in place`);
  }
  let temps = [];
  // demo.mjs creates folders with mkdtemp; a same-prefix file is someone else's.
  try { temps = fs.readdirSync(tempDir, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('omniforge-demo-')).map(entry => entry.name); }
  catch { temps = []; }
  for (const name of temps) residue.push(`${path.join(tempDir, name)}: data of a past start --demo; listed for triage, never deleted by uninstall`);
  out('Residue after uninstall:');
  if (!residue.length) out(`none (nothing left in ${prefix}; no omniforge-demo-* in ${tempDir})`);
  residue.forEach((line, index) => out(`${index + 1}. ${line}`));
  out('Node.js, Python, Git and the host CLIs were not touched.');
  return 0;
}

export async function start({ prefix = defaultPrefix(), demo = false, stopOnEof = false, env = process.env, out = console.log } = {}) {
  prefix = path.resolve(prefix);
  const current = readCurrent(prefix);
  if (!current) throw new Error(`OmniForge is not installed in ${prefix}; run: omniforge install --from <zip>`);
  const lab = path.join(prefix, 'app', current.version, 'omniforge-lab');
  const dataDir = path.join(prefix, 'data');
  // uninstall --apply refuses while this pid is alive; a killed process leaves a record that reads as stopped.
  const runFile = path.join(prefix, 'run', `${process.pid}.json`);
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  writeJson(runFile, { pid: process.pid, version: current.version, demo, startedAt: new Date().toISOString() });
  process.once('exit', () => fs.rmSync(runFile, { force: true }));
  env.OMNIFORGE_DATA_DIR = dataDir;
  if (!env.OMNIHARNESS_PYTHON) {
    const python = findPython({ env });
    if (python) env.OMNIHARNESS_PYTHON = python.executable;
    else out('Warning: no Python 3.11+ found; the skills catalog and Agent Arsenal stay unavailable (see doctor).');
  }
  // In-process, so a supervisor can stop it cleanly: Windows has no catchable signal for another process.
  let app;
  if (demo) {
    const started = await (await import(pathToFileURL(path.join(lab, 'demo.mjs')))).startDemo();
    app = started.app;
    out(`Demo data (kept after exit): ${started.dataDir}`);
    out(`OmniForge Demo: ${started.url}`);
  } else {
    app = (await import(pathToFileURL(path.join(lab, 'server.mjs')))).createOmniForgeServer({ dataDir });
    try { out(`OmniForge Lab: ${await app.listen(Number(env.OMNIFORGE_PORT || 0))}`); }
    catch (error) { await app.close(); throw error; }
  }
  out(`OmniForge ${current.version}; Ctrl+C stops the sessions and the server.`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await app.close(); process.exit(0); }
    catch (error) { console.error(`Shutdown not confirmed: ${error.message}`); process.exit(1); }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.once(signal, stop);
  if (stopOnEof) process.stdin.once('end', stop).resume();
}

const USAGE = `Usage: omniforge <command> [options]
  doctor                         check Node, Lab dependencies, Python, Git and host CLI logins
  pack --out <dir>               build a release zip from a clean checkout (HEAD)
  install --from <zip>           install into --prefix (default %LOCALAPPDATA%\\OmniForge)
  start [--demo] [--stop-on-eof] run the installed Lab (or a disposable demo)
  update --from <zip>            install side by side and switch; prints the rollback command
  rollback                       switch back to the previous version
  repair                         re-verify installed files, restore changed ones, list stale locks
  uninstall [--apply] [--remove-data]  print the removal triage; --apply removes recorded paths`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    from: { type: 'string' }, prefix: { type: 'string' }, out: { type: 'string' }, apply: { type: 'boolean' },
    'remove-data': { type: 'boolean' }, demo: { type: 'boolean' }, 'stop-on-eof': { type: 'boolean' },
  } });
  const prefix = values.prefix ? path.resolve(values.prefix) : defaultPrefix();
  switch (positionals[0]) {
    case 'doctor': {
      const report = doctor();
      printDoctor(report, console.log);
      return report.ok ? 0 : 1;
    }
    case 'pack': {
      const release = await pack({ outDir: values.out && path.resolve(values.out) });
      console.log(`Built ${release.zip} (${release.files} files)\nsha256 ${release.sha256}`);
      return 0;
    }
    case 'install': return install({ from: values.from, prefix });
    case 'start': await start({ prefix, demo: values.demo, stopOnEof: values['stop-on-eof'] }); return null;
    case 'update': return update({ from: values.from, prefix });
    case 'rollback': return rollback({ prefix });
    case 'repair': return repair({ prefix });
    case 'uninstall': return uninstall({ prefix, apply: values.apply, removeData: values['remove-data'] });
    default:
      console.log(USAGE);
      return positionals[0] ? 1 : 0;
  }
}

const isMain = () => {
  try { return fs.realpathSync.native(path.resolve(process.argv[1])) === fs.realpathSync.native(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (process.argv[1] && isMain()) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error(`OmniForge needs Node.js 22 or newer (found ${process.version}); ${NODE_HELP}`);
    process.exit(1);
  }
  main().then(code => { if (code !== null) process.exitCode = code; }, error => {
    console.error(`omniforge: ${error.message}`);
    process.exitCode = 1;
  });
}
