'use strict'
// Zero-token checks for the portal: every node a flow step cites exists in the skills graph; the source keeps its
// placeholders; the public edition carries no member template; no credential field anywhere.
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8')
const graph = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'skills-graph', 'graph.json'), 'utf8'))
const ids = new Set(graph.nodes.map((n) => n.id))

const steps = [...src.matchAll(/data-nodes="([^"]+)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean))
assert(steps.length >= 6, 'at least six flow steps cite nodes, found ' + steps.length)
const missing = steps.flat().filter((id) => !ids.has(id))
assert.deepStrictEqual(missing, [], 'flow steps cite nodes the graph does not have: ' + missing.join(', '))

assert(/<script id="graph-data" type="application\/json">\s*\{\}\s*<\/script>/.test(src), 'source keeps an empty graph-data placeholder')
assert(!/type="password"/.test(src), 'no password field, ever')
assert(!/<form[^>]*action=/.test(src), 'no form posts anywhere')

const guides = [...src.matchAll(/data-guide="([^"]+)"/g)].map((m) => m[1])
assert(guides.length >= 5, 'member guide templates present: ' + guides.join(', '))

const pub = path.join(root, 'site', 'public', 'index.html')
if (fs.existsSync(pub)) {
  const p = fs.readFileSync(pub, 'utf8')
  assert(!/<template data-members/.test(p), 'public edition carries no member template')
  assert(/data-edition="public"/.test(p), 'public edition is marked')
  assert(/"nodes":\[\{/.test(p), 'public edition carries the graph data')
  assert(!/type="password"/.test(p))
}
console.log('PASS site: ' + steps.length + ' flow steps, ' + steps.flat().length + ' node citations resolved, ' + guides.length + ' guide templates' + (fs.existsSync(pub) ? ', public edition checked' : ''))
