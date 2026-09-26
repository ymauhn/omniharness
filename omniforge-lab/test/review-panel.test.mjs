import test from 'node:test';
import assert from 'node:assert/strict';
import './support/browser-globals.mjs';
import { classifyPatch, describeAttempt, describeGauntlet, gauntletSignals, usageText, createReviewPanel } from '../app/review-panel.mjs';

// The review panel's pure parts, then the panel itself against a minimal DOM seam (the same kind of fake as
// page-rerender.test.mjs): only what the panel touches. Diff and evidence content is untrusted agent output,
// so nothing here has an innerHTML; a render that used it would leave the text missing.
class Element {
  constructor(tag) { Object.assign(this, { tag, className: '', children: [], parent: null, dataset: {}, attributes: {}, events: {}, hidden: false, value: '', disabled: false, _text: '' }); }
  append(...nodes) { for (const node of nodes) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...nodes); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  fire(name) { return Promise.all((this.events[name] || []).map(callback => callback({ currentTarget: this, target: this, preventDefault() {} }))); }
  focus() { doc.activeElement = this; }
  scrollIntoView(options) { doc.scrolledTo = { node: this, options }; }
  contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter(node => selector === '[data-focus-key]' ? 'focusKey' in node.dataset : node.tag === selector); }
}
let doc;
const tick = () => new Promise(resolve => setImmediate(resolve));

function environment({ storage = new Map() } = {}) {
  doc = { activeElement: null, body: new Element('body'), createElement: tag => new Element(tag), querySelectorAll: () => [] };
  globalThis.document = doc;
  const env = { projectId: 'a', calls: [], pending: [], storage, toasts: [] };
  env.tasks = new Map([['t', { id: 't', projectId: 'a', title: 'Saudação', revision: 3, worktree: 'C:\\wt' }]]);
  // Every request stays pending until the test answers it, so a test can act between the request and its reply.
  const api = (route, { method = 'GET', body } = {}) => new Promise((resolve, reject) => { env.calls.push({ route, method, body }); env.pending.push({ route, resolve, reject }); });
  env.answer = async (route, value) => {
    const index = env.pending.findIndex(request => request.route === route);
    assert.ok(index >= 0, `no pending ${route}`);
    const [request] = env.pending.splice(index, 1);
    if (value instanceof Error) request.reject(value); else request.resolve(value);
    await tick();
  };
  env.root = new Element('section'); env.root.hidden = true; doc.body.append(env.root);
  const store = { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, value) };
  // The Gauntlet run as the fleet's run list holds it (live from the agent SSE).
  env.gauntlet = null;
  env.panel = createReviewPanel({ root: env.root, api, getProjectId: () => env.projectId, getTask: id => env.tasks.get(id), toast: text => env.toasts.push(text), storage: store,
    getGauntlet: id => (env.gauntlet?.taskId === id ? env.gauntlet : null) });
  env.find = key => env.root.descendants().find(node => node.dataset.focusKey === key);
  env.text = () => env.root.textContent;
  env.form = () => env.root.descendants().find(node => node.tag === 'form');
  env.outcome = () => env.root.descendants().find(node => node.className.includes('review-outcome'));
  return env;
}

const diff = (extra = {}) => ({ baseSha: 'b'.repeat(40), branch: 'omniforge/t-1', stat: { files: 1, additions: 1, deletions: 0 }, truncated: false,
  files: [{ path: 'agent-call.json', status: 'A', additions: 1, deletions: 0, binary: false }], patch: 'diff --git a/agent-call.json b/agent-call.json\n@@ -0,0 +1 @@\n+{}\n', ...extra });
const refusal = message => Object.assign(new Error(message), { status: 409 });

test('patch lines are classified by their place in the patch, not by their first characters alone', () => {
  const lines = [
    'diff --git a/x.txt b/x.txt', 'new file mode 100644', '--- /dev/null', '+++ b/x.txt', '@@ -0,0 +1,3 @@',
    '+one', '++++ an added line that starts with plus signs', '--- a removed line that looks like a header', ' context', '\\ No newline at end of file',
    'diff --git a/bin b/bin', 'Binary files /dev/null and b/bin differ', 'diff --git a/y b/y', '--- a/y', '+++ b/y', '@@ -1 +1 @@', '-old', '+new',
  ];
  const rows = classifyPatch(`${lines.join('\n')}\n`);
  assert.deepEqual(rows.map(row => row.text), lines, 'every line keeps its exact text; the trailing newline adds no row');
  assert.deepEqual(rows.map(row => row.kind), [
    'file', 'meta', 'meta', 'meta', 'hunk', 'add', 'add', 'del', 'context', 'meta',
    'file', 'meta', 'file', 'meta', 'meta', 'hunk', 'del', 'add',
  ]);
  assert.deepEqual(classifyPatch(''), []);
});

test('an attempt is described with its result, test, diff stat, usage, note and time', () => {
  const merged = describeAttempt({ at: '2026-09-26T12:00:00.000Z', host: 'claude', branch: 'omniforge/t-1', headSha: 'c'.repeat(40), mergeSha: 'a'.repeat(40), refused: null,
    diffStat: { files: 2, additions: 3, deletions: 1 }, note: 'Revisado à mão',
    test: { command: 'npm test', exitCode: 0, timedOut: false, outputSha256: 'f'.repeat(64), outputTail: 'ok 1\n' },
    usage: { status: 'observed', inputTokens: 11, outputTokens: 7, cacheReadTokens: 103, cacheCreationTokens: 24, source: 'x', reason: null } });
  assert.equal(merged.kind, 'merged');
  assert.match(merged.title, new RegExp(`Merge ${'a'.repeat(40)}`));
  const details = merged.details.join('\n');
  for (const part of ['Claude', 'omniforge/t-1', 'npm test', 'código 0', `SHA-256 da saída ${'f'.repeat(64)}`, '2 arquivos', '+3', '−1', 'observado', '11', '103', 'Revisado à mão']) {
    assert.ok(details.includes(part), `details show ${part}: ${details}`);
  }
  assert.equal(merged.output, 'ok 1\n');
  assert.equal(merged.at, '2026-09-26T12:00:00.000Z');
  assert.ok(merged.when.includes('2026'), merged.when);

  const refused = describeAttempt({ at: '2026-09-26T12:05:00.000Z', host: 'codex', refused: { reason: 'O comando de teste excedeu o tempo limite' }, mergeSha: null, headSha: null,
    test: { command: 'Start-Sleep 999', exitCode: null, timedOut: true, outputSha256: 'e'.repeat(64), outputTail: '' },
    usage: { status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, source: null, reason: 'Transcrição não encontrada' }, diffStat: null, note: null });
  assert.equal(refused.kind, 'refused');
  assert.match(refused.title, /Recusado: O comando de teste excedeu o tempo limite/);
  assert.match(refused.details.join('\n'), /tempo esgotado/);
  assert.match(refused.details.join('\n'), /desconhecido: Transcrição não encontrada/);
  assert.equal(refused.output, null, 'an empty tail shows no output block');
  assert.equal(describeAttempt({ at: 'x', refused: null, mergeSha: null }).kind, 'refused', 'an attempt without a merge SHA never reads as merged');
  // test is recorded only once the command ran: a refusal before it must not say the reviewer gave none.
  assert.ok(describeAttempt({ at: 'x', refused: { reason: 'Nada para integrar' }, mergeSha: null }).details.includes('Teste não executado'));
  assert.ok(describeAttempt({ at: 'x', refused: null, mergeSha: 'a'.repeat(40) }).details.includes('Sem comando de teste'));
});

test('unknown usage never reads as zero tokens', () => {
  assert.equal(usageText(null), 'desconhecido: sem registro de uso');
  assert.equal(usageText({ status: 'unknown', inputTokens: 0, reason: 'Sessão não encontrada' }), 'desconhecido: Sessão não encontrada');
  const partial = usageText({ status: 'observed', inputTokens: 5, outputTokens: null, cacheReadTokens: 0, cacheCreationTokens: null });
  assert.match(partial, /^observado: /);
  assert.match(partial, /saída desconhecida/);
  assert.match(partial, /cache lido 0/, 'an observed zero stays zero');
});

test('the diff renders as text, with each patch line classified and a truncation notice', async () => {
  const env = environment();
  env.panel.open('t');
  assert.equal(env.root.hidden, false);
  assert.deepEqual(env.calls.map(call => call.route), ['/api/tasks/t/diff', '/api/tasks/t/evidence']);
  const hostile = '+<img src=x onerror="alert(1)">';
  await env.answer('/api/tasks/t/diff', diff({ patch: `diff --git a/a b/a\n@@ -0,0 +1 @@\n${hostile}\n`, truncated: true,
    files: [{ path: 'a', status: 'A', additions: 1, deletions: 0, binary: false }, { path: 'blob.bin', status: 'M', additions: 0, deletions: 0, binary: true }] }));
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  const lines = env.root.descendants().filter(node => node.dataset.kind && node.tag === 'span');
  assert.deepEqual(lines.map(node => [node.dataset.kind, node.textContent]), [['file', 'diff --git a/a b/a\n'], ['hunk', '@@ -0,0 +1 @@\n'], ['add', `${hostile}\n`]]);
  assert.match(env.text(), /blob\.bin/);
  assert.match(env.text(), /binário/);
  assert.match(env.text(), /modificado/);
  assert.match(env.text(), /truncado/i);
  assert.match(env.text(), /Nenhuma tentativa de merge/);
});

test('a reply that arrives after a project switch never renders in the other project', async () => {
  const env = environment();
  env.panel.open('t');
  env.projectId = 'b';
  env.panel.sync();
  assert.equal(env.root.hidden, true, 'a project switch closes the panel');
  assert.equal(env.text(), '', 'and clears it');
  await env.answer('/api/tasks/t/diff', diff({ files: [{ path: 'SEGREDO_A.txt', status: 'A', additions: 1, deletions: 0, binary: false }], patch: '+SEGREDO_A\n' }));
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [{ at: 'x', refused: { reason: 'SEGREDO_A' } }] });
  assert.equal(env.root.hidden, true);
  assert.doesNotMatch(env.text(), /SEGREDO_A/);

  // The same guard holds for a merge answered after the switch.
  env.projectId = 'a';
  env.panel.open('t');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  void env.form().fire('submit');
  env.projectId = 'b';
  env.panel.sync();
  await env.answer('/api/tasks/t/merge', refusal('RECUSA_DO_PROJETO_A'));
  assert.equal(env.root.hidden, true);
  assert.doesNotMatch(env.text(), /RECUSA_DO_PROJETO_A/);
  assert.deepEqual(env.toasts, [], 'nor announced');
});

test('merge: one request at a time, the refusal shows and keeps the inputs, success shows the merge SHA', async () => {
  const env = environment();
  env.panel.open('t');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  const command = env.find('test-command'), note = env.find('note');
  command.value = 'exit 3'; await command.fire('input');
  note.value = 'Conferi o diff'; await note.fire('input');
  void env.form().fire('submit');
  void env.form().fire('submit');
  const merges = () => env.calls.filter(call => call.route === '/api/tasks/t/merge');
  assert.equal(merges().length, 1, 'a second submit while the first runs is ignored');
  assert.deepEqual(merges()[0].body, { expectedRevision: 3, testCommand: 'exit 3', note: 'Conferi o diff' });
  assert.equal(env.find('merge').disabled, true, 'the button is disabled while the merge runs');
  assert.equal(env.storage.get('omniforge-review-test:a'), 'exit 3', 'the test command is remembered for this project');

  await env.answer('/api/tasks/t/merge', refusal('O comando de teste falhou (código 3)'));
  assert.match(env.outcome().textContent, /Merge recusado: O comando de teste falhou \(código 3\)/);
  assert.equal(env.outcome().dataset.kind, 'refused');
  assert.deepEqual(env.toasts, [env.outcome().textContent], 'the outcome is announced once');
  assert.equal(env.find('test-command').value, 'exit 3', 'the refusal keeps the test command');
  assert.equal(env.find('note').value, 'Conferi o diff', 'and the note');
  assert.equal(env.find('merge').disabled, false);
  assert.ok(env.pending.some(request => request.route === '/api/tasks/t/evidence'), 'the evidence reloads after the attempt');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });

  env.tasks.get('t').revision = 4;
  env.find('test-command').value = ''; await env.find('test-command').fire('input');
  void env.form().fire('submit');
  assert.deepEqual(merges()[1].body, { expectedRevision: 4, testCommand: null, note: 'Conferi o diff' }, 'expectedRevision is the current one');
  await env.answer('/api/tasks/t/merge', { task: {}, attempt: { mergeSha: 'd'.repeat(40) } });
  assert.match(env.outcome().textContent, new RegExp(`Merge concluído: ${'d'.repeat(40)}`));
  assert.equal(env.outcome().dataset.kind, 'merged');
  assert.equal(env.find('note').value, '', 'a successful merge drops the note');
});

test('the last test command is per project and storage failures never break the panel', async () => {
  const storage = new Map([['omniforge-review-test:a', 'npm test']]);
  const env = environment({ storage });
  env.panel.open('t');
  assert.equal(env.find('test-command').value, 'npm test');
  env.tasks.set('u', { id: 'u', projectId: 'b', title: 'Outra', revision: 1, worktree: 'C:\\wt2' });
  env.projectId = 'b'; env.panel.sync(); env.panel.open('u');
  assert.equal(env.find('test-command').value, '', 'another project does not inherit the command');

  const broken = environment();
  const answers = route => (route.endsWith('/diff') ? diff() : route.endsWith('/evidence') ? { attempts: [] } : { attempt: { mergeSha: 'f'.repeat(40) } });
  broken.panel = createReviewPanel({ root: broken.root, api: async route => answers(route), getProjectId: () => 'a', getTask: id => broken.tasks.get(id),
    storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  broken.panel.open('t');
  assert.equal(broken.find('test-command').value, '');
  broken.find('test-command').value = 'npm test';
  await broken.form().fire('submit');
  await tick();
  assert.match(broken.outcome().textContent, /Merge concluído/);
});

test('live refresh: an evidence event for its task and a new task revision reload the open panel, keeping focus and drafts', async () => {
  const env = environment();
  env.panel.open('t');
  assert.equal(doc.activeElement, env.find('heading'), 'opening moves focus to the panel heading');
  assert.deepEqual(doc.scrolledTo, { node: env.root, options: { block: 'start' } }, 'and brings the panel top into view (instant: no smooth scroll)');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  const command = env.find('test-command');
  command.value = 'npm run check'; await command.fire('input'); command.focus();

  env.panel.onEvidence({ taskId: 'other', projectId: 'a' });
  env.panel.sync();
  assert.equal(env.pending.length, 0, 'another task or an unchanged revision reloads nothing');

  env.panel.onEvidence({ taskId: 't', projectId: 'a' });
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [{ at: '2026-09-26T12:00:00.000Z', refused: { reason: 'Nada para integrar' }, mergeSha: null }] });
  assert.match(env.text(), /Recusado: Nada para integrar/);
  assert.notEqual(env.find('test-command'), command, 'the panel was rebuilt');
  assert.equal(doc.activeElement, env.find('test-command'), 'focus returns to the same control');
  assert.equal(env.find('test-command').value, 'npm run check', 'the typed command survives');

  env.tasks.get('t').revision = 5;
  env.panel.sync();
  assert.deepEqual(env.pending.map(request => request.route), ['/api/tasks/t/diff', '/api/tasks/t/evidence'], 'a changed task reloads');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [
    { at: '2026-09-26T12:00:00.000Z', refused: { reason: 'PRIMEIRA' } }, { at: '2026-09-26T12:01:00.000Z', refused: null, mergeSha: 'e'.repeat(40) }] });
  const text = env.text();
  assert.ok(text.indexOf('e'.repeat(40)) < text.indexOf('PRIMEIRA'), 'attempts are listed newest first');

  env.tasks.delete('t');
  env.panel.sync();
  assert.equal(env.root.hidden, true, 'a removed task closes the panel');
});

test('a merge running for one task never shows as running on another task', async () => {
  const env = environment();
  env.tasks.set('u', { id: 'u', projectId: 'a', title: 'Outra', revision: 1, worktree: 'C:\wt2' });
  env.panel.open('t');
  await env.answer('/api/tasks/t/diff', diff());
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  void env.form().fire('submit');
  env.panel.open('u');
  await env.answer('/api/tasks/u/diff', diff());
  await env.answer('/api/tasks/u/evidence', { taskId: 'u', attempts: [] });
  assert.equal(env.form().attributes['aria-busy'], 'false');
  assert.doesNotMatch(env.find('merge').textContent, /Executando/);
  assert.equal(env.find('merge').disabled, true, 'one merge at a time in this page');
  assert.match(env.find('merge').textContent, /Aguardando outro merge/);
});

test('Gauntlet signals are deterministic: a sensitive path, a diff over 400 changed lines, or a last merge that failed its test', () => {
  const file = (path, additions = 1, deletions = 0) => ({ path, status: 'M', additions, deletions, binary: false });
  const changes = (...files) => ({ files, stat: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) } });
  assert.deepEqual(gauntletSignals(changes(file('README.md')), []), []);
  assert.deepEqual(gauntletSignals(null, null), [], 'nothing loaded, nothing suggested');
  for (const path of ['src/auth.mjs', 'lib/Token-store.js', 'secrets.env', 'key-vault.mjs', 'permissions.json', 'extension-sandbox.mjs', 'credentials/x']) {
    assert.equal(gauntletSignals(changes(file(path)), []).length, 1, path);
  }
  const many = gauntletSignals(changes(...['a/auth.js', 'b/token.js', 'c/secret.js', 'd/key.js'].map(path => file(path))), []);
  assert.deepEqual(many, ['mexe em caminho sensível (a/auth.js, b/token.js, c/secret.js, …)']);
  assert.deepEqual(gauntletSignals(changes(file('a.txt', 400)), []), [], '400 changed lines is not yet large');
  assert.deepEqual(gauntletSignals(changes(file('a.txt', 300, 101)), []), ['diff grande: 401 linhas alteradas (limite 400)']);
  const failed = { test: { command: 'npm test', exitCode: 3, timedOut: false } }, passed = { test: { command: 'npm test', exitCode: 0, timedOut: false } };
  assert.deepEqual(gauntletSignals(changes(file('a.txt')), [passed, failed]), ['o último merge falhou no teste (código 3)']);
  assert.deepEqual(gauntletSignals(changes(file('a.txt')), [{ test: { exitCode: null, timedOut: true } }]), ['o último merge falhou no teste (tempo esgotado)']);
  assert.deepEqual(gauntletSignals(changes(file('a.txt')), [failed, passed]), [], 'only the last attempt counts');
  assert.deepEqual(gauntletSignals(changes(file('a.txt')), [{ refused: { reason: 'Dependências não concluídas' } }]), [], 'a refusal before any test is no test failure');
});

test('a Gauntlet evidence entry reads as its preset, severity counts, report path, exit code and usage, unknown never as zero', () => {
  const found = describeGauntlet({ at: '2026-09-26T12:00:00.000Z', runId: 'g1', preset: 'rapido', exitCode: 0, reportPath: 'C:\\wt\\.gauntlet\\relatorio-1.md',
    summary: { high: 1, medium: 0, low: 2, unverified: 0 }, usage: { status: 'observed', inputTokens: 11, outputTokens: 7, cacheReadTokens: 103, cacheCreationTokens: 24 } });
  assert.equal(found.title, 'Gauntlet rápido: alta 1 · média 0 · baixa 2 · sem verificação 0');
  assert.deepEqual(found.details, ['Relatório: C:\\wt\\.gauntlet\\relatorio-1.md', 'Saída: código 0', 'Uso: observado: entrada 11 · saída 7 · cache lido 103 · cache criado 24']);
  assert.ok(found.when.includes('2026'));
  const unknown = describeGauntlet({ at: 'x', preset: 'padrao', exitCode: null, reportPath: null, summary: 'desconhecido',
    usage: { status: 'unknown', reason: 'Transcrição da sessão Claude não encontrada' } });
  assert.equal(unknown.title, 'Gauntlet padrão: gravidades desconhecidas');
  assert.deepEqual(unknown.details, ['Relatório não encontrado na worktree', 'Saída: código desconhecido', 'Uso: desconhecido: Transcrição da sessão Claude não encontrada']);
  assert.equal(describeGauntlet({ at: 'x', preset: 'rapido', summary: { high: 2 } }).title, 'Gauntlet rápido: alta 2', 'a level the report did not state is left out');
});

test('the Gauntlet button waits for a diff, suggests only on a signal, and runs only after a second, confirming click', async () => {
  const env = environment();
  const button = () => env.find('gauntlet');
  const posts = () => env.calls.filter(call => call.route === '/api/tasks/t/gauntlet');
  env.panel.open('t');
  assert.equal(button().disabled, true, 'no diff yet');
  await env.answer('/api/tasks/t/diff', diff({ files: [], stat: { files: 0, additions: 0, deletions: 0 }, patch: '' }));
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  assert.equal(button().disabled, true, 'an empty diff has nothing to review');
  assert.equal(button().textContent, 'Rodar Gauntlet (revisão adversarial)');
  assert.match(env.text(), /Nenhuma revisão do Gauntlet registrada/);

  env.panel.onEvidence({ taskId: 't', projectId: 'a' });
  await env.answer('/api/tasks/t/diff', diff({ files: [{ path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false }] }));
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [] });
  assert.equal(button().disabled, false);
  assert.doesNotMatch(env.text(), /Sugestão/, 'no signal, no suggestion');

  env.panel.onEvidence({ taskId: 't', projectId: 'a' });
  await env.answer('/api/tasks/t/diff', diff({ files: [{ path: 'src/auth/token.mjs', status: 'M', additions: 2, deletions: 1, binary: false }] }));
  await env.answer('/api/tasks/t/evidence', { taskId: 't', attempts: [], gauntlet: [{ at: '2026-09-26T12:00:00.000Z', runId: 'g0', preset: 'rapido', exitCode: 0,
    reportPath: 'C:\\wt\\.gauntlet\\relatorio-0.md', summary: { high: 1, medium: 0, low: 2, unverified: 0 }, usage: { status: 'unknown', reason: 'sem transcrição' } }] });
  assert.match(env.text(), /Sugestão: rodar o Gauntlet — mexe em caminho sensível \(src\/auth\/token\.mjs\) — custo: desconhecido até terminar; roda na sua sessão Claude\./);
  assert.match(env.text(), /Gauntlet rápido: alta 1 · média 0 · baixa 2 · sem verificação 0/);
  assert.match(env.text(), /relatorio-0\.md/);

  const preset = env.find('gauntlet-preset');
  preset.value = 'padrao'; await preset.fire('change');
  button().focus();
  await button().fire('click');
  assert.equal(posts().length, 0, 'the first click only asks for confirmation');
  assert.equal(button().textContent, 'Confirmar: rodar Gauntlet (padrão)');
  assert.equal(doc.activeElement, button(), 'focus stays on the relabelled button');
  assert.match(env.text(), /\/gauntlet-loop padrao so-relatorio sem-perguntas/);
  await env.root.descendants().find(node => node.tag === 'button' && node.textContent === 'Cancelar').fire('click');
  assert.equal(button().textContent, 'Rodar Gauntlet (revisão adversarial)');
  assert.equal(posts().length, 0, 'cancelled: nothing runs');

  await button().fire('click');
  void button().fire('click');
  void button().fire('click');
  assert.deepEqual(posts().map(call => [call.method, call.body]), [['POST', { expectedRevision: 3, preset: 'padrao' }]], 'one request, on the confirming click');
  assert.equal(button().disabled, true, 'disabled while the request runs');
  await env.answer('/api/tasks/t/gauntlet', { id: 'g1', taskId: 't', kind: 'gauntlet', state: 'working' });
  assert.match(env.toasts.at(-1), /Gauntlet iniciado/);

  // Its state comes from the fleet's runs, which the agent SSE keeps live.
  env.gauntlet = { id: 'g1', taskId: 't', kind: 'gauntlet', state: 'blocked', detail: 'permission_prompt' };
  env.panel.onRuns();
  assert.match(env.text(), /Gauntlet: Aguardando você · pedido de permissão/);
  assert.equal(button().disabled, true, 'one Gauntlet at a time');
  env.gauntlet = { ...env.gauntlet, state: 'done', detail: '' };
  env.panel.onRuns();
  assert.match(env.text(), /Gauntlet: Concluído/);
  assert.equal(button().disabled, false);

  await button().fire('click');
  await button().fire('click');
  await env.answer('/api/tasks/t/gauntlet', refusal('O agente da tarefa precisa ter terminado'));
  assert.match(env.text(), /Gauntlet não iniciado: O agente da tarefa precisa ter terminado/);
});
