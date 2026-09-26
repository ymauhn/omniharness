import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runExtension } from './extension-runner.mjs';
import { SKIP_DIRS } from './core.mjs';
import { writeFileAtomic } from './lib/fsutil.mjs';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extension-templates', 'asset-link-checker.js');
const EXTENSION_ID = 'asset-link-checker';
const TEXT = new Set(['.md', '.markdown', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.tex', '.txt', '.yml', '.yaml', '.svg']);
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_VERSIONS = 32;

// Fixture the preview runs before any real project data is exposed to a version.
const PREVIEW = {
  files: [
    { path: 'README.md', text: '![logo](assets/logo.png) [guia](docs/guia.md)\n[falta](assets/falta.png) [web](https://example.com) [topo](#topo)' },
    { path: 'assets/logo.png' },
    { path: 'docs/guia.md', text: '[voltar](../README.md)\n<img src="../assets/perdido.svg">' },
    { path: 'site/index.html', text: '<link href="style.css"><script src="app.js"></script>' },
    { path: 'site/style.css', text: 'body { background: url("../assets/logo.png"); }' },
  ],
  missing: ['README.md:2:assets/falta.png', 'docs/guia.md:2:../assets/perdido.svg', 'site/index.html:1:app.js'],
};

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Scoped, bounded view of one project: every file path plus the text of small text files. */
export async function projectSnapshot(root, { maxFiles = 5000, maxDirs = 2000, maxMs = 3000, maxText = 256 * 1024, maxTotal = 4 * 1024 * 1024 } = {}) {
  const files = [], pending = [''], deadline = Date.now() + maxMs;
  let total = 0, truncated = false, skipped = 0, dirs = 0;
  const full = () => files.length >= maxFiles || Date.now() >= deadline;
  while (pending.length) {
    if (dirs++ >= maxDirs || full()) { truncated = true; break; }
    const relative = pending.pop();
    let entries;
    try { entries = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true }); }
    catch { skipped++; continue; }
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) pending.push(file); continue; }
      if (!entry.isFile()) continue;
      if (full()) { truncated = true; break; }
      const row = { path: file };
      if (TEXT.has(path.extname(entry.name).toLowerCase())) {
        try {
          const { size } = await fs.promises.stat(path.join(root, file));
          if (size <= maxText && total + size <= maxTotal) { row.text = await fs.promises.readFile(path.join(root, file), 'utf8'); total += size; }
          else truncated = true;
        } catch { skipped++; }
      }
      files.push(row);
    }
  }
  return { files, truncated, skipped };
}

/**
 * Per-project registry of generated mini-tools under <dataDir>/extensions. A version is created from the reviewed
 * template, must pass a preview on fixtures, needs an explicit review to be enabled, and runs only while its
 * module still matches the recorded hash. The core app never loads extension code.
 */
export class ExtensionService {
  constructor({ dataDir, templateSource = null, timeoutMs = 5000 }) {
    this.root = path.join(dataDir, 'extensions');
    this.templateSource = templateSource;
    this.timeoutMs = timeoutMs;
  }

  file(projectId) {
    if (!ID.test(String(projectId))) fail('Projeto inválido');
    return path.join(this.root, `${projectId}.json`);
  }

  list(projectId) {
    try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 1, revision: 0, versions: [], enabled: null, history: [] }; throw error; }
  }

  save(projectId, registry, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision)) fail('Revisão esperada inválida');
    const current = this.list(projectId);
    if (expectedRevision !== current.revision) fail('Registro de extensões mudou; atualize e confirme a revisão', 409);
    registry.revision = current.revision + 1;
    fs.mkdirSync(this.root, { recursive: true });
    writeFileAtomic(this.file(projectId), JSON.stringify(registry, null, 2));
    return registry;
  }

  version(registry, number) {
    const row = registry.versions.find(item => item.version === number);
    if (!row) fail('Versão da extensão não encontrada', 404);
    return row;
  }

  async generate(projectId, request) {
    if (typeof request !== 'string' || !/link|refer|quebrad|broken/i.test(request) || !/asset|arquivo|imagem|m[íi]dia|link/i.test(request)) {
      fail('Esta versão gera apenas o verificador de links de assets do projeto (somente leitura).', 422);
    }
    const registry = this.list(projectId);
    if (registry.versions.length >= MAX_VERSIONS) fail('Limite de versões desta extensão atingido', 409);
    const version = (registry.versions.at(-1)?.version ?? 0) + 1;
    const source = this.templateSource ?? fs.readFileSync(TEMPLATE, 'utf8');
    const dir = path.join(this.root, projectId, EXTENSION_ID, `v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    const modulePath = path.join(dir, 'module.js');
    fs.writeFileSync(modulePath, source);
    const row = { id: EXTENSION_ID, version, sha256: sha256(source), path: modulePath, request: request.slice(0, 500), createdAt: new Date().toISOString(),
      manifest: { id: EXTENSION_ID, version, entry: 'module.js', title: 'Verificador de links de assets', inputs: ['caminhos dos arquivos do projeto', 'texto de arquivos de texto pequenos'],
        output: 'referências locais que não existem no projeto', capabilities: [], actions: [], generator: 'template revisado · sem modelo' },
      preview: null, review: null };
    registry.versions.push(row);
    registry.history.push({ action: 'generate', version, at: row.createdAt });
    this.save(projectId, registry, registry.revision);
    return row;
  }

  async preview(projectId, number, { expectedRevision } = {}) {
    const registry = this.list(projectId);
    const row = this.version(registry, number);
    // Refuse a stale or missing revision before paying for a sandbox run; save() re-checks after it.
    if (!Number.isSafeInteger(expectedRevision)) fail('Revisão esperada inválida');
    if (expectedRevision !== registry.revision) fail('Registro de extensões mudou; atualize e confirme a revisão', 409);
    const verdict = await this.execute(row, { files: PREVIEW.files });
    const got = verdict.ok ? (verdict.result.missing ?? []).map(item => `${item.file}:${item.line}:${item.ref}`).sort() : null;
    const ok = verdict.ok && JSON.stringify(got) === JSON.stringify([...PREVIEW.missing].sort());
    row.preview = { ok, at: new Date().toISOString(), expected: PREVIEW.missing, got, reason: verdict.ok ? null : verdict.reason, error: verdict.ok ? null : verdict.error };
    this.save(projectId, registry, expectedRevision);
    return row.preview;
  }

  async enable(projectId, number, { reviewed, expectedRevision } = {}) {
    const registry = this.list(projectId);
    const row = this.version(registry, number);
    if (!row.preview?.ok) fail('Esta versão ainda não passou na pré-visualização', 409);
    if (reviewed !== true) fail('Confirme a revisão do código e do manifesto antes de ativar', 400);
    if (sha256(fs.readFileSync(row.path)) !== row.sha256) fail('O módulo mudou depois da geração; gere uma nova versão', 409);
    row.review = { by: 'local-owner', at: new Date().toISOString() };
    if (registry.enabled && registry.enabled.version !== number) (registry.previous ??= []).push(registry.enabled.version);
    registry.enabled = { id: row.id, version: number };
    registry.history.push({ action: 'enable', version: number, at: row.review.at });
    return this.save(projectId, registry, expectedRevision);
  }

  async disable(projectId, { expectedRevision } = {}) {
    const registry = this.list(projectId);
    registry.history.push({ action: 'disable', version: registry.enabled?.version ?? null, at: new Date().toISOString() });
    if (registry.enabled) (registry.previous ??= []).push(registry.enabled.version);
    registry.enabled = null;
    return this.save(projectId, registry, expectedRevision);
  }

  /** `previous` is a stack of the versions that were active before each enable or disable; rollback pops it. */
  async rollback(projectId, { expectedRevision } = {}) {
    const registry = this.list(projectId);
    // Re-enabling after a disable leaves the active version on top; restoring it would change nothing.
    while (registry.previous?.length && registry.previous.at(-1) === registry.enabled?.version) registry.previous.pop();
    const previous = registry.previous?.pop();
    if (previous === undefined) fail('Não há versão ativada anterior para restaurar', 409);
    registry.enabled = { id: EXTENSION_ID, version: previous };
    registry.history.push({ action: 'rollback', version: previous, at: new Date().toISOString() });
    return this.save(projectId, registry, expectedRevision);
  }

  async run(projectId, projectRoot) {
    const registry = this.list(projectId);
    if (!registry.enabled) return { ok: false, reason: 'disabled', error: 'Nenhuma versão ativada para este projeto' };
    const snapshot = await projectSnapshot(projectRoot);
    // A disable or rollback during the snapshot wins: only the version still enabled now may run.
    const current = this.list(projectId);
    if (current.enabled?.version !== registry.enabled.version) return { ok: false, reason: 'disabled', error: 'A versão ativa mudou durante a leitura do projeto' };
    const verdict = await this.execute(this.version(current, current.enabled.version), { files: snapshot.files });
    return { ...verdict, version: current.enabled.version, truncated: snapshot.truncated, skipped: snapshot.skipped };
  }

  /** The bytes hashed here are the bytes the child runs: it gets them on stdin and never reads the module file. */
  async execute(row, input) {
    let source = null;
    try { const bytes = fs.readFileSync(row.path); if (sha256(bytes) === row.sha256) source = bytes.toString('utf8'); } catch { /* missing module */ }
    if (source === null) return { ok: false, reason: 'denied', error: 'O módulo não corresponde ao hash registrado' };
    return runExtension({ source, input, timeoutMs: this.timeoutMs });
  }
}
