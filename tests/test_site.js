'use strict'
// Zero-token checks for the portal: every node a flow step cites exists in the skills graph; the source keeps its
// placeholders; the public edition carries no member template; no credential field anywhere; the community CTAs use the
// issue form; the calorimeter agrees with the committed E1 audit, its status links cover their rows, and nothing claims
// proof while no record is certified; member access is interest only; "This page" states its own weight; the offer is stated plainly.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const zlib = require('zlib')

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
const norm = (s) => s.replace(/\s+/g, ' ').trim(), text = (s) => s.replace(/<[^>]+>/g, ' ')
const ptOf = (html, what) => { const v = pt[norm(html)]; assert(v, 'pt-BR has no entry for ' + what + ': ' + norm(html).slice(0, 80)); return v }

// Markdown sections by GitHub anchor: a status link is evidence only if the section it opens names the row it labels.
const GH = 'https://github.com/ymauhn/omniharness/blob/master/'
const slug = (h) => h.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-')
const sectionsOf = (rel) => Object.fromEntries(fs.readFileSync(path.join(root, rel), 'utf8').split(/^#{1,6} /m).slice(1).map((s) => [slug(s.split(/\r?\n/)[0]), s]))
function evidence(href) {
  const [rel, anchor] = href.replace(GH, '').split('#')
  if (!anchor) return fs.readFileSync(path.join(root, rel), 'utf8')
  const sec = sectionsOf(rel)[anchor]
  assert(sec, 'a link opens an anchor with no heading: ' + href)
  return sec
}

// With no certified record, the hero, the rail and the calorimeter make no proof or measured-outcome claim, in either
// language, and every "N invalid/unverified/certified" count they state is the E1 summary's.
const CLAIM = /\bproofs?\b|\bprov(?:e|es|en|ed)\b|\bmeasured\b|\bprovas?\b|\bcomprova\w*|\bmedid[ao]s?\b/i
const COUNTS = { invalid: audit.summary.invalid, unverified: audit.summary.unverified, certified: audit.summary.certified_valid }
const zonesOf = (page) => ['<nav class="rail"[\\s\\S]*?</nav>', '<section id="event"[\\s\\S]*?</section>', '<section id="calorimeter"[\\s\\S]*?</section>'].map((re) => (page.match(new RegExp(re)) || [''])[0])

function checkPage(page, label) {
  assert(!/\/discussions\b/.test(page), label + ': a link points to the disabled GitHub Discussions')
  assert(page.split(FORM).length - 1 >= 4, label + ': the community CTAs route to the issue form')
  const body = (page.match(/<section id="calorimeter"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/) || [])[1]
  assert(body, label + ': calorimeter table present')
  const rows = [...body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
  let audited = 0
  const statuses = {}
  for (const [, attrs, cells] of rows) {
    const validity = (attrs.match(/data-validity="([^"]+)"/) || [])[1], record = (attrs.match(/data-record="([^"]+)"/) || [])[1]
    const name = (cells.match(/<b>([^<]+)<\/b>/) || [])[1]
    assert(validity, label + ': calorimeter row without data-validity: ' + name)
    const bench = (name.match(/^B(\d)/) || [])[1]
    if (bench && record) (statuses[bench] = statuses[bench] || new Set()).add(validity)
    if (record) {
      audited++
      assert(record in verdict, label + ': ' + name + ' cites a record the E1 audit does not have: ' + record)
      assert.strictEqual(validity, verdict[record], label + ': ' + name + ' is ' + validity + ' on the page, ' + verdict[record] + ' in the E1 audit')
    } else assert(validity === 'offline' || validity === 'unverified', label + ': ' + name + ': only offline or unverified rows may lack an audit record')
    if (validity !== 'valid' && validity !== 'offline') {
      const text = cells.replace(/<[^>]+>/g, ' ')
      assert(!/class="st ok"/.test(cells) && !/\bPASS\b/.test(text) && !/\bvalid\b/.test(text), label + ': ' + name + ' (' + validity + ') is rendered as valid/PASS')
      // the status link opens evidence about this row: its record's timestamp, or the statement that it has no runner record
      const link = (cells.match(/<span class="st [^"]*"><\/span><a href="([^"]+)"/) || [])[1]
      assert(link && link.startsWith(GH), label + ': ' + name + ' (' + validity + ') does not link its evidence')
      const needle = record ? record.slice(0, 15) : 'no runner record'
      assert(evidence(link).includes(needle), label + ': ' + name + ' links ' + link + ', which does not cover it (' + needle + ')')
    }
  }
  assert(audited >= 6, label + ': at least six calorimeter rows are tied to E1 records, found ' + audited)
  if (!audit.summary.certified_valid) assert(!/\bPASS\b/.test(page), label + ': no record is certified, yet the page says PASS')
  const zones = zonesOf(page)
  assert(zones.every(Boolean), label + ': rail, hero and calorimeter present')
  for (const z of zones) {
    if (!audit.summary.certified_valid) assert(!CLAIM.test(text(z)), label + ': 0 certified records, yet it claims proof: ' + (text(z).match(CLAIM) || [])[0])
    for (const [, n, w] of text(z).matchAll(/\b(\d+) (invalid|unverified|certified)\b/g)) assert.strictEqual(+n, COUNTS[w], label + ': says ' + n + ' ' + w + ', E1 says ' + COUNTS[w])
  }
  // a run-log case study names the E1 status of every record it draws on (an invalid record's outcome is not a fact)
  const log = (page.match(/<ul class="rows" id="rows">([\s\S]*?)<\/ul>/) || [])[1]
  for (const [, li] of log.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const bench = (li.match(/docs\/benchmarks\.md#b(\d)-/) || [])[1]
    for (const s of bench ? statuses[bench] || [] : []) assert(new RegExp('\\b' + s + '\\b').test(text(li)), label + ': the B' + bench + ' case study hides that a record is ' + s)
  }
  // member access: interest only, through the public form, an optional handle, a plain warning; no private hand-off promised
  const member = (page.match(/<p class="note">((?:(?!<\/p>)[\s\S])*Member access[\s\S]*?)<\/p>/) || [])[1]
  assert(member && member.includes(FORM), label + ': the member-access note routes to the issue form')
  assert(/handle[^.]*optional|optional[^.]*handle/i.test(member) && /never post[^.]*e-?mail/i.test(member), label + ': the member-access note: optional handle, never post an email')
  assert(!/privately|share[sd]? (?:the|a) (?:edition|link)/i.test(member), label + ': the member-access note promises a private hand-off the public issue cannot carry')
  // "This page" reports the weight of the file it is in
  const weightCell = (page.match(/<b>This page<\/b>[\s\S]*?<\/td><td[^>]*>([\s\S]*?)<\/td>/) || [])[1]
  const built = (weightCell || '').match(/(\d+) KB raw · (\d+) KB deflated/)
  if (label !== 'source') {
    assert(built, label + ': "This page" states its weight')
    const raw = Buffer.byteLength(page) / 1024, def = zlib.deflateSync(Buffer.from(page), { level: 9 }).length / 1024
    assert(Math.abs(built[1] - raw) <= 1 && Math.abs(built[2] - def) <= 1, label + ': "This page" says ' + built[0] + ', the file is ' + raw.toFixed(1) + ' KB raw · ' + def.toFixed(1) + ' KB deflated')
  }
  for (const n of aggregate) assert(!labelled(n, 'out|output').test(page), label + ': ' + n + ' is aggregate usage (E1), labelled as output tokens')
}
checkPage(src, 'source')
for (const v of Object.values(pt)) assert(!/\bPASS\b/.test(v) && !/\/discussions\b/.test(v), 'pt-BR: PASS or a Discussions link: ' + v.slice(0, 80))
for (const n of aggregate) assert(!Object.values(pt).some((v) => labelled(n, 'out|output|saída|tokens de saída').test(v)), 'pt-BR labels ' + n + ' as output tokens')

// The same truthfulness in PT-BR: the headings of the claim zones, the case studies and the member note are translated
// and say what the English says.
const [rail, hero, cal] = zonesOf(src)
const PT_COUNTS = { 'inválidos?': COUNTS.invalid, 'não verificados?': COUNTS.unverified, 'certificados?': COUNTS.certified }
for (const [what, html] of [['the rail', rail.match(/<a href="#calorimeter">[\s\S]*?<\/a>/)[0].replace(/^<a[^>]*>|<\/a>$/g, '')], ['the headline', hero.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]],
  ['the hero prose', hero.match(/<p class="prose">([\s\S]*?)<\/p>/)[1]], ['the calorimeter heading', cal.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1]],
  ['the calorimeter plate', cal.match(/<span class="plate">([\s\S]*?)<\/span>/)[1]], ['the calorimeter lede', cal.match(/<p class="lede">([\s\S]*?)<\/p>/)[1]]]) {
  const v = text(ptOf(html, what))
  if (!audit.summary.certified_valid) assert(!CLAIM.test(v), 'pt-BR ' + what + ' claims proof with 0 certified records: ' + v)
  for (const [w, n] of Object.entries(PT_COUNTS)) for (const [, m] of v.matchAll(new RegExp('\\b(\\d+) ' + w + '\\b', 'g'))) assert.strictEqual(+m, n, 'pt-BR ' + what + ' says ' + m + ' ' + w)
}
const PT_STATUS = { invalid: /inválid/, unverified: /não verificad/ }
for (const [, li] of src.match(/<ul class="rows" id="rows">([\s\S]*?)<\/ul>/)[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
  if (!/docs\/benchmarks\.md#b\d-/.test(li)) continue
  const parts = [li.match(/<a [^>]*>([\s\S]*?)<\/a>/)[1], li.match(/<span class="d">([\s\S]*?)<\/span>/)[1], li.match(/<span class="tag">([\s\S]*?)<\/span>/)[1]]
  const en = text(parts.join(' ')), v = parts.map((p) => ptOf(p, 'a case study')).join(' ')
  for (const [s, re] of Object.entries(PT_STATUS)) if (new RegExp('\\b' + s + '\\b').test(en)) assert(re.test(v), 'pt-BR case study drops "' + s + '": ' + v)
}
const memberPt = ptOf(src.match(/<p class="note">((?:(?!<\/p>)[\s\S])*Member access[\s\S]*?)<\/p>/)[1], 'the member note')
assert(/opcional/.test(memberPt) && /e-mail/.test(memberPt) && !/em privado|privadamente/.test(memberPt), 'pt-BR member note: optional handle, email warning, no private hand-off: ' + memberPt)
assert(/id: handle\n(?:(?!\n {2}- type:)[\s\S])*required: false/.test(form), 'issue form: the handle is optional')
assert(/e-?mail/i.test(form), 'issue form warns not to post an email address')

// A benchmarks.md section the page cites as its source cannot claim what E1 denies: with no certified record, a line
// there that says valid or PASS must name E1 (an anchor jump skips the page header's E1 caveat).
const sections = sectionsOf('docs/benchmarks.md')
const anchors = [...new Set([...src.matchAll(/docs\/benchmarks\.md#([\w-]+)/g)].map((m) => m[1]))]
assert(anchors.length >= 2, 'the case studies link their benchmarks.md sections, found ' + anchors.length)
for (const a of anchors) {
  assert(a in sections, 'the page links a benchmarks.md anchor with no heading: ' + a)
  const claims = sections[a].split(/\r?\n/).filter((l) => /\bvalid\b|\bPASS\b/.test(l) && !/\bE1\b/.test(l))
  if (!audit.summary.certified_valid) assert.deepStrictEqual(claims, [], 'benchmarks.md#' + a + ' claims validity the E1 audit does not grant')
}

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
