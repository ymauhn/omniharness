// Reviewed template: read-only project asset-link checker (OmniForge generated mini-tool, V1).
// Runs inside the extension sandbox: plain script, no imports, no host objects. Input: { files: [{ path, text? }] }
// with project-relative paths; only text files carry text. Output: plain data listing references to files that
// are not part of the project snapshot. External URLs, protocol links and in-page anchors are not checked.
function check(input) {
  const files = Array.isArray(input && input.files) ? input.files : [];
  const known = new Set(files.map(file => normalize(file.path)));
  const patterns = [/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi, /url\(\s*["']?([^"')]+)["']?\s*\)/gi];
  const missing = [];
  let references = 0, checked = 0;
  for (const file of files) {
    if (typeof file.text !== 'string') continue;
    checked++;
    file.text.split('\n').forEach((line, index) => {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line))) {
          const ref = match[1];
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
          references++;
          const target = resolve(file.path, ref.split(/[?#]/)[0]);
          if (target !== null && !known.has(target)) missing.push({ file: file.path, line: index + 1, ref });
        }
      }
    });
  }
  return { checked, references, missing };
}

function normalize(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

// Resolve a reference against the referring file; null when it climbs above the project root.
function resolve(from, ref) {
  let decoded = ref;
  try { decoded = decodeURIComponent(ref); } catch { /* keep the raw reference */ }
  const parts = decoded.startsWith('/') ? [] : normalize(from).split('/').slice(0, -1);
  for (const segment of decoded.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(segment.toLowerCase());
  }
  return parts.join('/');
}
