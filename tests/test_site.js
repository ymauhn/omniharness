'use strict'
// Zero-token checks for the portal: every node a flow step cites exists in the skills graph; the source keeps its
// placeholders; the public edition carries no member template; no credential field anywhere; the community CTAs use the
// issue form; the calorimeter agrees with the committed E1 audit; the offer is stated plainly.
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

// The community door is the public issue form: Discussions is disabled on the repository, so no link may point there.
const FORM = 'https://github.com/ymauhn/omniharness/issues/new?template=community-interest.yml'
const ptPath = path.join(root, 'site', 'i18n', 'pt-BR.json'), enPath = path.join(root, 'site', 'i18n', 'en.json')
const pt = JSON.parse(fs.readFileSync(ptPath, 'utf8')), en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
const form = fs.readFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'community-interest.yml'), 'utf8')
assert(/type: checkboxes/.test(form) && /type: textarea/.test(form) && /id: handle/.test(form), 'issue form: handle, interests, use case')
assert(/public/i.test(form) && /credential/i.test(form), 'issue form warns that issues are public: no private data or credentials')

// E1 audit (docs/experiments/eval-history-2026-09.json) decides every audited row; aggregate usage is never "out".
const audit = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'experiments', 'eval-history-2026-09.json'), 'utf8'))
const verdict = Object.fromEntries(audit.records.map((r) => [r.source_file, r.run_valid === true ? 'valid' : r.run_valid === false ? 'invalid' : 'unverified']))
const aggregate = audit.records.filter((r) => r.tokens_total_reported != null).map((r) => r.tokens_total_reported)
const labelled = (n, words) => new RegExp('(' + [n.toLocaleString('en-US'), n.toLocaleString('pt-BR')].map((s) => s.replace(/\./g, '\\.')).join('|') + ')\\s*(' + words + ')')
const offerKey = (src.match(/<p class="offer" id="offer">([\s\S]*?)<\/p>/) || [])[1]

function checkPage(page, label) {
  assert(!/\/discussions\b/.test(page), label + ': a link points to the disabled GitHub Discussions')
  assert(page.split(FORM).length - 1 >= 4, label + ': the community CTAs route to the issue form')
  const body = (page.match(/<section id="calorimeter"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/) || [])[1]
  assert(body, label + ': calorimeter table present')
  const rows = [...body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
  let audited = 0
  for (const [, attrs, cells] of rows) {
    const validity = (attrs.match(/data-validity="([^"]+)"/) || [])[1], record = (attrs.match(/data-record="([^"]+)"/) || [])[1]
    const name = (cells.match(/<b>([^<]+)<\/b>/) || [])[1]
    assert(validity, label + ': calorimeter row without data-validity: ' + name)
    if (record) {
      audited++
      assert(record in verdict, label + ': ' + name + ' cites a record the E1 audit does not have: ' + record)
      assert.strictEqual(validity, verdict[record], label + ': ' + name + ' is ' + validity + ' on the page, ' + verdict[record] + ' in the E1 audit')
    } else assert(validity === 'offline' || validity === 'unverified', label + ': ' + name + ': only offline or unverified rows may lack an audit record')
    if (validity !== 'valid' && validity !== 'offline') {
      const text = cells.replace(/<[^>]+>/g, ' ')
      assert(!/class="st ok"/.test(cells) && !/\bPASS\b/.test(text) && !/\bvalid\b/.test(text), label + ': ' + name + ' (' + validity + ') is rendered as valid/PASS')
      assert(/eval-integrity-2026-09\.md|eval-history-2026-09\.json/.test(cells), label + ': ' + name + ' (' + validity + ') does not link the audit evidence')
    }
  }
  assert(audited >= 6, label + ': at least six calorimeter rows are tied to E1 records, found ' + audited)
  if (!audit.summary.certified_valid) assert(!/\bPASS\b/.test(page), label + ': no record is certified, yet the page says PASS')
  for (const n of aggregate) assert(!labelled(n, 'out|output').test(page), label + ': ' + n + ' is aggregate usage (E1), labelled as output tokens')
}
checkPage(src, 'source')
for (const v of Object.values(pt)) assert(!/\bPASS\b/.test(v) && !/\/discussions\b/.test(v), 'pt-BR: PASS or a Discussions link: ' + v.slice(0, 80))
for (const n of aggregate) assert(!Object.values(pt).some((v) => labelled(n, 'out|output|saída|tokens de saída').test(v)), 'pt-BR labels ' + n + ' as output tokens')

// The offer, stated plainly and translated: local Windows-first workspace in development, library in the repo, interest via the form, nothing for sale.
assert(offerKey, 'the hero states the offer (<p class="offer" id="offer">)')
for (const re of [/Windows-first/, /active development/, /V1 is not complete/, /skills, templates and tutorials/, /[Nn]othing is for sale/, /V1-RELEASE-CONTRACT\.md/])
  assert(re.test(offerKey), 'the offer does not say ' + re)
assert(offerKey.includes(FORM), 'the offer routes to the issue form')
const offerNorm = offerKey.replace(/\s+/g, ' ').trim()
assert(pt[offerNorm] && en.includes(offerNorm), 'the offer is in pt-BR.json and en.json')

const pub = path.join(root, 'site', 'public', 'index.html')
if (fs.existsSync(pub)) {
  const p = fs.readFileSync(pub, 'utf8')
  assert(!/<template data-members/.test(p), 'public edition carries no member template')
  assert(/data-edition="public"/.test(p), 'public edition is marked')
  assert(/"nodes":\[\{/.test(p), 'public edition carries the graph data')
  assert(!/type="password"/.test(p))
  checkPage(p, 'public edition')
  // every node the graph found inside its recorded root links to its source, whichever checkout ran the build
  const built = JSON.parse(p.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
  const hrefs = Object.fromEntries(built.nodes.map((n) => [n.id, n.href]))
  const local = graph.nodes.filter((n) => n.id in hrefs && (n.paths || []).some((q) => q.startsWith(graph.root + '/')))
  assert(local.length >= 5, 'repository nodes in the public graph: ' + local.length)
  const unlinked = local.filter((n) => !hrefs[n.id].startsWith('https://github.com/ymauhn/omniharness/blob/master/')).map((n) => n.id)
  assert.deepStrictEqual(unlinked, [], 'repository nodes lost their source link: ' + unlinked.join(', '))
}
console.log('PASS site: ' + steps.length + ' flow steps, ' + steps.flat().length + ' node citations resolved, ' + guides.length + ' guide templates, calorimeter matches the E1 audit' + (fs.existsSync(pub) ? ', public edition checked' : ''))
