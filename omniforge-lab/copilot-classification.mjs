function fail(status, message) { throw Object.assign(new Error(message), { status }); }

export function classifierError(error) {
  if (error.code === 'queue_full') return Object.assign(new Error('Laya ocupado. A busca local continua disponível.'), { status: 429 });
  return Object.assign(new Error('Classificador local indisponível. Use a busca local ou tente ativá-lo novamente.'), { status: 503 });
}

function boundedDescription(value) {
  let result = '', bytes = 0;
  for (const character of String(value || '')) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 256) break;
    result += character; bytes += size;
  }
  return result;
}

// The installed catalog's lexical top three for a prompt (best first) and the classifier shortlist built from them.
export async function skillCandidates(catalog, prompt) {
  const result = await catalog.request({ op: 'list', q: prompt, ring: 'installed', host: 'codex', limit: 3, offset: 0 });
  if (!result || typeof result.snapshot_id !== 'string' || !Array.isArray(result.rows)) fail(503, 'Catálogo indisponível.');
  const rows = result.rows.filter(row => row.ring === 'installed' && row.availability === 'installed').slice(0, 3);
  const candidates = rows.map(row => ({ source_id: row.skill_id, description: boundedDescription(row.metadata?.functional_description || row.description) }))
    .filter(row => row.description.trim());
  return { snapshotId: result.snapshot_id, rows, candidates };
}

export async function classifyPrompt({ input, store, catalog, classifier }) {
  if (Object.keys(input).some(key => !['projectId', 'prompt'].includes(key)) || typeof input.prompt !== 'string' ||
      !input.prompt.trim() || Buffer.byteLength(input.prompt, 'utf8') > 2048) fail(400, 'Trecho inválido: use até 2.048 bytes e selecione um projeto.');
  const project = store.project(input.projectId);
  if (!classifier.status().enabled) fail(409, 'Ative Laya local para classificar. A busca por metadados funciona sem ele.');
  const { snapshotId, candidates } = await skillCandidates(catalog, input.prompt);
  let selection = { provider: 'laya', source_id: null, reason: 'no_candidates', usage: { input_tokens: null, output_tokens: null }, runnable: false };
  if (candidates.length) {
    try { selection = await classifier.select(input.prompt, candidates); }
    catch (error) { throw classifierError(error); }
    if (selection?.provider !== 'laya' || selection.runnable !== false ||
        (selection.source_id !== null && !candidates.some(row => row.source_id === selection.source_id))) fail(503, 'Seleção local inválida.');
  }
  return { ...selection, projectId: project.id, snapshot_id: snapshotId };
}
