// Assets view: the read-only media inventory table for the selected project's folder.
import { $, one, asArray } from './dom.mjs';
import { local, api, toast, projectById } from './state.mjs';

export function createAssets() {
  async function loadInventory() {
    const project = projectById(local.projectId), request = local.inventoryRequest = (local.inventoryRequest || 0) + 1;
    const button = $('#refresh-assets'), current = () => request === local.inventoryRequest && project?.id === local.projectId;
    if (!project) { local.inventory = null; local.inventoryProjectId = null; renderAssets(); return; }
    button.disabled = true; $('#asset-total').textContent = 'Consultando…';
    try {
      const inventory = await api(`/api/inventory?projectId=${encodeURIComponent(project.id)}`);
      if (!current()) return;
      local.inventory = inventory; local.inventoryProjectId = project.id; renderAssets();
      const skipped = inventory.unreadableDirectories;
      if (skipped) toast(`Inventário parcial: ${skipped} pasta${skipped === 1 ? '' : 's'} sem leitura ignorada${skipped === 1 ? '' : 's'}.`);
    } catch (error) {
      if (!current()) return;
      local.inventory = null; local.inventoryProjectId = null; $('#asset-total').textContent = 'Falha na consulta'; toast(error.message);
    } finally { if (request === local.inventoryRequest) button.disabled = !projectById(local.projectId); }
  }

  function renderAssets() {
    const project = projectById(local.projectId);
    $('#asset-project').textContent = project ? `${project.name} · ${project.root}` : 'Selecione um projeto';
    const inventory = local.inventoryProjectId === local.projectId ? local.inventory : null;
    const files = asArray(inventory?.files);
    $('#asset-total').textContent = inventory ? `${files.length} arquivo${files.length === 1 ? '' : 's'}${inventory.truncated ? ' · resultado limitado' : ''}` : 'Ainda não consultado';
    const counts = $('#asset-counts'); counts.replaceChildren();
    for (const [extension, count] of Object.entries(inventory?.counts || {}).sort()) one(counts, 'span', 'scope-badge', `${extension}  ${count}`);
    const table = $('#asset-table'); table.replaceChildren();
    const q = $('#asset-search').value.trim().toLowerCase();
    const matched = files.filter(file => file.toLowerCase().includes(q));
    for (const file of matched) { const row = one(table, 'tr'); one(row, 'td', '', file); one(row, 'td', '', file.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '—'); }
    if (!matched.length) {
      const row = one(table, 'tr');
      const cell = one(row, 'td', '', inventory ? (files.length ? 'Nenhum asset corresponde ao filtro.' : 'Nenhum asset de mídia encontrado.') : 'Atualize para consultar a pasta do projeto.');
      cell.colSpan = 2;
    }
    $('#refresh-assets').disabled = !project;
  }

  $('#asset-search').addEventListener('input', renderAssets);
  $('#refresh-assets').addEventListener('click', loadInventory);

  return { loadInventory, renderAssets };
}
