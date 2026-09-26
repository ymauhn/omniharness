// Mini-tools of the selected project: generate from a request, read the code, preview on fixtures, review and enable,
// run, disable or roll back. The panel only calls the local API; extension code never runs in this page.
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const add = (parent, tag, className, text) => { const node = make(tag, className, text); parent.append(node); return node; };

export function mountExtensionsPanel({ root, api, getProjectId, toast = () => {} }) {
  let registry = null, projectId = null, busy = false, report = null, request = 0;
  const status = make('p', 'microcopy'); status.setAttribute('role', 'status');

  async function load() {
    projectId = getProjectId();
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
    busy = true; render();
    try {
      const result = await api(route, { method: 'POST', body: { projectId, ...body } });
      if (done) done(result);
      await load();
    } catch (error) { status.textContent = error.message; toast(error.message); }
    finally { busy = false; render(); }
  }

  async function showSource(row, target) {
    target.replaceChildren(add(target, 'p', 'microcopy', 'Carregando código…'));
    try {
      const source = await api(`/api/extensions/source?projectId=${encodeURIComponent(projectId)}&version=${row.version}`);
      target.replaceChildren();
      add(target, 'p', 'microcopy', `SHA-256 ${source.sha256} · entradas: ${source.manifest.inputs.join('; ')} · capacidades: ${source.manifest.capabilities.length ? source.manifest.capabilities.join(', ') : 'nenhuma'} · gerador: ${source.manifest.generator}`);
      const code = add(target, 'pre', 'ext-code', source.source); code.tabIndex = 0; code.setAttribute('aria-label', `Código da versão ${row.version}`);
    } catch (error) { target.replaceChildren(); add(target, 'p', 'microcopy', `Código não carregado: ${error.message}`); }
  }

  function render() {
    root.replaceChildren();
    const head = add(root, 'div', 'card-head');
    const titles = add(head, 'div'); add(titles, 'h2', '', 'Mini-tools do projeto');
    add(titles, 'small', '', 'Verificador de links de assets gerado a partir de um template revisado (sem modelo). Somente leitura.');
    const body = add(root, 'div', 'card-body ext-body');
    if (!projectId) { add(body, 'p', 'empty', 'Selecione um projeto.'); body.append(status); return; }
    const form = add(body, 'form', 'ext-generate');
    const label = add(form, 'label', 'field', 'Pedido');
    const input = add(label, 'input'); input.name = 'request'; input.maxLength = 500; input.value = 'Verificar links quebrados nos assets do projeto';
    const generate = add(form, 'button', 'secondary', 'Gerar nova versão'); generate.type = 'submit'; generate.disabled = busy;
    form.addEventListener('submit', event => { event.preventDefault(); void mutate('/api/extensions/generate', { request: input.value }, row => { status.textContent = `Versão ${row.version} gerada. Revise o código e pré-visualize antes de ativar.`; }); });
    const enabled = registry?.enabled;
    add(body, 'p', 'microcopy', enabled ? `Ativa: versão ${enabled.version}.` : 'Nenhuma versão ativa. Uma versão só pode ser ativada depois de passar na pré-visualização e ser revisada.');
    const actions = add(body, 'div', 'ext-actions');
    const run = add(actions, 'button', 'button', 'Verificar links agora'); run.type = 'button'; run.disabled = busy || !enabled;
    run.addEventListener('click', () => void mutate('/api/extensions/run', {}, result => { report = result; }));
    const disable = add(actions, 'button', 'ghost', 'Desativar'); disable.type = 'button'; disable.disabled = busy || !enabled;
    disable.addEventListener('click', () => void mutate('/api/extensions/disable', { expectedRevision: registry.revision }, () => { report = null; status.textContent = 'Mini-tool desativado; o app continua igual.'; }));
    const rollback = add(actions, 'button', 'ghost', 'Restaurar versão anterior'); rollback.type = 'button'; rollback.disabled = busy || !enabled;
    rollback.addEventListener('click', () => void mutate('/api/extensions/rollback', { expectedRevision: registry.revision }, () => { status.textContent = 'Versão anterior restaurada.'; }));
    if (report) {
      const box = add(body, 'section', 'ext-report'); box.setAttribute('aria-label', 'Resultado do verificador');
      if (!report.ok) add(box, 'p', 'catalog-error', `Falhou fechado (${report.reason}): ${report.error}`);
      else {
        const missing = report.result.missing ?? [];
        add(box, 'p', 'microcopy', `Versão ${report.version}: ${report.result.checked} arquivos de texto, ${report.result.references} referências locais, ${missing.length} quebradas${report.truncated ? ' · resultado limitado' : ''}.`);
        const list = add(box, 'ul', 'ext-missing');
        for (const item of missing.slice(0, 200)) add(list, 'li', '', `${item.file}:${item.line} → ${item.ref}`);
        if (!missing.length) add(list, 'li', '', 'Nenhuma referência local quebrada.');
      }
    }
    const versions = add(body, 'div', 'ext-versions');
    for (const row of [...(registry?.versions ?? [])].reverse()) {
      const item = add(versions, 'article', 'list-item');
      const top = add(item, 'div', 'topline'); add(top, 'strong', 'title', `Versão ${row.version}`);
      add(top, 'span', 'scope-badge', row.preview ? (row.preview.ok ? 'pré-visualização aprovada' : `pré-visualização falhou${row.preview.reason ? ` (${row.preview.reason})` : ''}`) : 'sem pré-visualização');
      add(item, 'div', 'meta', `${row.manifest.title} · SHA-256 ${row.sha256.slice(0, 12)}… · ${row.review ? `revisada ${row.review.at}` : 'não revisada'}`);
      const code = add(item, 'details'); add(code, 'summary', '', 'Ver código e manifesto');
      const target = add(code, 'div');
      code.addEventListener('toggle', () => { if (code.open && !code.loaded) { code.loaded = true; void showSource(row, target); } });
      const controls = add(item, 'div', 'ext-actions');
      const preview = add(controls, 'button', 'secondary', 'Pré-visualizar nos fixtures'); preview.type = 'button'; preview.disabled = busy;
      preview.addEventListener('click', () => void mutate('/api/extensions/preview', { version: row.version, expectedRevision: registry.revision }, result => { status.textContent = result.ok ? `Versão ${row.version}: pré-visualização aprovada.` : `Versão ${row.version}: pré-visualização falhou.`; }));
      const reviewLabel = add(controls, 'label', 'ext-check'); const reviewed = add(reviewLabel, 'input'); reviewed.type = 'checkbox';
      reviewLabel.append(document.createTextNode(` Revisei o código e o manifesto da versão ${row.version}`));
      const enable = add(controls, 'button', 'button', `Ativar versão ${row.version}`); enable.type = 'button';
      enable.disabled = busy || !row.preview?.ok || enabled?.version === row.version;
      enable.addEventListener('click', () => {
        if (!reviewed.checked) { status.textContent = 'Marque a revisão do código e do manifesto antes de ativar.'; return; }
        void mutate('/api/extensions/enable', { version: row.version, reviewed: true, expectedRevision: registry.revision }, () => { status.textContent = `Versão ${row.version} ativada.`; });
      });
    }
    body.append(status);
  }

  return { load, sync() { if (projectId !== getProjectId()) { report = null; void load(); } } };
}
