export function utf8Excerpt(text, limit = 2048) {
  let result = '', bytes = 0;
  const encoder = new TextEncoder();
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > limit) break;
    result += character; bytes += size;
  }
  return result;
}

export function classifiedCandidates(rows, selection, snapshotId, projectId) {
  const fallback = label => ({ rows, label: `${label} · ordem por metadados locais.` });
  if (selection?.provider !== 'laya' || selection.runnable !== false || selection.snapshot_id !== snapshotId || selection.projectId !== projectId) return fallback('Classificação não confirmada');
  if (selection.reason !== 'selected' || !rows.some(row => row.skill_id === selection.source_id)) {
    const reasons = { below_threshold: 'Laya absteve-se por confiança insuficiente', selected_fit_failed: 'Laya não confirmou adequação', none: 'Laya não encontrou escolha direta', no_candidates: 'Sem candidatos para classificar' };
    return fallback(reasons[selection.reason] || 'Laya sem seleção válida');
  }
  return { rows: [...rows].sort((a, b) => Number(b.skill_id === selection.source_id) - Number(a.skill_id === selection.source_id)),
    label: 'Laya priorizou uma candidata · adequação ainda deve ser conferida; nenhuma execução autorizada.' };
}

export function mountClassifierControls({ root, api, getProjectId, onChange }) {
  const add = (parent, tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; };
  const field = add(root, 'label', 'Triagem de skills'); field.className = 'cp-field';
  const choice = add(field, 'select');
  for (const [value, text] of [['lexical', 'Metadados · sem modelo'], ['laya', 'Laya local · opcional']]) { const option = add(choice, 'option', text); option.value = value; }
  const controls = add(root, 'div'); controls.className = 'cp-actions';
  const status = add(root, 'p', 'Verificando estado do Laya… Metadados locais permanecem disponíveis.'); status.className = 'microcopy'; status.setAttribute('role', 'status');
  const note = add(root, 'p', 'Laya pode ocupar cerca de 1,6 GiB neste host e demora na primeira carga. Descarregar afeta este aplicativo inteiro. JEV não é usado nesta triagem. Só “Sugerir host e skill”, nas Tarefas, pode usá-lo: com chave Jev no cofre do Windows e sua confirmação a cada pedido.'); note.className = 'microcopy';
  let generation = 0, preferenceRevision = 0, busy = false;
  const makeButton = (label, handler) => { const button = add(controls, 'button', label); button.type = 'button'; button.className = 'secondary'; button.addEventListener('click', handler); return button; };
  const activate = makeButton('Carregar Laya', () => changeState('enable'));
  const unload = makeButton('Descarregar Laya', () => changeState('disable'));
  makeButton('Verificar estado', () => refresh());
  function setBusy(value) { busy = value; activate.disabled = value; unload.disabled = value; }
  function show(value) {
    const labels = { off: 'descarregado', warming: 'carregando', ready: 'pronto', busy: 'classificando', unavailable: 'indisponível', stopped: 'descarregado' };
    status.textContent = `Laya ${labels[value?.state] || 'com estado desconhecido'} · ${Number.isInteger(value?.queued) ? value.queued : 0} na fila. Metadados locais permanecem disponíveis.`;
  }
  async function refresh() {
    if (busy) return;
    const request = ++generation;
    try { const result = await api('/api/copilot/status'); if (request === generation) show(result); }
    catch { if (request === generation) status.textContent = 'Não foi possível verificar Laya. Metadados locais permanecem disponíveis.'; }
  }
  async function changeState(operation) {
    if (busy) return;
    const projectId = getProjectId(), revision = preferenceRevision, request = ++generation;
    setBusy(true); status.textContent = operation === 'enable' ? 'Carregando Laya local… Pode levar até um minuto.' : 'Descarregando Laya…';
    try {
      const result = await api(`/api/copilot/${operation}`, { method: 'POST', body: {} });
      if (request !== generation) return;
      show(result);
      if (projectId === getProjectId() && revision === preferenceRevision) { choice.value = operation === 'enable' && result.enabled ? 'laya' : 'lexical'; preferenceRevision++; onChange(); }
    } catch { if (request === generation) status.textContent = 'Laya não ficou disponível. Use metadados locais; confira o runtime instalado.'; }
    finally { setBusy(false); }
  }
  choice.addEventListener('change', () => { preferenceRevision++; onChange(); });
  return {
    mode: () => choice.value,
    setMode(value) { choice.value = value === 'laya' ? 'laya' : 'lexical'; preferenceRevision++; },
    refresh,
    async classify({ text, rows, snapshotId, projectId }) {
      if (choice.value !== 'laya') return { rows, label: 'Correspondência lexical; confira a adequação.' };
      try {
        const selection = await api('/api/copilot/classify', { method: 'POST', body: { projectId, prompt: utf8Excerpt(text) } });
        return classifiedCandidates(rows, selection, snapshotId, projectId);
      } catch { return { rows, label: 'Laya indisponível ou ocupado · ordem por metadados locais.' }; }
      finally { refresh(); }
    },
  };
}
