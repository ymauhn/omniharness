import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mountArsenalPanel } from '../arsenal-panel.mjs';

// Event/DOM contract only. This test does not claim visual browser evidence.
function dom() {
  const doc = {};
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this._text = ''; this.attributes = {}; this.classList = { add: value => this.className = value }; this.ownerDocument = doc; }
    append(child) { child.parentElement = this; this.children.push(child); }
    replaceChildren() { this.children = []; this._text = ''; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    async fire(type) { if (!this.disabled) for (const fn of this.events[type] || []) await fn({ target: this, preventDefault() {} }); }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  }
  doc.createElement = tag => new Element(tag);
  return { root: new Element('section'), doc };
}
const tick = () => setImmediate();
const findButton = (root, text) => root.querySelectorAll('button').find(node => node.textContent.startsWith(text));
const findInput = (root, label) => root.querySelectorAll('label').find(node => node.textContent.startsWith(label))?.querySelectorAll('input')[0];
const findSelect = (root, label) => root.querySelectorAll('label').find(node => node.textContent.startsWith(label))?.querySelectorAll('select')[0];
const profile = {
  id: 'engineering-builder', version: 1, name: 'Engineering builder', pillar: 'engineering', purpose: 'Implement safely', authority: 'manual-task-only',
  suggested_hosts: ['codex', 'claude'], intents: ['implement'], skills: ['checkpoint-build'], tools: ['local tests'], context: ['Only selected context'],
  inputs: ['Task'], outputs: ['Change'], test_cases: [{ intent: 'implement', matches: true }, { intent: 'weather', matches: false }],
  provenance: { method: 'original-authorship-v1', selected_source_ids: ['authored-1', 'authored-2'], template: null,
    sources: [{ id: 'authored-1', kind: 'authored', reference: 'Source 1', sha256: 'a'.repeat(64), session_id: null },
      { id: 'authored-2', kind: 'authored', reference: 'Source 2', sha256: 'b'.repeat(64), session_id: null }] },
  rules: [{ id: 'rule-1', text: 'Run tests', source_ids: ['authored-1'] }, { id: 'rule-2', text: 'Review diff', source_ids: ['authored-2'] }],
};
function preview(value = profile, reviewed = null) {
  return { profile: value, content_sha256: 'c'.repeat(64), review: reviewed, runnable: false,
    rules: value.rules.map(rule => ({ ...rule, sources: value.provenance.sources.filter(source => rule.source_ids.includes(source.id)) })) };
}
function row(state = 'draft', activeVersion = null) { return { id: profile.id, name: profile.name, pillar: 'engineering', latest_version: 1, active_version: activeVersion, state }; }
function fixture(t, overrides = {}) {
  const { root } = dom(); let projectId = 'project-a', revision = 0, lifecycle = 'empty', activeVersion = null;
  let currentPreview = preview(), pinned = [], notes = [];
  const calls = [];
  const sessions = [{ id: 'session-a', projectId: 'project-a', name: 'Session A' }];
  const tasks = [{ id: 'task-a', projectId: 'project-a', title: 'Real task' }];
  const builtin = { ...profile };
  const api = async (url, options) => {
    calls.push({ url, body: options?.body });
    if (overrides.api) return overrides.api(url, options);
    const requestedProject = options?.body?.projectId ?? new URL(url, 'http://local').searchParams.get('projectId');
    if (url.startsWith('/api/arsenal/sources?')) return { projectId: requestedProject, notes };
    if (options?.method === 'POST') {
      assert.equal(requestedProject, projectId);
      assert.equal(options.body.expectedRevision, revision);
      const op = url.split('/').at(-1); revision++;
      if (op === 'import') lifecycle = 'draft';
      if (op === 'review') { lifecycle = 'reviewed'; currentPreview = { ...currentPreview, review: { at: 'now', sequence: revision } }; }
      if (op === 'activate') { lifecycle = 'active'; activeVersion = 1; }
      if (op === 'disable') { lifecycle = 'disabled'; activeVersion = null; }
      if (op === 'pin') pinned.push({ task_id: options.body.taskId, profile_id: profile.id, host: options.body.host,
        version: 1, content_sha256: currentPreview.content_sha256, runnable: false });
      return { revision, snapshot: { revision, profiles: lifecycle === 'empty' ? [] : [row(lifecycle, activeVersion)] },
        ...(op === 'import' || op === 'derive' ? { preview: currentPreview } : {}), ...(op === 'pin' ? { pin: pinned.at(-1) } : {}) };
    }
    if (url.startsWith(`/api/arsenal/${profile.id}?`)) return currentPreview;
    return { projectId: requestedProject, snapshot: { revision, profiles: lifecycle === 'empty' ? [] : [row(lifecycle, activeVersion)] },
      builtins: [builtin], pins: pinned, hosts: overrides.hosts ?? ['codex'], runnable: false };
  };
  const panel = mountArsenalPanel({ root, api, getProjectId: () => projectId, getSessions: () => sessions, getTasks: () => tasks });
  t.after(() => panel.destroy());
  return { root, panel, calls, setProject: value => projectId = value, setNotes: value => notes = value,
    setLifecycle: value => { lifecycle = value; activeVersion = value === 'active' ? 1 : null; revision = value === 'empty' ? 0 : 1; },
    setPreview: value => currentPreview = value };
}

test('import remains draft; each rule and inherited settings require explicit review before activation and pin', async t => {
  const f = fixture(t); await tick();
  await findButton(f.root, 'Importar rascunho').fire('click'); await tick();
  assert.match(f.root.textContent, /Engineering builder · última v1 · ativa nenhuma/);
  assert.equal(findButton(f.root, 'Ativar esta versão'), undefined);
  await findButton(f.root, 'Registrar revisão').fire('click'); await tick();
  assert.equal(f.calls.filter(call => call.url.endsWith('/review')).length, 0);
  const rules = f.root.querySelectorAll('article').filter(node => node.className === 'ars-rule');
  assert.equal(rules.length, 2);
  for (const item of rules) item.querySelectorAll('input')[0].checked = true;
  await findButton(f.root, 'Registrar revisão').fire('click'); await tick();
  assert.equal(f.calls.filter(call => call.url.endsWith('/review')).length, 0);
  findInput(f.root, 'Também revisei finalidade').checked = true;
  await findButton(f.root, 'Registrar revisão').fire('click'); await tick();
  const review = f.calls.find(call => call.url.endsWith('/review')).body;
  assert.deepEqual(review.reviewedRuleIds, ['rule-1', 'rule-2']);
  assert.deepEqual(review.sourceRules, { 'rule-1': ['authored-1'], 'rule-2': ['authored-2'] });
  assert.equal(review.contentSha256, 'c'.repeat(64)); assert.equal(review.reviewedSettings, true);
  await findButton(f.root, 'Ativar esta versão').fire('click'); await tick();
  findSelect(f.root, 'Tarefa deste projeto').value = 'task-a';
  findSelect(f.root, 'Host preferido').value = 'codex';
  await findButton(f.root, 'Vincular à tarefa').fire('click'); await tick();
  const pin = f.calls.find(call => call.url.endsWith('/pin')).body;
  assert.deepEqual({ projectId: pin.projectId, profileId: pin.profileId, taskId: pin.taskId, host: pin.host },
    { projectId: 'project-a', profileId: profile.id, taskId: 'task-a', host: 'codex' });
  assert.match(f.root.textContent, /sem execução/);
  assert.equal(f.calls.some(call => /dispatch|spawn|run/.test(call.url)), false);
});

test('derivation submits only explicitly selected note identities, classification and revision, never text', async t => {
  const f = fixture(t); f.setLifecycle('reviewed');
  f.setNotes([{ id: 'note-accepted', sessionId: 'session-a', revision: 2, text: 'Keep focused test', source: 'owner' },
    { id: 'note-quote', sessionId: 'session-a', revision: 1, text: 'PRIVATE QUOTE', source: 'citation' }]);
  await f.panel.load(); await f.panel.load();
  const sessionCheck = f.root.querySelectorAll('label').find(label => label.textContent.startsWith('Session A')).querySelectorAll('input')[0];
  sessionCheck.checked = true; await findButton(f.root, 'Carregar notas').fire('click'); await tick();
  const cards = f.root.querySelectorAll('article').filter(node => node.className === 'ars-note');
  assert.equal(cards.length, 2);
  cards[0].querySelectorAll('input')[0].checked = true; cards[0].querySelectorAll('input')[1].checked = true;
  cards[0].querySelectorAll('select')[0].value = 'accepted_decision';
  cards[1].querySelectorAll('input')[0].checked = true; cards[1].querySelectorAll('input')[1].checked = true;
  cards[1].querySelectorAll('select')[0].value = 'quoted';
  findSelect(f.root, 'Template original').value = profile.id;
  findInput(f.root, 'ID do novo perfil').value = 'new-reviewer';
  findInput(f.root, 'Nome da versão').value = 'New reviewer';
  await findButton(f.root, 'Gerar rascunho').fire('click'); await tick();
  const body = f.calls.find(call => call.url.endsWith('/derive')).body;
  assert.deepEqual(body.selectedSourceIds, ['note-accepted', 'note-quote']);
  assert.deepEqual(body.selections, [
    { noteId: 'note-accepted', sessionId: 'session-a', expectedRevision: 2, kind: 'accepted_decision', sanitized: true },
    { noteId: 'note-quote', sessionId: 'session-a', expectedRevision: 1, kind: 'quoted', sanitized: true },
  ]);
  assert.equal(JSON.stringify(body).includes('PRIVATE QUOTE'), false);
});

test('an installed builtin can derive a draft without prior import; changed session selection clears old note text', async t => {
  const f = fixture(t);
  f.setNotes([{ id: 'note-accepted', sessionId: 'session-a', revision: 1, text: 'Only selected rule', source: 'owner' }]);
  await tick();
  const session = f.root.querySelectorAll('label').find(label => label.textContent.startsWith('Session A')).querySelectorAll('input')[0];
  session.checked = true; await session.fire('change');
  await findButton(f.root, 'Carregar notas').fire('click'); await tick();
  assert.match(f.root.textContent, /Only selected rule/);
  const currentSession = f.root.querySelectorAll('label').find(label => label.textContent.startsWith('Session A')).querySelectorAll('input')[0];
  currentSession.checked = false; await currentSession.fire('change');
  assert.equal(f.root.textContent.includes('Only selected rule'), false);
  await findButton(f.root, 'Gerar rascunho').fire('click'); await tick();
  assert.equal(f.calls.some(call => call.url.endsWith('/derive')), false);
  const again = f.root.querySelectorAll('label').find(label => label.textContent.startsWith('Session A')).querySelectorAll('input')[0];
  again.checked = true; await again.fire('change');
  await findButton(f.root, 'Carregar notas').fire('click'); await tick();
  const card = f.root.querySelectorAll('article').find(node => node.className === 'ars-note');
  card.querySelectorAll('input')[0].checked = true; card.querySelectorAll('input')[1].checked = true;
  card.querySelectorAll('select')[0].value = 'accepted_decision';
  findSelect(f.root, 'Template original').value = profile.id;
  findInput(f.root, 'ID do novo perfil').value = 'derived-from-builtin';
  findInput(f.root, 'Nome da versão').value = 'Derived from builtin';
  await findButton(f.root, 'Gerar rascunho').fire('click'); await tick();
  assert.equal(f.calls.some(call => call.url.endsWith('/import')), false);
  assert.equal(f.calls.find(call => call.url.endsWith('/derive')).body.templateId, profile.id);
});

test('unobserved host cannot be selected for a metadata pin', async t => {
  const f = fixture(t, { hosts: [] }); f.setLifecycle('active');
  await f.panel.load();
  await findButton(f.root, 'Engineering builder · última').fire('click'); await tick();
  assert.equal(findButton(f.root, 'Vincular à tarefa').disabled, true);
  assert.equal(f.root.textContent.includes('Codex · indisponível'), true);
  assert.equal(f.calls.some(call => call.url.endsWith('/pin')), false);
});

test('late private project response cannot repopulate panel after A to B switch', async t => {
  const { root } = dom(); let projectId = 'a', finish;
  const stale = new Promise(resolve => finish = resolve);
  const api = url => new URL(url, 'http://local').searchParams.get('projectId') === 'a' ? stale
    : Promise.resolve({ projectId: 'b', snapshot: { revision: 0, profiles: [] }, builtins: [], pins: [], runnable: false });
  const panel = mountArsenalPanel({ root, api, getProjectId: () => projectId, getSessions: () => [], getTasks: () => [] });
  t.after(() => panel.destroy());
  projectId = 'b'; panel.sync(); await tick();
  finish({ projectId: 'a', snapshot: { revision: 1, profiles: [{ ...row(), name: 'PRIVATE PROJECT A' }] },
    builtins: [{ ...profile, name: 'PRIVATE TEMPLATE' }], pins: [], runnable: false });
  await tick();
  assert.equal(root.textContent.includes('PRIVATE'), false);
  assert.match(root.textContent, /0 perfis no projeto/);
});

test('a GET begun before a POST cannot replace the newer saved registry snapshot', async t => {
  const { root } = dom(); let finishRead, reads = 0;
  const oldRead = new Promise(resolve => finishRead = resolve);
  const empty = { projectId: 'project-a', snapshot: { revision: 0, profiles: [] }, builtins: [profile], pins: [], hosts: ['codex'], runnable: false };
  const api = (url, options) => {
    if (options?.method === 'POST') return Promise.resolve({ revision: 1, snapshot: { revision: 1, profiles: [row()] }, preview: preview() });
    if (url === '/api/arsenal?projectId=project-a') return ++reads === 1 ? Promise.resolve(empty) : oldRead;
    throw Error(`Unexpected ${url}`);
  };
  const panel = mountArsenalPanel({ root, api, getProjectId: () => 'project-a', getSessions: () => [], getTasks: () => [] });
  t.after(() => panel.destroy()); await tick();
  const reading = panel.load();
  await findButton(root, 'Importar rascunho').fire('click'); await tick();
  finishRead(empty); await reading;
  assert.match(root.textContent, /última v1 · ativa nenhuma/);
  assert.equal(findButton(root, 'Já importado').disabled, true);
});

test('a stale GET begun during POST cannot regress the saved revision', async t => {
  const { root } = dom(); let finishPost, finishRead, reads = 0;
  const pendingPost = new Promise(resolve => finishPost = resolve), oldRead = new Promise(resolve => finishRead = resolve);
  const empty = { projectId: 'project-a', snapshot: { revision: 0, profiles: [] }, builtins: [profile], pins: [], hosts: ['codex'], runnable: false };
  const api = (url, options) => {
    if (options?.method === 'POST') return pendingPost;
    if (url === '/api/arsenal?projectId=project-a') return ++reads === 1 ? Promise.resolve(empty) : oldRead;
    throw Error(`Unexpected ${url}`);
  };
  const panel = mountArsenalPanel({ root, api, getProjectId: () => 'project-a', getSessions: () => [], getTasks: () => [] });
  t.after(() => panel.destroy()); await tick();
  const writing = findButton(root, 'Importar rascunho').fire('click');
  const reading = panel.load();
  finishPost({ revision: 1, snapshot: { revision: 1, profiles: [row()] }, preview: preview() }); await tick();
  finishRead(empty); await Promise.all([writing, reading]);
  assert.match(root.textContent, /última v1 · ativa nenhuma/);
  assert.equal(findButton(root, 'Já importado').disabled, true);
});

test('SSE-observed task pin is not duplicated by the later POST response', async t => {
  const { root } = dom(); let finishPin, reads = 0;
  const pinResult = new Promise(resolve => finishPin = resolve);
  const pinned = { task_id: 'task-a', profile_id: profile.id, host: 'codex', version: 1,
    content_sha256: 'c'.repeat(64), runnable: false };
  const original = { projectId: 'project-a', snapshot: { revision: 1, profiles: [row('active', 1)] },
    builtins: [profile], pins: [], hosts: ['codex'], runnable: false };
  const newer = { ...original, snapshot: { revision: 2, profiles: [row('active', 1)] }, pins: [pinned] };
  const api = (url, options) => {
    if (options?.method === 'POST') return pinResult;
    if (url.startsWith(`/api/arsenal/${profile.id}?`)) return Promise.resolve(preview(profile, { at: 'now', sequence: 1 }));
    if (url === '/api/arsenal?projectId=project-a') return Promise.resolve(++reads === 1 ? original : newer);
    throw Error(`Unexpected ${url}`);
  };
  const panel = mountArsenalPanel({ root, api, getProjectId: () => 'project-a', getSessions: () => [],
    getTasks: () => [{ id: 'task-a', projectId: 'project-a', title: 'Real task' }] });
  t.after(() => panel.destroy()); await tick();
  await findButton(root, 'Engineering builder · última').fire('click'); await tick();
  findSelect(root, 'Tarefa deste projeto').value = 'task-a';
  await findButton(root, 'Vincular à tarefa').fire('click');
  await panel.load(); // SSE-like refresh observes the pin before the POST response
  finishPin({ revision: 2, snapshot: newer.snapshot, pin: pinned }); await tick();
  const summaries = root.querySelectorAll('p').filter(node => node.textContent.includes(' · codex · v1 · '));
  assert.equal(summaries.length, 1, 'one immutable pin, even if SSE GET saw it first');
  assert.equal(findButton(root, 'Vincular à tarefa').disabled, true);
});

test('library distinguishes newest draft version from an earlier active version', async t => {
  const { root } = dom();
  const latest = { ...profile, version: 2, name: 'New draft' };
  const api = url => url.startsWith(`/api/arsenal/${profile.id}?`)
    ? Promise.resolve(preview(latest))
    : Promise.resolve({ projectId: 'project-a', snapshot: { revision: 4,
      profiles: [{ ...row('active', 1), latest_version: 2, name: 'New draft' }] },
      builtins: [profile], pins: [], hosts: ['codex'], runnable: false });
  const panel = mountArsenalPanel({ root, api, getProjectId: () => 'project-a', getSessions: () => [], getTasks: () => [] });
  t.after(() => panel.destroy()); await tick();
  assert.match(root.textContent, /última v2 · ativa v1/);
  await findButton(root, 'New draft · última').fire('click'); await tick();
  assert.match(root.textContent, /v2 · rascunho · não ativa/);
});
