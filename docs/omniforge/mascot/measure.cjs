const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const files = ['index.html', 'style.css', 'app.js', 'model.js'];
const assets = files.map(file => {
  const bytes = fs.readFileSync(path.join(__dirname, file));
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
console.log(JSON.stringify({ method: 'gzip level 9 per file; local source assets, not a measured HTTP transfer', node: process.version, assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), totalGzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0), cpu: null, fps: null, browserVerified: false }, null, 2));
