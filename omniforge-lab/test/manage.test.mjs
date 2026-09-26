import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { doctor, pack, archive, install, update, rollback, repair, uninstall, run, RUNTIME } from '../manage.mjs';

const PINNED = '1.2.0-beta.15';
// Canonical, as install records paths: TEMP may be an 8.3 or junction spelling of this folder.
const TMP = fs.realpathSync.native(os.tmpdir());

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(TMP, `omniforge-manage-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A tiny release: the real layout with stand-in files, zipped and hashed by the production archive().
// With real = true it carries the real manager and entry script, so the installed launcher works.
function tinyZip(dir, version, sha, { real = false, files = {} } = {}) {
  const root = path.join(dir, `root-${version}`);
  fs.mkdirSync(path.join(root, 'omniforge-lab'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'package.json'), JSON.stringify({ version, dependencies: { 'node-pty': PINNED } }));
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'server.mjs'), `// server ${version}\n`);
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'index.html'), `<p>${version}</p>\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'omniforge.cmd'), '@echo off\r\n');
  if (real) {
    fs.mkdirSync(path.join(root, 'omniforge-lab', 'lib'), { recursive: true });
    fs.copyFileSync(new URL('../manage.mjs', import.meta.url), path.join(root, 'omniforge-lab', 'manage.mjs'));
    fs.copyFileSync(new URL('../lib/fsutil.mjs', import.meta.url), path.join(root, 'omniforge-lab', 'lib', 'fsutil.mjs'));
    fs.copyFileSync(new URL('../../scripts/omniforge.cmd', import.meta.url), path.join(root, 'scripts', 'omniforge.cmd'));
  }
  for (const [relative, text] of Object.entries(files)) fs.writeFileSync(path.join(root, relative), text);
  return archive(root, dir, { version, sha });
}

// Injected process runner: every prerequisite present, host CLIs absent.
// A localized cmd.exe reports an unknown command with exit 1, so absence must come from where.exe.
function fakeExec({ python = () => ({ status: 0, stdout: 'C:\\Py312\\python.exe\n3.12\n' }), pty = PINNED, claude, codex } = {}) {
  const calls = [];
  const notFound = name => ({ status: 1, stdout: '', stderr: `'${name}' não é reconhecido como um comando interno` });
  const exec = (file, args = [], options = {}) => {
    calls.push([file, args, options]);
    if (file === 'where.exe') return { status: ({ claude, codex })[args[0]] ? 0 : 1, stdout: '' };
    if (options.shell && file.startsWith('claude')) return claude ?? notFound('claude');
    if (options.shell && file.startsWith('codex')) return codex ?? notFound('codex');
    if (file === process.execPath) return { status: 0, stdout: JSON.stringify({ pty, shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }) };
    if (file === 'git') return { status: 0, stdout: 'git version 2.50.0' };
    return python(file, args);
  };
  exec.calls = calls;
  return exec;
}

const row = (report, name) => report.rows.find(item => item.name === name);
const contained = (parent, child) => !path.relative(parent, child).startsWith('..') && !path.isAbsolute(path.relative(parent, child));

test('doctor rejects the Store python stub, accepts py -3 and classifies host logins without echoing them', t => {
  const appDir = tinyZip(tmp(t, 'doctor'), '0.1.0', 'a'.repeat(40)).root;
  const exec = fakeExec({
    // WindowsApps alias: it runs, prints the Store hint and exits 9009.
    python: (file, args) => file === 'py' && args[0] === '-3' ? { status: 0, stdout: 'C:\\Py312\\python.exe\n3.12\n' } : { status: 9009, stdout: '', stderr: 'Python was not found; run without arguments to install from the Microsoft Store' },
    claude: { status: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: null, email: 'owner@example.com' }) },
    codex: { status: 0, stdout: 'Logged in using an API key - sk-proj-***ABCD\n' },
  });
  const report = doctor({ appDir, exec, env: {}, nodeVersion: '24.19.0' });
  assert.equal(report.ok, true);
  assert.equal(row(report, 'node').status, 'ok');
  assert.equal(row(report, 'lab').status, 'ok');
  assert.equal(row(report, 'python').status, 'ok');
  assert.equal(report.python, 'C:\\Py312\\python.exe');
  assert.match(row(report, 'python').detail, /py -3/);
  assert.equal(row(report, 'claude').status, 'ok');
  assert.match(row(report, 'claude').detail, /subscription/);
  assert.equal(row(report, 'codex').status, 'ok');
  assert.match(row(report, 'codex').detail, /API key/);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /sk-proj|owner@example\.com/);
  const hostCalls = exec.calls.filter(([, , options]) => options.shell).map(([file]) => file);
  assert.deepEqual(hostCalls, ['claude auth status --json', 'codex login status']);
  assert.ok(exec.calls.every(([, , options]) => options.timeout > 0 && options.timeout <= 15000));
});

test('doctor fails required rows with one actionable line and keeps host CLIs optional', t => {
  const appDir = tinyZip(tmp(t, 'doctor-fail'), '0.1.0', 'b'.repeat(40)).root;
  const absent = doctor({ appDir, exec: fakeExec(), env: {}, nodeVersion: '24.19.0' });
  assert.equal(absent.ok, true, 'absent host CLIs do not block the Lab');
  assert.equal(row(absent, 'claude').status, 'missing');
  assert.match(row(absent, 'claude').action, /npm install -g @anthropic-ai\/claude-code/);
  assert.equal(row(absent, 'codex').status, 'missing');

  const loggedOut = doctor({ appDir, env: {}, nodeVersion: '24.19.0', exec: fakeExec({
    claude: { status: 1, stdout: JSON.stringify({ loggedIn: false }) },
    codex: { status: 1, stdout: '', stderr: 'Not logged in' },
  }) });
  assert.equal(row(loggedOut, 'claude').status, 'degraded');
  assert.match(row(loggedOut, 'claude').detail, /logged out/);
  assert.match(row(loggedOut, 'claude').action, /claude auth login/);
  assert.equal(row(loggedOut, 'codex').status, 'degraded');
  assert.match(row(loggedOut, 'codex').action, /codex login/);

  const broken = doctor({ appDir, env: {}, nodeVersion: '20.11.0', exec: fakeExec({
    python: () => ({ status: 9009, stdout: '', stderr: 'Python was not found' }),
    pty: '1.1.0',
  }) });
  assert.equal(broken.ok, false);
  assert.equal(row(broken, 'node').status, 'missing');
  assert.match(row(broken, 'node').action, /winget install -e --id OpenJS\.NodeJS\.LTS/);
  assert.equal(row(broken, 'python').status, 'missing');
  assert.match(row(broken, 'python').action, /Python\.Python\.3\.12/);
  // node-pty 1.1.0 is the build whose ConPTY assert opened the "Microsoft Visual C++ Runtime Library" dialog.
  assert.equal(row(broken, 'lab').status, 'degraded');
  assert.match(row(broken, 'lab').detail, /1\.1\.0/);
  assert.match(row(broken, 'lab').action, /npm ci --prefix omniforge-lab/);
  for (const item of broken.rows) if (item.status !== 'ok') assert.ok(item.action && !item.action.includes('\n'), item.name);
});

test('run and the launcher resolve programs from PATH, never from the current folder', t => {
  // The host may export the opt-out; without it Windows looks in the current folder before PATH.
  const saved = { optOut: process.env.NoDefaultCurrentDirectoryInExePath, path: process.env.PATH };
  delete process.env.NoDefaultCurrentDirectoryInExePath;
  const dir = tmp(t, 'planted');
  const shims = tmp(t, 'shims');
  process.env.PATH = `${path.dirname(process.execPath)};${shims};${saved.path}`;
  t.after(() => {
    process.env.PATH = saved.path;
    if (saved.optOut !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = saved.optOut;
  });
  // A stray download next to the zip: stand-ins that print a host name instead of doing the real job.
  for (const name of ['where.exe', 'node.exe']) fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'hostname.exe'), path.join(dir, name));
  // Like an npm shim (claude.cmd, codex.cmd) that calls node by name.
  fs.writeFileSync(path.join(shims, 'ofshim.cmd'), '@node --version\r\n');
  assert.match(run('where.exe', ['cmd.exe'], { cwd: dir }).stdout, /cmd\.exe/i);
  assert.equal(run('node --version', [], { cwd: dir, shell: true }).stdout.trim(), process.version);
  assert.equal(run('ofshim', [], { cwd: dir, shell: true }).stdout.trim(), process.version);
  const launcher = fileURLToPath(new URL('../../scripts/omniforge.cmd', import.meta.url));
  const usage = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${launcher}""`], { encoding: 'utf8', windowsVerbatimArguments: true, cwd: dir });
  assert.match(usage.stdout, /Usage: omniforge/, usage.stdout + usage.stderr);
});

test('pack refuses a dirty tree before building anything', async t => {
  const repoDir = tmp(t, 'dirty');
  const outDir = tmp(t, 'dirty-out');
  const git = (...args) => assert.equal(spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).status, 0, args.join(' '));
  git('init', '-q');
  fs.mkdirSync(path.join(repoDir, 'omniforge-lab'));
  fs.writeFileSync(path.join(repoDir, 'omniforge-lab', 'package.json'), JSON.stringify({ version: '0.1.0' }));
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repoDir, 'omniforge-lab', 'package.json'), JSON.stringify({ version: '0.1.1' }));
  await assert.rejects(pack({ repoDir, outDir }), /dirty/);
  assert.deepEqual(fs.readdirSync(outDir), []);
});

test('install verifies the checksum, keeps data outside the app and is idempotent', t => {
  const dir = tmp(t, 'install');
  const prefix = path.join(dir, 'OmniForge');
  const release = tinyZip(dir, '0.1.0', 'c'.repeat(40));
  const lines = [];
  assert.equal(install({ from: release.zip, prefix, exec: fakeExec(), out: line => lines.push(line) }), 0);
  const current = JSON.parse(fs.readFileSync(path.join(prefix, 'current.json'), 'utf8'));
  assert.equal(current.version, '0.1.0-ccccccc');
  assert.equal(release.id, '0.1.0-ccccccc');
  const appDir = path.join(prefix, 'app', current.version);
  assert.equal(fs.readFileSync(path.join(appDir, 'omniforge-lab', 'server.mjs'), 'utf8'), '// server 0.1.0\n');
  assert.ok(fs.statSync(path.join(prefix, 'data')).isDirectory());
  assert.ok(path.relative(appDir, path.join(prefix, 'data')).startsWith('..'));
  assert.match(fs.readFileSync(path.join(prefix, 'omniforge.cmd'), 'utf8'), /app\\0\.1\.0-ccccccc\\scripts\\omniforge\.cmd/);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, 'install.json'), 'utf8'));
  const created = record.created.map(item => item.path);
  for (const expected of [prefix, appDir, path.join(prefix, 'data'), path.join(prefix, 'current.json'), path.join(prefix, 'install.json'), path.join(prefix, 'omniforge.cmd')]) {
    assert.ok(created.includes(expected), expected);
  }
  assert.ok(lines.some(line => /^ok\s+python/.test(line)), lines.join('\n'));

  assert.equal(install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(prefix, 'install.json'), 'utf8')).created, record.created);

  const forged = tinyZip(path.join(dir, 'forged'), '0.2.0', 'd'.repeat(40));
  fs.writeFileSync(`${forged.zip}.sha256`, `${'0'.repeat(64)}  ${path.basename(forged.zip)}\n`);
  assert.throws(() => install({ from: forged.zip, prefix: path.join(dir, 'other'), exec: fakeExec(), out: () => {} }), /checksum/);
  assert.ok(!fs.existsSync(path.join(dir, 'other', 'app', '0.2.0-ddddddd')));

  // A manifest naming a path outside the app folder is refused even with a matching checksum.
  const escape = tinyZip(path.join(dir, 'escape'), '0.3.0', '3'.repeat(40));
  const manifestFile = path.join(escape.root, 'omniforge-build.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files['../outside.txt'] = manifest.files['omniforge-lab/server.mjs'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.rmSync(escape.zip);
  assert.equal(spawnSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', escape.zip, '-C', escape.root, ...fs.readdirSync(escape.root)]).status, 0);
  fs.writeFileSync(`${escape.zip}.sha256`, `${createHash('sha256').update(fs.readFileSync(escape.zip)).digest('hex')}  x\n`);
  assert.throws(() => install({ from: escape.zip, prefix: path.join(dir, 'escaped'), exec: fakeExec(), out: () => {} }), /invalid/);
});

test('update refuses a live instance, backs up state, switches and rolls back', t => {
  const dir = tmp(t, 'update');
  const prefix = path.join(dir, 'OmniForge');
  const first = tinyZip(dir, '0.1.0', 'e'.repeat(40));
  const second = tinyZip(path.join(dir, 'next'), '0.2.0', 'f'.repeat(40));
  const out = [];
  install({ from: first.zip, prefix, exec: fakeExec(), out: () => {} });
  const data = path.join(prefix, 'data');
  fs.writeFileSync(path.join(data, 'state.json'), '{"schema":1}');
  fs.writeFileSync(path.join(data, 'state.lock'), JSON.stringify({ pid: process.pid, nonce: 'live' }));
  assert.throws(() => update({ from: second.zip, prefix, exec: fakeExec(), out: () => {} }), /running/);
  assert.throws(() => uninstall({ prefix, apply: true, out: () => {} }), /running/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(prefix, 'current.json'), 'utf8')).version, first.id);
  fs.unlinkSync(path.join(data, 'state.lock'));

  assert.equal(update({ from: second.zip, prefix, exec: fakeExec(), out: line => out.push(line) }), 0);
  const current = JSON.parse(fs.readFileSync(path.join(prefix, 'current.json'), 'utf8'));
  assert.deepEqual([current.version, current.previous], [second.id, first.id]);
  assert.equal(fs.readFileSync(path.join(data, `state.json.pre-${second.id}`), 'utf8'), '{"schema":1}');
  assert.ok(fs.existsSync(path.join(prefix, 'app', first.id, 'omniforge-lab', 'server.mjs')), 'side by side');
  assert.ok(out.some(line => line.includes('rollback')), out.join('\n'));

  const hint = [];
  assert.equal(rollback({ prefix, out: line => hint.push(line) }), 0);
  const back = JSON.parse(fs.readFileSync(path.join(prefix, 'current.json'), 'utf8'));
  assert.deepEqual([back.version, back.previous], [first.id, second.id]);
  assert.match(fs.readFileSync(path.join(prefix, 'omniforge.cmd'), 'utf8'), new RegExp(first.id.replaceAll('.', '\\.')));
  assert.ok(hint.some(line => line.includes(`state.json.pre-${second.id} `)), hint.join('\n'));

  // Work done after the rollback gets its own backup on the next update; the first one is kept.
  fs.writeFileSync(path.join(data, 'state.json'), '{"schema":1,"after":"rollback"}');
  assert.equal(update({ from: second.zip, prefix, exec: fakeExec(), out: () => {} }), 0);
  const backups = fs.readdirSync(data).filter(name => name.startsWith(`state.json.pre-${second.id}`)).sort();
  assert.deepEqual(backups.map(name => fs.readFileSync(path.join(data, name), 'utf8')).sort(), ['{"schema":1,"after":"rollback"}', '{"schema":1}']);
  // Rolling back this update points to the state taken just before it, not to the oldest backup.
  const again = [];
  assert.equal(rollback({ prefix, out: line => again.push(line) }), 0);
  const named = again.map(line => line.match(/(\S+state\.json\.pre-\S+)/)?.[1]).filter(Boolean);
  assert.equal(named.length, 1, again.join('\n'));
  assert.equal(fs.readFileSync(named[0], 'utf8'), '{"schema":1,"after":"rollback"}');
});

test('repair restores changed files from the recorded zip and lists stale locks without deleting them', t => {
  const dir = tmp(t, 'repair');
  const prefix = path.join(dir, 'OmniForge');
  const release = tinyZip(dir, '0.1.0', '1'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.rmSync(release.zip); // the download may be gone; the install keeps its own copy
  const lab = path.join(prefix, 'app', release.id, 'omniforge-lab');
  fs.writeFileSync(path.join(lab, 'server.mjs'), 'tampered');
  fs.unlinkSync(path.join(lab, 'index.html'));
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  const data = path.join(prefix, 'data');
  fs.writeFileSync(path.join(data, 'state.lock'), JSON.stringify({ pid: dead, nonce: 'gone' }));
  fs.writeFileSync(path.join(data, 'state.lock.stale-1234'), '{}');
  const lines = [];
  assert.equal(repair({ prefix, out: line => lines.push(line) }), 0);
  assert.equal(fs.readFileSync(path.join(lab, 'server.mjs'), 'utf8'), '// server 0.1.0\n');
  assert.equal(fs.readFileSync(path.join(lab, 'index.html'), 'utf8'), '<p>0.1.0</p>\n');
  const triage = lines.filter(line => /^\d+\. .+: .+; .+/.test(line));
  assert.equal(triage.length, 2, lines.join('\n'));
  assert.ok(triage.some(line => line.includes('state.lock:') && line.includes(String(dead))));
  assert.ok(fs.existsSync(path.join(data, 'state.lock')) && fs.existsSync(path.join(data, 'state.lock.stale-1234')));
});

test('uninstall prints triage by default, removes only recorded paths and reports residue', t => {
  const dir = tmp(t, 'uninstall');
  const tempDir = path.join(dir, 'temp');
  fs.mkdirSync(path.join(tempDir, 'omniforge-demo-abc123'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'omniforge-demo-run.log'), 'a log someone else wrote, not demo data');
  const outside = path.join(dir, 'outside.txt');
  fs.writeFileSync(outside, 'not ours');
  const prefix = path.join(dir, 'OmniForge');
  const release = tinyZip(dir, '0.1.0', '2'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(prefix, 'data', 'state.json'), '{"schema":1}');
  // A tampered record cannot widen what --apply deletes.
  const recordFile = path.join(prefix, 'install.json');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  record.created.push({ path: outside, kind: 'file' });
  fs.writeFileSync(recordFile, JSON.stringify(record));

  const dry = [];
  assert.equal(uninstall({ prefix, tempDir, out: line => dry.push(line) }), 0);
  assert.ok(dry.filter(line => /^\d+\. .+: .+; .+/.test(line)).length >= 4, dry.join('\n'));
  assert.ok(fs.existsSync(path.join(prefix, 'app', release.id)), 'dry run removes nothing');

  const applied = [];
  assert.equal(uninstall({ prefix, apply: true, tempDir, out: line => applied.push(line) }), 0);
  for (const gone of ['app', 'releases', 'current.json', 'install.json', 'omniforge.cmd']) assert.ok(!fs.existsSync(path.join(prefix, gone)), gone);
  assert.equal(fs.readFileSync(path.join(prefix, 'data', 'state.json'), 'utf8'), '{"schema":1}');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'not ours');
  const residue = applied.slice(applied.findIndex(line => /Residue/.test(line)));
  assert.ok(residue.some(line => line.includes(path.join(prefix, 'data'))), applied.join('\n'));
  assert.ok(residue.some(line => line.includes('omniforge-demo-abc123') && /never deleted/.test(line)), applied.join('\n'));
  assert.ok(!residue.some(line => line.includes('omniforge-demo-run.log')), 'demo data folders only');
  assert.ok(fs.existsSync(path.join(tempDir, 'omniforge-demo-abc123')));

  const prefix2 = path.join(dir, 'Second');
  install({ from: release.zip, prefix: prefix2, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(prefix2, 'data', 'state.json'), '{}');
  assert.equal(uninstall({ prefix: prefix2, apply: true, removeData: true, tempDir, out: () => {} }), 0);
  assert.ok(!fs.existsSync(prefix2), 'a prefix created by install is removed once empty');
});

test('uninstall treats a differently cased prefix as the same install and keeps data without --remove-data', t => {
  const dir = tmp(t, 'casing');
  const prefix = path.join(dir, 'OmniForge');
  const release = tinyZip(dir, '0.1.0', '5'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(prefix, 'data', 'state.json'), '{"schema":1}');
  const lower = prefix.toLowerCase();
  const dry = [];
  uninstall({ prefix: lower, tempDir: dir, out: line => dry.push(line) });
  assert.equal(uninstall({ prefix: lower, apply: true, tempDir: dir, out: () => {} }), 0);
  assert.equal(fs.readFileSync(path.join(prefix, 'data', 'state.json'), 'utf8'), '{"schema":1}');
  assert.ok(!fs.existsSync(path.join(prefix, 'app')));
  assert.ok(dry.some(line => line.includes(`${path.join(prefix, 'data')}: user data`)), dry.join('\n'));
  assert.ok(!dry.some(line => /ignored/.test(line)), dry.join('\n'));

  install({ from: release.zip, prefix: prefix.toUpperCase(), exec: fakeExec(), out: () => {} });
  const created = JSON.parse(fs.readFileSync(path.join(prefix, 'install.json'), 'utf8')).created;
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  assert.equal(JSON.parse(fs.readFileSync(path.join(prefix, 'install.json'), 'utf8')).created.length, created.length, 'no duplicate records');
});

test('a reinstall over kept data records it, so a later --remove-data removes it', t => {
  const dir = tmp(t, 'reinstall');
  const prefix = path.join(dir, 'OmniForge');
  const release = tinyZip(dir, '0.1.0', '6'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(prefix, 'data', 'state.json'), '{"schema":1}');
  uninstall({ prefix, apply: true, tempDir: dir, out: () => {} });
  assert.ok(fs.existsSync(path.join(prefix, 'data', 'state.json')));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  const lines = [];
  assert.equal(uninstall({ prefix, apply: true, removeData: true, tempDir: dir, out: line => lines.push(line) }), 0);
  assert.ok(!fs.existsSync(path.join(prefix, 'data')), lines.join('\n'));
  assert.ok(!lines.some(line => /no --remove-data/.test(line)), lines.join('\n'));
});

test('a data folder that existed before install is never recorded, and --remove-data leaves it', t => {
  const dir = tmp(t, 'foreign');
  const prefix = path.join(dir, 'Tools');
  const data = path.join(prefix, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'my-dataset.csv'), 'a,b\n');
  const release = tinyZip(dir, '0.1.0', '8'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  const created = JSON.parse(fs.readFileSync(path.join(prefix, 'install.json'), 'utf8')).created;
  assert.ok(!created.some(item => path.relative(item.path, data) === ''), JSON.stringify(created));
  const lines = [];
  assert.equal(uninstall({ prefix, apply: true, removeData: true, tempDir: dir, out: line => lines.push(line) }), 0);
  assert.equal(fs.readFileSync(path.join(data, 'my-dataset.csv'), 'utf8'), 'a,b\n');
  const residue = lines.slice(lines.findIndex(line => /Residue/.test(line)));
  assert.ok(residue.some(line => line.includes(`${data}: user data not recorded by install`)), lines.join('\n'));
});

test('the data guard covers paths inside data and never removes an ancestor of data recursively', t => {
  const dir = tmp(t, 'guard');
  const prefix = path.join(dir, 'OmniForge');
  const data = path.join(prefix, 'data');
  const release = tinyZip(dir, '0.1.0', '9'.repeat(40));
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(data, 'state.json'), '{"schema":1}');
  // A hand-edited or future-format record: the prefix as a tree, a file inside data, data with a trailing separator.
  const recordFile = path.join(prefix, 'install.json');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  record.created.push({ path: prefix, kind: 'tree' }, { path: path.join(data, 'state.json'), kind: 'file' }, { path: `${data}${path.sep}`, kind: 'tree' });
  fs.writeFileSync(recordFile, JSON.stringify(record));
  assert.equal(uninstall({ prefix, apply: true, tempDir: dir, out: () => {} }), 0);
  assert.equal(fs.readFileSync(path.join(data, 'state.json'), 'utf8'), '{"schema":1}');
  assert.ok(!fs.existsSync(path.join(prefix, 'app')));
});

// <dir>\alias is a junction to <dir>\real: the prefix has two spellings, as with an 8.3 or junction %TEMP%.
function aliased(t, name) {
  const dir = tmp(t, name);
  const real = path.join(dir, 'real');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(dir, 'alias'), 'junction');
  return { dir, real, alias: path.join(dir, 'alias'), release: tinyZip(dir, '0.1.0', '0f'.repeat(20)) };
}

const installed = ['app', 'releases', 'run', 'current.json', 'install.json', 'omniforge.cmd'];

test('install through a junction records canonical paths, and uninstall --apply by either spelling removes exactly them', t => {
  const { dir, real, alias, release } = aliased(t, 'alias');
  const prefix = path.join(real, 'OmniForge');
  install({ from: release.zip, prefix: path.join(alias, 'OmniForge'), exec: fakeExec(), out: () => {} });
  const recordFile = path.join(prefix, 'install.json');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.ok(record.created.every(item => contained(real, item.path)), JSON.stringify(record.created));
  // A record written before canonical recording keeps the alias spelling install was given; the launcher
  // resolves its prefix from its own real path.
  record.created = record.created.map(item => ({ ...item, path: path.join(alias, path.relative(real, item.path)) }));
  fs.writeFileSync(recordFile, JSON.stringify(record));
  fs.writeFileSync(path.join(prefix, 'notes.txt'), 'mine, never recorded');
  const lines = [];
  assert.equal(uninstall({ prefix, apply: true, tempDir: dir, out: line => lines.push(line) }), 0);
  for (const gone of installed) assert.ok(!fs.existsSync(path.join(prefix, gone)), `${gone}\n${lines.join('\n')}`);
  assert.deepEqual(fs.readdirSync(prefix).sort(), ['data', 'notes.txt'], lines.join('\n'));
  assert.ok(!lines.some(line => /ignored/.test(line)), lines.join('\n'));
});

test('a recorded path that is inside the prefix only as text, through a junction it holds, is never removed', t => {
  const { dir, real, alias, release } = aliased(t, 'escape');
  const prefix = path.join(real, 'OmniForge');
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  const victim = path.join(dir, 'victim');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'keep.txt'), 'not ours');
  fs.symlinkSync(victim, path.join(prefix, 'escape'), 'junction');
  const recordFile = path.join(prefix, 'install.json');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  // Spelled like the prefix uninstall is given: contained as text, outside on disk.
  const tampered = path.join(alias, 'OmniForge', 'escape', 'keep.txt');
  record.created.push({ path: tampered, kind: 'file' }, { path: path.join(alias, 'OmniForge', 'escape'), kind: 'tree' });
  fs.writeFileSync(recordFile, JSON.stringify(record));
  const lines = [];
  assert.equal(uninstall({ prefix: path.join(alias, 'OmniForge'), apply: true, removeData: true, tempDir: dir, out: line => lines.push(line) }), 0);
  assert.equal(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8'), 'not ours');
  for (const gone of [...installed, 'data']) assert.ok(!fs.existsSync(path.join(prefix, gone)), `${gone}\n${lines.join('\n')}`);
  assert.deepEqual(fs.readdirSync(prefix), ['escape'], lines.join('\n'));
  assert.ok(lines.some(line => line.includes(`. ${path.join(victim, 'keep.txt')}: outside `) && /; ignored, never removed$/.test(line)), lines.join('\n'));
  assert.ok(lines.some(line => line.includes(`. ${path.join(prefix, 'escape')}: a link, not what install created; left in place`)), lines.join('\n'));
});

test('a recorded folder replaced by a link inside the prefix is left in place, and so is what it points to', t => {
  for (const removeData of [false, true]) {
    const dir = tmp(t, `link-${removeData}`);
    const prefix = path.join(dir, 'OmniForge');
    // data\ existed before install, so it is not recorded; notes\ is the user's own folder.
    const data = path.join(prefix, 'data');
    const notes = path.join(prefix, 'notes');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'state.json'), '{"schema":1}');
    install({ from: tinyZip(dir, '0.1.0', 'ab'.repeat(20)).zip, prefix, exec: fakeExec(), out: () => {} });
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, 'mine.txt'), 'mine');
    const app = path.join(prefix, 'app', JSON.parse(fs.readFileSync(path.join(prefix, 'current.json'), 'utf8')).version);
    const links = [[app, data], [path.join(prefix, 'run'), notes]];
    for (const [link, target] of links) {
      fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(target, link, 'junction');
    }
    const lines = [];
    assert.equal(uninstall({ prefix, apply: true, removeData, tempDir: dir, out: line => lines.push(line) }), 0);
    const log = `--remove-data ${removeData}\n${lines.join('\n')}`;
    assert.equal(fs.readFileSync(path.join(data, 'state.json'), 'utf8'), '{"schema":1}', log);
    assert.equal(fs.readFileSync(path.join(notes, 'mine.txt'), 'utf8'), 'mine', log);
    for (const [link] of links) {
      assert.ok(fs.lstatSync(link).isSymbolicLink(), log);
      assert.ok(lines.some(line => line.includes(`. ${link}: a link, not what install created; left in place`)), log);
    }
    assert.ok(!fs.existsSync(path.join(prefix, 'releases')), log);
  }
});

test('reinstalling the current build keeps the backup that rollback names', t => {
  const dir = tmp(t, 'rebackup');
  const prefix = path.join(dir, 'OmniForge');
  const first = tinyZip(dir, '0.1.0', 'ab'.repeat(20));
  const second = tinyZip(path.join(dir, 'next'), '0.2.0', 'cd'.repeat(20));
  install({ from: first.zip, prefix, exec: fakeExec(), out: () => {} });
  fs.writeFileSync(path.join(prefix, 'data', 'state.json'), '{"schema":1}');
  update({ from: second.zip, prefix, exec: fakeExec(), out: () => {} });
  install({ from: second.zip, prefix, exec: fakeExec(), out: () => {} });
  const hint = [];
  assert.equal(rollback({ prefix, out: line => hint.push(line) }), 0);
  assert.ok(hint.some(line => line.includes(`state.json.pre-${second.id} `)), hint.join('\n'));
});

test('uninstall --apply refuses while a demo started from this install runs', async t => {
  const dir = tmp(t, 'live-demo');
  const prefix = path.join(dir, 'OmniForge');
  // A demo holds no data lock; the real one keeps conpty.node from the app folder loaded.
  const demo = "export async function startDemo() { return { app: { close: async () => {} }, dataDir: 'none', url: 'http://127.0.0.1:9/?token=0' }; }\n";
  const release = tinyZip(dir, '0.1.0', 'ef'.repeat(20), { real: true, files: { 'omniforge-lab/demo.mjs': demo } });
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  const manager = path.join(prefix, 'app', release.id, 'omniforge-lab', 'manage.mjs');
  const child = spawn(process.execPath, [manager, 'start', '--demo', '--stop-on-eof', '--prefix', prefix],
    { env: { ...process.env, OMNIHARNESS_PYTHON: 'python' }, windowsHide: true });
  t.after(() => child.kill());
  const exited = new Promise(resolve => child.once('exit', resolve));
  let text = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { text += chunk; if (/OmniForge Demo:/.test(text)) resolve(); });
    exited.then(code => reject(new Error(`start exited ${code}: ${text}`)));
  });
  assert.throws(() => uninstall({ prefix, apply: true, tempDir: dir, out: () => {} }), /running/);
  assert.ok(fs.existsSync(manager), 'nothing removed while the demo runs');
  child.stdin.end();
  assert.equal(await exited, 0);
  // A record left by a killed start names a dead pid and does not block.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(path.join(prefix, 'run', `${dead}.json`), JSON.stringify({ pid: dead }));
  assert.equal(uninstall({ prefix, apply: true, removeData: true, tempDir: dir, out: () => {} }), 0);
  assert.ok(!fs.existsSync(prefix));
});

// The acceptance script ends with uninstall --apply --remove-data, so it must never reach an existing install.
function acceptance(t, args, { location, cwd } = {}) {
  const dir = tmp(t, 'acceptance');
  const env = { ...process.env, TEMP: path.join(dir, 'temp'), TMP: path.join(dir, 'temp'), LOCALAPPDATA: path.join(dir, 'local') };
  env.Path = `${path.dirname(process.execPath)};${process.env.Path ?? process.env.PATH ?? ''}`;
  // As on CI, where the step shell is PowerShell 7: it puts its own Microsoft.PowerShell.Utility first on
  // PSModulePath, Windows PowerShell inherits that through npm and node and cannot load it. Stand-in for that
  // Core-only manifest, exporting the Utility cmdlets the script calls as the real one does.
  const ps7 = path.join(dir, 'ps7-modules', 'Microsoft.PowerShell.Utility');
  fs.mkdirSync(ps7, { recursive: true });
  const cmdlets = ['Get-Date', 'New-Object', 'Sort-Object', 'Select-Object', 'Get-FileHash', 'Select-String', 'Write-Host',
    'Invoke-WebRequest', 'ConvertFrom-Json', 'ConvertTo-Json'].map(name => `'${name}'`).join(', ');
  fs.writeFileSync(path.join(ps7, 'Microsoft.PowerShell.Utility.psd1'), `@{ ModuleVersion = '7.0.0.0'; CompatiblePSEditions = @('Core'); ` +
    `CmdletsToExport = @(${cmdlets}); NestedModules = @('Microsoft.PowerShell.Commands.Utility.dll') }\n`);
  env.PSModulePath = `${path.dirname(ps7)};${process.env.PSModulePath ?? ''}`;
  fs.mkdirSync(env.TEMP);
  fs.mkdirSync(env.LOCALAPPDATA);
  const output = path.join(dir, 'out');
  const script = fileURLToPath(new URL('../../scripts/sandbox/run-in-sandbox.ps1', import.meta.url));
  const argv = ['-Output', output, ...args(dir)];
  // With a location it runs like an interactive session: Set-Location moves PowerShell, not the process directory.
  const shell = location
    ? ['-Command', `Set-Location -LiteralPath '${location(dir)}'; & '${script}' ${argv.map(arg => arg.startsWith('-') ? arg : `'${arg}'`).join(' ')}; exit $LASTEXITCODE`]
    : ['-File', script, ...argv];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...shell],
    { encoding: 'utf8', env, cwd: cwd?.(dir), timeout: 180_000 });
  // Where the run stopped, for an assertion message: no env, the start token redacted as the script does.
  const trail = report => JSON.stringify({ exit: result.status, spawn: result.error?.message, error: report?.error, steps: report?.steps,
    stdout: String(result.stdout ?? '').slice(-3000) }, null, 1).replace(/token=[0-9a-f]+/g, 'token=<redacted>');
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8').replace(/^﻿/, '')); }
  catch (error) { assert.fail(`no readable report.json (${error.code ?? error.message}): ${trail()}`); }
  return { dir, env, result, report, trail: () => trail(report) };
}

test('the acceptance script defaults to a fresh TEMP prefix, never %LOCALAPPDATA%', t => {
  const { env, result, report } = acceptance(t, dir => { fs.mkdirSync(path.join(dir, 'empty')); return ['-Release', path.join(dir, 'empty')]; });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(contained(env.TEMP, report.prefix) && /omniforge-acceptance-/.test(report.prefix), report.prefix);
});

test('the acceptance script refuses an existing prefix before installing anything', t => {
  let prefix;
  const { result, report } = acceptance(t, dir => {
    const release = tinyZip(path.join(dir, 'release'), '0.1.0', '7'.repeat(40), { real: true });
    prefix = path.join(dir, 'OmniForge');
    install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
    fs.writeFileSync(path.join(prefix, 'data', 'state.json'), '{"schema":1}');
    return ['-Release', path.dirname(release.zip), '-Prefix', prefix];
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(report.error, /already exists/);
  assert.deepEqual([].concat(report.steps ?? []), [], JSON.stringify(report.steps));
  assert.equal(fs.readFileSync(path.join(prefix, 'data', 'state.json'), 'utf8'), '{"schema":1}');
});

test('the acceptance script resolves a relative -Prefix once, where PowerShell stands', t => {
  let before;
  const { dir, report } = acceptance(t, dir => {
    const release = tinyZip(path.join(dir, 'release'), '0.1.0', '12'.repeat(20), { real: true });
    fs.mkdirSync(path.join(dir, 'here'));
    // An install where the process directory, not the PowerShell location, would put "rel".
    install({ from: release.zip, prefix: path.join(dir, 'proc', 'rel'), exec: fakeExec(), out: () => {} });
    before = fs.readFileSync(path.join(dir, 'proc', 'rel', 'current.json'), 'utf8');
    return ['-Release', path.dirname(release.zip), '-Prefix', 'rel'];
  }, { location: dir => path.join(dir, 'here'), cwd: dir => path.join(dir, 'proc') });
  assert.equal(report.prefix, path.join(dir, 'here', 'rel'));
  assert.equal(fs.readFileSync(path.join(dir, 'proc', 'rel', 'current.json'), 'utf8'), before);
});

test('the acceptance script kills the whole start tree on timeout and reports the portable Node folder', t => {
  const { env, report, trail } = acceptance(t, dir => {
    // A Lab that never prints its URL; it leaves its pid so the test can see whether it outlived the run.
    const server = "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';\n" +
      "export function createOmniForgeServer() { fs.writeFileSync(path.join(os.tmpdir(), 'hung-lab.pid'), String(process.pid)); setInterval(() => {}, 1000); return { listen: () => new Promise(() => {}), close: async () => {} }; }\n";
    const release = tinyZip(path.join(dir, 'release'), '0.1.0', '34'.repeat(20), { real: true, files: { 'omniforge-lab/server.mjs': server } });
    const name = 'node-v99.0.0-win-x64';
    fs.mkdirSync(path.join(dir, 'node', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node', name, 'README.md'), 'stand-in for the portable Node folder\n');
    const nodeZip = path.join(path.dirname(release.zip), `${name}.zip`);
    assert.equal(spawnSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', nodeZip, '-C', path.join(dir, 'node'), name]).status, 0);
    fs.writeFileSync(path.join(path.dirname(release.zip), 'SHASUMS256.txt'), `${createHash('sha256').update(fs.readFileSync(nodeZip)).digest('hex')}  ${name}.zip\n`);
    return ['-Release', path.dirname(release.zip), '-PortableNode', '-StartTimeoutSeconds', '10'];
  });
  const pidFile = path.join(env.TEMP, 'hung-lab.pid');
  assert.ok(fs.existsSync(pidFile), `the run stopped before the Lab started: ${trail()}`);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid); } catch { /* already gone */ } });
  assert.match(report.error, /did not print its URL/, trail());
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `the hung Lab (pid ${pid}) outlived the run`);
  const residue = [].concat(report.residue ?? []);
  assert.ok(residue.some(line => line.startsWith(`${path.join(env.TEMP, 'omniforge-portable-node')}:`)), JSON.stringify(residue));
});

test('the installed launcher survives uninstall deleting its own folder', t => {
  const dir = tmp(t, 'launcher');
  const prefix = path.join(dir, 'Omni Forge');
  const release = tinyZip(dir, '0.1.0', '4'.repeat(40), { real: true });
  install({ from: release.zip, prefix, exec: fakeExec(), out: () => {} });
  // cmd re-reads a running batch after each external command; a deleted batch folder used to print
  // "The system cannot find the path specified" and turn the exit code into 1.
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${path.join(prefix, 'omniforge.cmd')}" uninstall --apply --remove-data 2>&1"`],
    { encoding: 'utf8', windowsVerbatimArguments: true, cwd: dir });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Residue after uninstall:/);
  assert.doesNotMatch(result.stdout.split('Node.js, Python, Git and the host CLIs were not touched.')[1], /\S/);
  assert.ok(!fs.existsSync(prefix), result.stdout);
});

test('run skips a .bat/.cmd shim that Node cannot start without a shell and finds the real program later on PATH', t => {
  if (process.platform !== 'win32') return;
  const shims = tmp(t, 'shim'), real = tmp(t, 'real');
  fs.writeFileSync(path.join(shims, 'omni-shimmed.bat'), '@echo shim');
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'hostname.exe'), path.join(real, 'omni-shimmed.exe'));
  const saved = process.env.PATH;
  process.env.PATH = [shims, real, saved].join(path.delimiter);
  try {
    const result = run('omni-shimmed');
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0);
    assert.ok(result.stdout.trim().length > 0);
  } finally { process.env.PATH = saved; }
});

// A harness/*.py file that RUNTIME ships must not import a harness module RUNTIME leaves behind:
// git archive has no __init__.py to pull siblings in, so a missing entry is a runtime ModuleNotFoundError.
test('RUNTIME ships every harness module its own harness/*.py entries import', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const pyEntries = new Set(RUNTIME.filter(entry => entry.startsWith('harness/') && entry.endsWith('.py')));
  for (const entry of pyEntries) {
    const source = fs.readFileSync(path.join(repoRoot, entry), 'utf8');
    for (const match of source.matchAll(/^\s*(?:from harness\.(\w+) import|import harness\.(\w+))/gm)) {
      const dep = `harness/${match[1] || match[2]}.py`;
      assert.ok(dep === entry || pyEntries.has(dep), `${entry} imports ${dep}, which RUNTIME does not ship`);
    }
  }
});

// manage.mjs is documented as a two-file bootstrap (scripts/omniforge.cmd + omniforge-lab/manage.mjs,
// INSTALL.md's Install step 2, reused by Update); the tar command must also extract every relative
// module manage.mjs imports, or the documented bootstrap fails before doing anything.
test('INSTALL.md bootstrap tar command extracts every relative module manage.mjs imports', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const manageSource = fs.readFileSync(path.join(repoRoot, 'omniforge-lab', 'manage.mjs'), 'utf8');
  const needed = new Set();
  for (const match of manageSource.matchAll(/from '\.\/([^']+)'/g)) needed.add(path.posix.join('omniforge-lab', path.posix.dirname(match[1])));
  assert.ok(needed.size > 0, 'expected manage.mjs to have at least one relative import to guard');
  const install = fs.readFileSync(path.join(repoRoot, 'docs', 'omniforge', 'INSTALL.md'), 'utf8');
  const tarLine = install.split('\n').find(line => line.includes('tar -x') && line.includes('omniforge-lab/manage.mjs'));
  assert.ok(tarLine, 'INSTALL.md bootstrap tar command not found');
  for (const dir of needed) assert.ok(tarLine.includes(dir), `${JSON.stringify(tarLine)} is missing ${dir}`);
});
