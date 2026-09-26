import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { mountExtensionsPanel } from '../extensions-panel.mjs';
import { mountUsagePanel } from '../usage-panel.mjs';

// Event/DOM contract of the mini-tool and usage panels only; no browser or visual verdict.
function dom() {
  const doc = {};
  class Element {
    constructor(tag) { Object.assign(this, { tag, children: [], parent: null, events: {}, attributes: {}, dataset: {}, _text: '', value: '', checked: false, open: false, disabled: false }); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    // A removed focused control leaves focus on body, as in a browser.
    replaceChildren(...nodes) { if (this.children.some(child => child.contains(doc.activeElement))) doc.activeElement = doc.body; for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...nodes); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    // Handlers start their async work with `void`; let it settle like a browser task would.
    async fire(type) { if (!this.disabled) for (const fn of this.events[type] || []) await fn({ target: this, currentTarget: this, preventDefault() {} }); await tick(); }
    contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelectorAll(selector) { return this.all().filter(node => selector === '[data-focus-key]' ? 'focusKey' in node.dataset : selector.split(',').includes(node.tag)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    focus() { if (!this.disabled) doc.activeElement = this; }
  }
  doc.createElement = tag => new Element(tag);
  doc.createTextNode = text => Object.assign(new Element('#text'), { _text: String(text) });
  doc.body = new Element('body'); doc.activeElement = doc.body;
  const root = new Element('section'); doc.body.append(root);
  globalThis.document = doc;
  return { root, doc };
}
const button = (root, text) => root.querySelectorAll('button').find(node => (node.getAttribute('aria-label') ?? node.textContent).startsWith(text));
const checkbox = root => root.querySelectorAll('input').find(node => node.type === 'checkbox');
const manifest = { title: 'Verificador de links', inputs: ['arquivos'], capabilities: [], generator: 'template revisado' };
const version = number => ({ version: number, preview: { ok: true }, review: null, sha256: 'a'.repeat(64), manifest });

test('mini-tools: a project switch clears the previous report and status, also when load() runs on entering Assets', async () => {
  const { root } = dom();
  let projectId = 'alpha';
  const registries = { alpha: { revision: 1, enabled: { version: 1 }, versions: [version(1)] }, beta: { revision: 0, enabled: null, versions: [] } };
  const api = async (route, options) => {
    if (!options) return registries[new URL(route, 'http://local').searchParams.get('projectId')];
    if (route === '/api/extensions/generate') return { version: 2 };
    return { ok: true, version: 1, truncated: false, skipped: 0, result: { checked: 1, references: 1, missing: [{ file: 'README.md', line: 1, ref: 'img/alpha-missing.png' }] } };
  };
  const panel = mountExtensionsPanel({ root, api, getProjectId: () => projectId });
  await panel.load();
  await root.querySelector('form').fire('submit');
  await button(root, 'Verificar links agora').fire('click');
  assert.match(root.textContent, /alpha-missing/);
  assert.match(root.textContent, /Versão 2 gerada/);
  projectId = 'beta';
  await panel.load(); // what showView('assets') does after the project changed in another view
  assert.match(root.textContent, /Nenhuma versão ativa/);
  assert.doesNotMatch(root.textContent, /alpha-missing|Versão 2 gerada/);
});

test('mini-tools: actions keep focus on the equivalent control, the review tick, the open code viewer and the typed request', async () => {
  const { root, doc } = dom();
  const calls = [];
  let registry = { revision: 1, enabled: null, versions: [version(1)] };
  const api = async (route, options) => {
    if (options) {
      calls.push({ route, body: options.body });
      registry = { ...registry, revision: registry.revision + 1, enabled: route.endsWith('/enable') ? { version: 1 } : registry.enabled };
      return { ok: true };
    }
    if (route.startsWith('/api/extensions/source')) return { sha256: 'a'.repeat(64), manifest, source: 'function check(input) { return input; }' };
    return registry;
  };
  const panel = mountExtensionsPanel({ root, api, getProjectId: () => 'alpha' });
  await panel.load();
  const details = root.querySelector('details'); details.open = true; await details.fire('toggle'); await tick();
  assert.match(root.textContent, /function check/);
  checkbox(root).checked = true; await checkbox(root).fire('change');
  const request = root.querySelector('input'); request.value = 'MEU PEDIDO DIGITADO'; await request.fire('input');
  const preview = button(root, 'Pré-visualizar'); preview.focus();
  await preview.fire('click');
  assert.notEqual(doc.activeElement, preview, 'the panel was rebuilt');
  assert.equal(doc.activeElement, button(root, 'Pré-visualizar'), 'focus returns to the rebuilt preview button');
  assert.equal(root.querySelector('details').open, true, 'the code viewer stays open');
  assert.match(root.textContent, /function check/);
  assert.equal(checkbox(root).checked, true, 'the review tick survives the render');
  assert.equal(root.querySelector('input').value, 'MEU PEDIDO DIGITADO', 'the typed request survives the render');
  for (const pick of [() => checkbox(root), () => root.querySelector('pre'), () => root.querySelector('input'), () => root.querySelector('summary')]) {
    pick().focus(); await panel.load();
    assert.equal(doc.activeElement, pick(), `focus returns to the rebuilt ${pick().tag}`);
  }
  button(root, 'Ativar versão 1').focus();
  await doc.activeElement.fire('click');
  assert.doesNotMatch(root.textContent, /Marque a revisão/);
  assert.deepEqual(calls.at(-1), { route: '/api/extensions/enable', body: { projectId: 'alpha', version: 1, reviewed: true, expectedRevision: 2 } });
  assert.equal(doc.activeElement.tag, 'h2', 'the enabled version\'s button is disabled, so focus falls back to the panel heading');
});

test('mini-tools: per-version buttons, code viewers and review checkboxes have names that include the version', async () => {
  const { root } = dom();
  const panel = mountExtensionsPanel({ root, api: async () => ({ revision: 1, enabled: null, versions: [version(1), version(2)] }), getProjectId: () => 'alpha' });
  await panel.load();
  const names = root.querySelectorAll('button,summary,label').filter(node => node.tag !== 'label' || checkbox(node)).map(node => (node.getAttribute('aria-label') ?? node.textContent).trim());
  for (const number of [1, 2]) {
    for (const pattern of [/^Pré-visualizar/, /^Ver código/, /^Revisei/, /^Ativar/]) {
      assert.ok(names.some(name => pattern.test(name) && name.includes(`versão ${number}`)), `${pattern} names version ${number}: ${names.join(' | ')}`);
    }
  }
  assert.equal(new Set(names).size, names.length, `no repeated names: ${names.join(' | ')}`);
});

test('mini-tools: the report shows unreadable folders and truncation and never claims a clean partial result', async () => {
  const { root } = dom();
  const api = async (route, options) => options
    ? { ok: true, version: 1, truncated: true, skipped: 2, result: { checked: 3, references: 0, missing: [] } }
    : { revision: 1, enabled: { version: 1 }, versions: [version(1)] };
  const panel = mountExtensionsPanel({ root, api, getProjectId: () => 'alpha' });
  await panel.load();
  await button(root, 'Verificar links agora').fire('click');
  assert.match(root.textContent, /2 pastas ou arquivos sem leitura/);
  assert.match(root.textContent, /limite de leitura/i);
  assert.doesNotMatch(root.textContent, /Nenhuma referência local quebrada\./);
  assert.match(root.textContent, /resultado parcial/);
});

const quota = status => status === 'observado'
  ? { kind: 'subscription-quota', status, windows: [{ label: 'principal', usedPercent: 10 }], source: 's', scope: 'conta', reason: null }
  : { kind: 'subscription-quota', status, windows: null, source: 's', scope: 'conta', reason: status === 'desconhecido' ? 'O App Server do Codex não respondeu a tempo' : 'Consulte explicitamente.' };
function usageFixture({ keys = [], fail = 0 } = {}) {
  const state = { quota: quota('não consultado'), keys, fail, calls: [] };
  const api = async (route, options) => {
    if (options) {
      state.calls.push({ route, body: options.body });
      if (route === '/api/usage/codex-quota') { state.quota = quota(state.next); return { figures: [state.quota] }; }
      if (route === '/api/keys/remove') state.keys = state.keys.filter(key => key.ref !== options.body.ref);
      return {};
    }
    if (state.fail) { state.fail--; throw new Error('Servidor local indisponível'); }
    return route === '/api/usage' ? { figures: [state.quota], codexFound: true } : { keys: state.keys };
  };
  return { state, api };
}

test('usage: a failed or unknown quota read is announced as failed with its reason', async () => {
  const { root } = dom(), { state, api } = usageFixture();
  const panel = mountUsagePanel({ root, api }); await panel.load();
  state.next = 'desconhecido';
  await button(root, 'Consultar quota').fire('click');
  assert.match(root.textContent, /Quota não obtida: O App Server do Codex não respondeu a tempo/);
  assert.doesNotMatch(root.textContent, /Quota consultada/);
  state.next = 'observado';
  await button(root, 'Consultar quota').fire('click');
  assert.match(root.textContent, /Quota consultada/);
});

test('usage: the unavailable error clears on a later successful load', async () => {
  const { root } = dom(), { api } = usageFixture({ fail: 1 });
  const panel = mountUsagePanel({ root, api });
  await panel.load();
  assert.match(root.textContent, /Uso indisponível: Servidor local indisponível/);
  await panel.load();
  assert.doesNotMatch(root.textContent, /Uso indisponível/);
});

test('usage: focus returns to the equivalent control after each action', async () => {
  const { root, doc } = dom(), { api } = usageFixture();
  const panel = mountUsagePanel({ root, api }); await panel.load();
  const read = button(root, 'Consultar quota'); read.focus();
  await read.fire('click');
  assert.notEqual(doc.activeElement, read);
  assert.equal(doc.activeElement, button(root, 'Consultar quota'));
  const secret = root.querySelectorAll('input').find(node => node.type === 'password'); secret.focus(); secret.value = 'dummy-key';
  await root.querySelector('form').fire('submit');
  assert.notEqual(doc.activeElement, secret);
  assert.equal(doc.activeElement, root.querySelectorAll('input').find(node => node.type === 'password'));
});

test('usage: Remover asks for a second explicit confirmation click before deleting from the Windows vault', async () => {
  const { root, doc } = dom(), { state, api } = usageFixture({ keys: [{ ref: 'r1', provider: 'jev', suffix: 'ABCD', validation: { status: 'não verificada' } }] });
  const panel = mountUsagePanel({ root, api }); await panel.load();
  const remove = button(root, 'Remover chave jev terminada em ABCD'); remove.focus();
  await remove.fire('click');
  assert.equal(state.calls.length, 0, 'one click never deletes');
  const confirm = doc.activeElement;
  assert.match(confirm.getAttribute('aria-label'), /^Confirmar remoção da chave jev terminada em ABCD/);
  await button(root, 'Cancelar').fire('click');
  assert.equal(state.calls.length, 0);
  assert.equal(doc.activeElement, button(root, 'Remover chave jev terminada em ABCD'), 'cancel returns focus to Remover');
  await doc.activeElement.fire('click');
  await doc.activeElement.fire('click');
  assert.deepEqual(state.calls, [{ route: '/api/keys/remove', body: { ref: 'r1' } }]);
  assert.match(root.textContent, /Nenhuma chave guardada/);
  assert.ok(root.contains(doc.activeElement), 'focus stays in the panel after the row is gone');
});

test('mini-tools: a project switch while an action is in flight never shows the old project result in the new one', async () => {
  const { root } = dom();
  let projectId = 'alpha', release;
  const registries = { alpha: { revision: 1, enabled: { version: 1 }, versions: [version(1)] }, beta: { revision: 0, enabled: null, versions: [] } };
  const api = async (route, options) => {
    if (!options) return registries[new URL(route, 'http://local').searchParams.get('projectId')];
    await new Promise(resolve => { release = resolve; });
    return { ok: true, version: 1, truncated: false, skipped: 0, result: { checked: 1, references: 1, missing: [{ file: 'README.md', line: 1, ref: 'img/alpha-missing.png' }] } };
  };
  const panel = mountExtensionsPanel({ root, api, getProjectId: () => projectId });
  await panel.load();
  const running = button(root, 'Verificar links agora').fire('click');
  await tick();
  projectId = 'beta';
  await panel.sync();
  release();
  await running; await tick();
  assert.match(root.textContent, /Nenhuma versão ativa/);
  assert.doesNotMatch(root.textContent, /alpha-missing/);
});
