import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { doctor, pack, archive, install, update, rollback, repair, uninstall } from '../manage.mjs';

const PINNED = '1.2.0-beta.15';

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omniforge-manage-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A tiny release: the real layout with stand-in files, zipped and hashed by the production archive().
// With real = true it carries the real manager and entry script, so the installed launcher works.
function tinyZip(dir, version, sha, { real = false } = {}) {
  const root = path.join(dir, `root-${version}`);
  fs.mkdirSync(path.join(root, 'omniforge-lab'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'package.json'), JSON.stringify({ version, dependencies: { 'node-pty': PINNED } }));
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'server.mjs'), `// server ${version}\n`);
  fs.writeFileSync(path.join(root, 'omniforge-lab', 'index.html'), `<p>${version}</p>\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'omniforge.cmd'), '@echo off\r\n');
  if (real) {
    fs.copyFileSync(new URL('../manage.mjs', import.meta.url), path.join(root, 'omniforge-lab', 'manage.mjs'));
    fs.copyFileSync(new URL('../../scripts/omniforge.cmd', import.meta.url), path.join(root, 'scripts', 'omniforge.cmd'));
  }
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

// The acceptance script ends with uninstall --apply --remove-data, so it must never reach an existing install.
function acceptance(t, args) {
  const dir = tmp(t, 'acceptance');
  const env = { ...process.env, TEMP: path.join(dir, 'temp'), TMP: path.join(dir, 'temp'), LOCALAPPDATA: path.join(dir, 'local') };
  env.Path = `${path.dirname(process.execPath)};${process.env.Path ?? process.env.PATH ?? ''}`;
  fs.mkdirSync(env.TEMP);
  fs.mkdirSync(env.LOCALAPPDATA);
  const output = path.join(dir, 'out');
  const script = fileURLToPath(new URL('../../scripts/sandbox/run-in-sandbox.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Output', output, ...args(dir)],
    { encoding: 'utf8', env, timeout: 180_000 });
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8').replace(/^﻿/, ''));
  return { dir, env, result, report };
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
