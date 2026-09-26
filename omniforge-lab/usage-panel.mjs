// Usage figures kept apart (quota, measured tokens, estimated cost, confirmed billing) and optional provider keys.
// Unknown stays unknown; a key is stored in the OS vault and only its masked suffix is ever shown.
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const add = (parent, tag, className, text) => { const node = make(tag, className, text); parent.append(node); return node; };
const TITLES = { 'subscription-quota': 'Quota da assinatura', 'measured-tokens': 'Tokens medidos por execução', 'estimated-cost': 'Custo estimado', 'confirmed-billing': 'Cobrança confirmada' };
const PROVIDERS = [['jev', 'TypeSafe JEV'], ['anthropic', 'Anthropic API'], ['openai', 'OpenAI API']];

export function mountUsagePanel({ root, api, toast = () => {} }) {
  let figures = [], keys = [], codexFound = false, busy = false;
  const status = make('p', 'microcopy'); status.setAttribute('role', 'status');

  async function load() {
    try {
      const [usage, stored] = await Promise.all([api('/api/usage'), api('/api/keys')]);
      figures = usage.figures; codexFound = usage.codexFound; keys = stored.keys;
    } catch (error) { status.textContent = `Uso indisponível: ${error.message}`; }
    render();
  }

  async function run(work, message) {
    if (busy) return;
    busy = true; render();
    try { await work(); if (message) status.textContent = message; }
    catch (error) { status.textContent = error.message; toast(error.message); }
    finally { busy = false; await load(); }
  }

  function figureCard(parent, figure) {
    const card = add(parent, 'article', 'card usage-figure'); card.dataset.kind = figure.kind;
    const head = add(card, 'div', 'card-head'); add(head, 'h2', '', TITLES[figure.kind] ?? figure.kind); add(head, 'span', 'scope-badge', figure.status);
    const body = add(card, 'div', 'card-body');
    if (figure.windows?.length) {
      const list = add(body, 'ul', 'usage-windows');
      for (const window of figure.windows) add(list, 'li', '', `Janela ${window.label}: ${window.usedPercent}% usada${window.windowMinutes ? ` · ${Math.round(window.windowMinutes / 60)} h` : ''}${window.resetsAt ? ` · renova ${new Date(window.resetsAt).toLocaleString('pt-BR')}` : ''}`);
      if (figure.plan) add(body, 'p', 'microcopy', `Plano informado: ${figure.plan}`);
    } else add(body, 'p', 'usage-value', 'Desconhecido');
    if (figure.reason) add(body, 'p', 'microcopy', figure.reason);
    add(body, 'p', 'meta', `Fonte: ${figure.source} · Escopo: ${figure.scope}${figure.observedAt ? ` · Observado ${new Date(figure.observedAt).toLocaleString('pt-BR')}` : ''}`);
    if (figure.kind === 'subscription-quota') {
      const read = add(body, 'button', 'secondary', 'Consultar quota do Codex agora'); read.type = 'button';
      read.disabled = busy || !codexFound;
      if (!codexFound) add(body, 'p', 'microcopy', 'Codex CLI não encontrado neste computador.');
      read.addEventListener('click', () => run(() => api('/api/usage/codex-quota', { method: 'POST', body: {} }), 'Quota consultada (leitura somente da conta; não é recibo de tarefa).'));
    }
  }

  function render() {
    root.replaceChildren();
    const grid = add(root, 'div', 'usage-grid');
    for (const figure of figures) figureCard(grid, figure);
    const vault = add(root, 'section', 'card usage-keys'); vault.setAttribute('aria-labelledby', 'usage-keys-title');
    const head = add(vault, 'div', 'card-head'); const title = add(head, 'h2', '', 'Chaves de API opcionais'); title.id = 'usage-keys-title';
    add(head, 'small', '', 'Guardadas no Gerenciador de Credenciais do Windows');
    const body = add(vault, 'div', 'card-body');
    add(body, 'p', 'microcopy', 'Guardar uma chave não a valida nem faz chamadas: nenhum provedor é contatado. Só o sufixo aparece aqui; a chave nunca volta para esta página.');
    const form = add(body, 'form', 'form-grid');
    const providerField = add(form, 'label', 'field', 'Provedor'); const provider = add(providerField, 'select');
    for (const [value, label] of PROVIDERS) { const option = add(provider, 'option', '', label); option.value = value; }
    const secretField = add(form, 'label', 'field', 'Chave'); const secret = add(secretField, 'input');
    Object.assign(secret, { type: 'password', autocomplete: 'off', spellcheck: false, maxLength: 4096 });
    const save = add(form, 'button', 'button', 'Guardar no cofre do Windows'); save.type = 'submit'; save.disabled = busy;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = secret.value; secret.value = '';
      void run(() => api('/api/keys', { method: 'POST', body: { provider: provider.value, secret: value } }), 'Chave guardada no cofre do Windows.');
    });
    const list = add(body, 'ul', 'usage-key-list');
    if (!keys.length) add(list, 'li', 'microcopy', 'Nenhuma chave guardada.');
    for (const key of keys) {
      const item = add(list, 'li', 'usage-key');
      add(item, 'span', '', `${key.provider} · ••••${key.suffix} · ${key.validation.status}`);
      const remove = add(item, 'button', 'ghost', 'Remover'); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', `Remover chave ${key.provider} terminada em ${key.suffix}`);
      remove.addEventListener('click', () => void run(() => api('/api/keys/remove', { method: 'POST', body: { ref: key.ref } }), 'Chave removida do cofre.'));
    }
    root.append(status);
  }

  return { load };
}
