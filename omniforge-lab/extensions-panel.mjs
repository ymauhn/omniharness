// Mini-tools of the selected project: generate from a request, read the code, preview on fixtures, review and enable,
// run, disable or roll back. The panel only calls the local API; extension code never runs in this page.
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const add = (parent, tag, className, text) => { const node = make(tag, className, text); parent.append(node); return node; };
const keyed = (node, key) => { node.dataset.focusKey = key; return node; };
const DEFAULT_REQUEST = 'Verificar links quebrados nos assets do projeto';

export function mountExtensionsPanel({ root, api, getProjectId, toast = () => {} }) {
  let registry = null, projectId = null, busy = false, report = null, request = 0, focusKey = null, draft = DEFAULT_REQUEST;
  // View state of the current project kept across renders: review ticks and open code viewers by version, fetched sources.
  const reviewed = new Set(), openCode = new Set(), sources = new Map();
  const status = make('p', 'microcopy'); status.setAttribute('role', 'status');

  async function load() {
    if (projectId !== getProjectId()) {
      // Whichever entry point loads the panel, nothing of the previous project carries over.
      projectId = getProjectId(); registry = null; report = null; focusKey = null; draft = DEFAULT_REQUEST;
      status.textContent = ''; reviewed.clear(); openCode.clear(); sources.clear(); render();
    }
    const serial = ++request;
    if (!projectId) { registry = null; render(); return; }
    try {
      const result = await api(`/api/extensions?projectId=${encodeURIComponent(projectId)}`);
      if (serial !== request || projectId !== getProjectId()) return;
      registry = result;
    } catch (error) { if (serial === request) { registry = null; status.textContent = `Mini-tools indisponíveis: ${error.message}`; } }
    render();
  }

  async function mutate(route, body, done) {
    if (busy || !projectId) return;
    const owner = projectId;
    busy = true; render();
    try {
      const result = await api(route, { method: 'POST', body: { projectId: owner, ...body } });
      // The owner may have switched projects while the request ran; its result belongs to the old project only.
      if (done && owner === getProjectId()) done(result);
      await load();
    } catch (error) { if (owner === getProjectId()) { status.textContent = error.message; toast(error.message); } }
    finally { busy = false; render(); }
  }

  // A cached source draws synchronously, so a re-render keeps an open viewer (and its focus) in place.
  async function showSource(row, target) {
    const owner = projectId;
    let source = sources.get(row.version);
    if (!source) {
      target.replaceChildren(make('p', 'microcopy', 'Carregando código…'));
      try { source = await api(`/api/extensions/source?projectId=${encodeURIComponent(owner)}&version=${row.version}`); }
      catch (error) { target.replaceChildren(make('p', 'microcopy', `Código não carregado: ${error.message}`)); return; }
      if (owner !== projectId) return;
      sources.set(row.version, source);
    }
    target.replaceChildren();
    add(target, 'p', 'microcopy', `SHA-256 ${source.sha256} · entradas: ${source.manifest.inputs.join('; ')} · capacidades: ${source.manifest.capabilities.length ? source.manifest.capabilities.join(', ') : 'nenhuma'} · gerador: ${source.manifest.generator}`);
    const code = keyed(add(target, 'pre', 'ext-code', source.source), `source:${row.version}`); code.tabIndex = 0; code.setAttribute('aria-label', `Código da versão ${row.version}`);
  }

  // Every render rebuilds the controls; keyboard focus returns to the equivalent one (data-focus-key),
  // or to the panel heading when that control is gone or disabled.
  function render() {
    const active = document.activeElement;
    if (active && root.contains(active)) focusKey = active.dataset?.focusKey ?? null;
    else if (active && active !== document.body) focusKey = null; // Never pull focus back from elsewhere.
    root.replaceChildren();
    const head = add(root, 'div', 'card-head');
    const titles = add(head, 'div'); const heading = keyed(add(titles, 'h2', '', 'Mini-tools do projeto'), 'heading'); heading.tabIndex = -1;
    add(titles, 'small', '', 'Verificador de links de assets gerado a partir de um template revisado (sem modelo). Somente leitura.');
    const body = add(root, 'div', 'card-body ext-body');
    if (!projectId) { add(body, 'p', 'empty', 'Selecione um projeto.'); body.append(status); return; }
    const form = add(body, 'form', 'ext-generate');
    const label = add(form, 'label', 'field', 'Pedido');
    const input = keyed(add(label, 'input'), 'request'); input.name = 'request'; input.maxLength = 500; input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    const generate = keyed(add(form, 'button', 'secondary', 'Gerar nova versão'), 'generate'); generate.type = 'submit'; generate.disabled = busy;
    form.addEventListener('submit', event => { event.preventDefault(); void mutate('/api/extensions/generate', { request: input.value }, row => { status.textContent = `Versão ${row.version} gerada. Revise o código e pré-visualize antes de ativar.`; }); });
    const enabled = registry?.enabled;
    add(body, 'p', 'microcopy', enabled ? `Ativa: versão ${enabled.version}.` : 'Nenhuma versão ativa. Uma versão só pode ser ativada depois de passar na pré-visualização e ser revisada.');
    const actions = add(body, 'div', 'ext-actions');
    const run = keyed(add(actions, 'button', 'button', 'Verificar links agora'), 'run'); run.type = 'button'; run.disabled = busy || !enabled;
    run.addEventListener('click', () => void mutate('/api/extensions/run', {}, result => { report = result; }));
    const disable = keyed(add(actions, 'button', 'ghost', 'Desativar'), 'disable'); disable.type = 'button'; disable.disabled = busy || !enabled;
    disable.addEventListener('click', () => void mutate('/api/extensions/disable', { expectedRevision: registry.revision }, () => { report = null; status.textContent = 'Mini-tool desativado; o app continua igual.'; }));
    const rollback = keyed(add(actions, 'button', 'ghost', 'Restaurar versão anterior'), 'rollback'); rollback.type = 'button'; rollback.disabled = busy || !enabled;
    rollback.addEventListener('click', () => void mutate('/api/extensions/rollback', { expectedRevision: registry.revision }, () => { status.textContent = 'Versão anterior restaurada.'; }));
    if (report) {
      const box = add(body, 'section', 'ext-report'); box.setAttribute('aria-label', 'Resultado do verificador');
      if (!report.ok) add(box, 'p', 'catalog-error', `Falhou fechado (${report.reason}): ${report.error}`);
      else {
        const missing = report.result.missing ?? [], partial = report.skipped > 0 || report.truncated;
        add(box, 'p', 'microcopy', `Versão ${report.version}: ${report.result.checked} arquivos de texto, ${report.result.references} referências locais, ${missing.length} quebradas.`);
        if (report.skipped > 0) add(box, 'p', 'microcopy', `${report.skipped} pastas ou arquivos sem leitura ficaram de fora; resultado parcial.`);
        if (report.truncated) add(box, 'p', 'microcopy', 'Limite de leitura atingido (arquivos demais ou grandes demais); resultado parcial.');
        const list = add(box, 'ul', 'ext-missing');
        for (const item of missing.slice(0, 200)) add(list, 'li', '', `${item.file}:${item.line} → ${item.ref}`);
        if (!missing.length) add(list, 'li', '', partial ? 'Nenhuma referência quebrada nos arquivos lidos; resultado parcial.' : 'Nenhuma referência local quebrada.');
      }
    }
    const versions = add(body, 'div', 'ext-versions');
    for (const row of [...(registry?.versions ?? [])].reverse()) {
      const item = add(versions, 'article', 'list-item');
      const top = add(item, 'div', 'topline'); add(top, 'strong', 'title', `Versão ${row.version}`);
      add(top, 'span', 'scope-badge', row.preview ? (row.preview.ok ? 'pré-visualização aprovada' : `pré-visualização falhou${row.preview.reason ? ` (${row.preview.reason})` : ''}`) : 'sem pré-visualização');
      add(item, 'div', 'meta', `${row.manifest.title} · SHA-256 ${row.sha256.slice(0, 12)}… · ${row.review ? `revisada ${row.review.at}` : 'não revisada'}`);
      const code = add(item, 'details'); keyed(add(code, 'summary', '', `Ver código e manifesto da versão ${row.version}`), `code:${row.version}`);
      const target = add(code, 'div');
      if (openCode.has(row.version)) { code.open = code.loaded = true; void showSource(row, target); }
      code.addEventListener('toggle', () => {
        if (code.open) openCode.add(row.version); else openCode.delete(row.version);
        if (code.open && !code.loaded) { code.loaded = true; void showSource(row, target); }
      });
      const controls = add(item, 'div', 'ext-actions');
      const preview = keyed(add(controls, 'button', 'secondary', `Pré-visualizar versão ${row.version} nos fixtures`), `preview:${row.version}`); preview.type = 'button'; preview.disabled = busy;
      preview.addEventListener('click', () => void mutate('/api/extensions/preview', { version: row.version, expectedRevision: registry.revision }, result => { status.textContent = result.ok ? `Versão ${row.version}: pré-visualização aprovada.` : `Versão ${row.version}: pré-visualização falhou.`; }));
      const reviewLabel = add(controls, 'label', 'ext-check'); const tick = keyed(add(reviewLabel, 'input'), `review:${row.version}`); tick.type = 'checkbox';
      tick.checked = reviewed.has(row.version);
      tick.addEventListener('change', () => { if (tick.checked) reviewed.add(row.version); else reviewed.delete(row.version); });
      reviewLabel.append(document.createTextNode(` Revisei o código e o manifesto da versão ${row.version}`));
      const enable = keyed(add(controls, 'button', 'button', `Ativar versão ${row.version}`), `enable:${row.version}`); enable.type = 'button';
      enable.disabled = busy || !row.preview?.ok || enabled?.version === row.version;
      enable.addEventListener('click', () => {
        if (!tick.checked) { status.textContent = 'Marque a revisão do código e do manifesto antes de ativar.'; return; }
        // The tick attests one activation; a later re-activation asks for it again.
        void mutate('/api/extensions/enable', { version: row.version, reviewed: true, expectedRevision: registry.revision }, () => { reviewed.delete(row.version); status.textContent = `Versão ${row.version} ativada.`; });
      });
    }
    body.append(status);
    if (!focusKey || busy) return; // Controls are disabled while busy; restore afterwards.
    ([...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey && !node.disabled) || heading).focus();
    focusKey = null;
  }

  return { load, sync() { if (projectId !== getProjectId()) void load(); } };
}
