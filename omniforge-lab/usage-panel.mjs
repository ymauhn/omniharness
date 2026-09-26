// Usage figures kept apart (quota, measured tokens, estimated cost, confirmed billing) and optional provider keys.
// Unknown stays unknown; a key is stored in the OS vault and only its masked suffix is ever shown.
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const add = (parent, tag, className, text) => { const node = make(tag, className, text); parent.append(node); return node; };
const TITLES = { 'subscription-quota': 'Quota da assinatura', 'measured-tokens': 'Tokens medidos por execução', 'estimated-cost': 'Custo estimado', 'confirmed-billing': 'Cobrança confirmada' };
const PROVIDERS = [['anthropic', 'Anthropic API'], ['openai', 'OpenAI API']];

const keyed = (node, key) => { node.dataset.focusKey = key; return node; };
const UNAVAILABLE = 'Uso indisponível: ';

export function mountUsagePanel({ root, api, toast = () => {} }) {
  let figures = [], keys = [], codexFound = false, busy = false, focusKey = null, confirmRef = null;
  const status = make('p', 'microcopy'); status.setAttribute('role', 'status');

  async function load() {
    try {
      const [usage, stored] = await Promise.all([api('/api/usage'), api('/api/keys')]);
      figures = usage.figures; codexFound = usage.codexFound; keys = stored.keys;
      if (status.textContent.startsWith(UNAVAILABLE)) status.textContent = '';
    } catch (error) { status.textContent = `${UNAVAILABLE}${error.message}`; }
    render();
  }

  // work() resolves to the message to announce, so a completed call can still report a failed read.
  async function run(work) {
    if (busy) return;
    busy = true; confirmRef = null; render();
    try { status.textContent = await work(); }
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
      const read = keyed(add(body, 'button', 'secondary', 'Consultar quota do Codex agora'), 'quota'); read.type = 'button';
      read.disabled = busy || !codexFound;
      if (!codexFound) add(body, 'p', 'microcopy', 'Codex CLI não encontrado neste computador.');
      read.addEventListener('click', () => run(async () => {
        const [quota] = (await api('/api/usage/codex-quota', { method: 'POST', body: {} })).figures ?? [];
        return quota?.status === 'observado' ? 'Quota consultada (leitura somente da conta; não é recibo de tarefa).' : `Quota não obtida: ${quota?.reason || 'motivo desconhecido'}`;
      }));
    }
  }

  // Every render rebuilds the controls; keyboard focus returns to the equivalent one (data-focus-key),
  // or to the keys heading when that control is gone.
  function render() {
    const active = document.activeElement;
    if (active && root.contains(active)) focusKey = active.dataset?.focusKey ?? null;
    else if (active && active !== document.body) focusKey = null; // Never pull focus back from elsewhere.
    root.replaceChildren();
    const grid = add(root, 'div', 'usage-grid');
    for (const figure of figures) figureCard(grid, figure);
    const vault = add(root, 'section', 'card usage-keys'); vault.setAttribute('aria-labelledby', 'usage-keys-title');
    const head = add(vault, 'div', 'card-head'); const title = keyed(add(head, 'h2', '', 'Chaves de API opcionais'), 'keys'); title.id = 'usage-keys-title'; title.tabIndex = -1;
    add(head, 'small', '', 'Guardadas no Gerenciador de Credenciais do Windows');
    const body = add(vault, 'div', 'card-body');
    add(body, 'p', 'microcopy', 'Guardar uma chave não a valida nem faz chamadas: nenhum provedor é contatado. Só o sufixo aparece aqui; a chave nunca volta para esta página.');
    const form = add(body, 'form', 'form-grid');
    const providerField = add(form, 'label', 'field', 'Provedor'); const provider = keyed(add(providerField, 'select'), 'provider');
    for (const [value, label] of PROVIDERS) { const option = add(provider, 'option', '', label); option.value = value; }
    const secretField = add(form, 'label', 'field', 'Chave'); const secret = keyed(add(secretField, 'input'), 'secret');
    Object.assign(secret, { type: 'password', autocomplete: 'off', spellcheck: false, maxLength: 4096 });
    const save = keyed(add(form, 'button', 'button', 'Guardar no cofre do Windows'), 'save'); save.type = 'submit'; save.disabled = busy;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = secret.value; secret.value = '';
      void run(async () => { await api('/api/keys', { method: 'POST', body: { provider: provider.value, secret: value } }); return 'Chave guardada no cofre do Windows.'; });
    });
    const list = add(body, 'ul', 'usage-key-list');
    if (!keys.length) add(list, 'li', 'microcopy', 'Nenhuma chave guardada.');
    for (const key of keys) {
      const item = add(list, 'li', 'usage-key'), name = `chave ${key.provider} terminada em ${key.suffix}`, confirming = confirmRef === key.ref;
      add(item, 'span', '', `${key.provider} · ••••${key.suffix} · ${key.validation.status}`);
      // The vault delete cannot be undone, so it takes a second, explicit click on the same (relabelled) button.
      const remove = keyed(add(item, 'button', 'ghost', confirming ? 'Confirmar remoção' : 'Remover'), `remove:${key.ref}`); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', confirming ? `Confirmar remoção da ${name} do cofre do Windows` : `Remover ${name}`);
      remove.addEventListener('click', () => {
        if (!confirming) { confirmRef = key.ref; status.textContent = `Confirme para apagar a ${name} do cofre do Windows; não há como desfazer.`; render(); return; }
        void run(async () => { await api('/api/keys/remove', { method: 'POST', body: { ref: key.ref } }); return 'Chave removida do cofre.'; });
      });
      if (confirming) {
        // Same focus key: after cancelling, focus returns to the Remover button.
        const cancel = keyed(add(item, 'button', 'ghost', 'Cancelar'), `remove:${key.ref}`); cancel.type = 'button'; cancel.disabled = busy;
        cancel.addEventListener('click', () => { confirmRef = null; status.textContent = ''; render(); });
      }
    }
    root.append(status);
    if (!focusKey || busy) return; // Controls are disabled while busy; restore afterwards.
    ([...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey && !node.disabled) || title).focus();
    focusKey = null;
  }

  return { load };
}
