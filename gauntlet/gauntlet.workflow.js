export const meta = {
  // 'gauntlet-driver', não 'gauntlet-loop': workflow nomeado também vira comando /nome
  // e colidiria com a skill /gauntlet-loop (que é quem sabe montar os args).
  name: 'gauntlet-driver',
  description:
    'Caça bugs, gargalos e problemas de uso em rodadas paralelas por área, refuta cada achado com lentes independentes e para quando seca, esgota as rodadas ou encosta no teto de tokens',
  whenToUse:
    'Chamado pela skill /gauntlet-loop depois do reconhecimento do diretório e das perguntas de escopo; recebe tudo via args',
  phases: [
    { title: 'Caçar', detail: 'um caçador por área, em rodadas até secar' },
    { title: 'Refutar', detail: 'lentes independentes tentam derrubar cada achado' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// args — tudo vem da skill. Obrigatórios: contexto (texto) e areas ([{key, prompt}]).
// Sem template literal em lugar nenhum: crase dentro de crase já quebrou o parser uma vez.
// ─────────────────────────────────────────────────────────────────────────────
const a = args || {}
if (!a.contexto || !Array.isArray(a.areas) || a.areas.length === 0) {
  throw new Error('gauntlet-loop precisa de args.contexto (texto) e args.areas ([{key, prompt}])')
}

const PRESETS = {
  rapido: { maxRodadas: 2, secasParaParar: 1, numLentes: 2, maxAchadosPorRodada: 8, esforcoCacador: 'medium', esforcoRefutador: 'medium' },
  padrao: { maxRodadas: 5, secasParaParar: 2, numLentes: 3, maxAchadosPorRodada: 20 },
  profundo: { maxRodadas: 8, secasParaParar: 3, numLentes: 4, maxAchadosPorRodada: 40, esforcoRefutador: 'high' },
}
const LENTES_PADRAO = [
  'o código já trata este caso',
  'o cenário não é alcançável usando o software de verdade',
  'a medição ou a leitura do achado está errada',
  'a correção proposta quebra outra coisa ou não resolve o problema',
]
const GRAVIDADES = ['alta', 'media', 'baixa']

const preset = PRESETS[a.preset] || PRESETS.padrao
const maxRodadas = a.maxRodadas ?? preset.maxRodadas
const secasParaParar = a.secasParaParar ?? preset.secasParaParar
const lentes = Array.isArray(a.lentes) && a.lentes.length ? a.lentes : LENTES_PADRAO.slice(0, a.numLentes ?? preset.numLentes)
const maxAchadosPorRodada = a.maxAchadosPorRodada ?? preset.maxAchadosPorRodada
const janelaDup = a.janelaDup ?? 4 // achados no mesmo arquivo a ≤ N linhas de distância são o mesmo bug
const prefixoTmp = a.prefixoTmp || '_gauntlet_'
const esforco = { cacador: a.esforcoCacador ?? preset.esforcoCacador, refutador: a.esforcoRefutador ?? preset.esforcoRefutador }
const modelo = { cacador: a.modeloCacador, refutador: a.modeloRefutador }
const history = a.seen || { records: [] }
if (a.seen && (history.consumer !== 'gauntlet' || !a.seenScope || history.scope !== a.seenScope ||
    !/^[a-f0-9]{64}$/.test(a.seenContext || '') || history.context !== a.seenContext ||
    !Array.isArray(history.records) || history.records.some((r) => !r || !['confirmed', 'refuted'].includes(r.verdict) || !r.id || !r.evidence))) {
  throw new Error('seen snapshot must match the current scope/context and contain judged records')
}
const previouslyJudged = history.records
const previous = new Set(previouslyJudged.map((r) => r.id))
let reused = 0

// ── teto de tokens ───────────────────────────────────────────────────────────
// budget.spent() conta tokens de SAÍDA da sessão inteira (pool compartilhado com o laço
// principal e outros workflows), então o gasto DESTE run é o delta desde o início.
//   tetoSessao = budget.total, da diretiva "+300k" digitada pelo usuário: teto DURO da
//                sessão (agent() lança quando estoura) — medido contra o pool inteiro.
//   tetoRun    = args.tetoTokens: teto que este script impõe sozinho — medido no delta.
// Paramos de abrir rodada ao encostar em `margemTeto` de qualquer um dos dois, para
// sobrar verba para refutar o que já foi achado — achado sem refutação é achado sem valor.
const gastoSessao = () => (budget ? budget.spent() : 0)
const gastoInicial = gastoSessao()
const gastoRun = () => gastoSessao() - gastoInicial
const tetoSessao = (budget && budget.total) || null
const tetoRun = a.tetoTokens || null
const margemTeto = a.margemTeto ?? 0.8
const k = (n) => Math.round(n / 1000) + 'k'
const tokensAgora = () =>
  'tokens ' + k(gastoRun()) + (tetoRun ? ' de ' + k(tetoRun) : '') +
  (tetoSessao ? ' (sessão ' + k(gastoSessao()) + ' de ' + k(tetoSessao) + ')' : '')
const encostou = () =>
  (tetoRun !== null && gastoRun() >= tetoRun * margemTeto) ||
  (tetoSessao !== null && gastoSessao() >= tetoSessao * margemTeto)
const descTeto = tetoRun || tetoSessao ? 'teto ' + [tetoRun && k(tetoRun) + ' no run', tetoSessao && k(tetoSessao) + ' na sessão'].filter(Boolean).join(' / ') : 'sem teto'

function opts(base, papel) {
  const o = Object.assign({}, base)
  if (esforco[papel]) o.effort = esforco[papel]
  if (modelo[papel]) o.model = modelo[papel]
  return o
}

// ── esquemas ─────────────────────────────────────────────────────────────────
const ACHADO = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['area', 'gravidade', 'arquivo', 'linha', 'titulo', 'cenario', 'evidencia', 'correcao'],
        properties: {
          area: { type: 'string' },
          gravidade: { type: 'string', enum: GRAVIDADES },
          arquivo: { type: 'string', description: 'caminho relativo à raiz do projeto' },
          linha: { type: 'integer' },
          titulo: { type: 'string', description: 'a falha em uma frase' },
          cenario: { type: 'string', description: 'entradas/estado concretos -> comportamento errado' },
          evidencia: { type: 'string', description: 'o que você RODOU e o número/saída que viu' },
          correcao: { type: 'string', description: 'a correção mínima' },
          regraDoDono: { type: 'string', description: 'qual regra do dono é violada, se alguma' },
          decisaoNecessaria: {
            type: 'string',
            description: 'se a correção depende de uma escolha do dono (balanceamento, produto, UX), qual é a pergunta',
          },
        },
      },
    },
  },
}

const VEREDITO = {
  type: 'object',
  required: ['refutado', 'porque'],
  properties: {
    refutado: { type: 'boolean', description: 'true se o achado NÃO se sustenta' },
    porque: { type: 'string' },
    gravidadeSugerida: { type: 'string', enum: GRAVIDADES, description: 'se real, a gravidade que você daria' },
  },
}

// ── texto comum ──────────────────────────────────────────────────────────────
const CABECALHO =
  a.contexto +
  '\n\nESCOPO: ' +
  (a.escopo || 'o repositório inteiro') +
  (a.verificar && a.verificar.length
    ? '\n\nCOMO VERIFICAR (rode você mesmo, não confie em relato):\n  ' + a.verificar.join('\n  ')
    : '') +
  (a.regras && a.regras.length
    ? '\n\nREGRAS DO DONO (violar é bug, e sobe a gravidade):\n  • ' + a.regras.join('\n  • ')
    : '') +
  '\n\nGRAVIDADE: alta = trava, perda de dados, crash, regra do dono violada ou erro que o usuário comum ' +
  'vai encontrar; media = errado só em borda/sequência específica ou degradação perceptível; ' +
  'baixa = polimento, inconsistência, custo pequeno.' +
  '\n\nHIGIENE: qualquer arquivo temporário que você criar leva o prefixo "' +
  prefixoTmp +
  '" no nome (ex.: tests/' +
  prefixoTmp +
  'poca.test.ts) e é APAGADO antes de você responder. Não deixe arquivo versionado alterado: ' +
  'se precisar mexer para medir, reverta.'

const ordemGrav = { alta: 0, media: 1, baixa: 2 }
function normArq(p) {
  let s = String(p).replace(/\\/g, '/')
  if (a.raiz) {
    const r = String(a.raiz).replace(/\\/g, '/').replace(/\/$/, '')
    if (s.toLowerCase().startsWith(r.toLowerCase() + '/')) s = s.slice(r.length + 1)
  }
  return s.replace(/^\.\//, '')
}
const chaveDe = (f) => normArq(f.arquivo) + ':' + f.linha
const rotulo = (f) => chaveDe(f) + ' — ' + f.titulo

// vistos = chaves 'arquivo:linha' (dedup); rotulos = 'arquivo:linha — título' (vai no prompt e no retorno).
// a.jaVistos aceita qualquer um dos dois formatos, então o `vistos` de uma rodada anterior serve de semente.
const vistos = new Set()
const rotulos = []
for (const s of a.jaVistos || []) {
  vistos.add(String(s).split(' — ')[0])
  rotulos.push(String(s))
}
// Já visto = mesma chave OU mesmo arquivo a ≤ janelaDup linhas de algo já visto (vale entre rodadas também).
function jaVisto(f) {
  if (previous.has(rotulo(f))) { reused++; return true }
  const arq = normArq(f.arquivo)
  for (let d = -janelaDup; d <= janelaDup; d++) if (vistos.has(arq + ':' + (f.linha + d))) return true
  return false
}

// Achados no mesmo arquivo a poucas linhas de distância são quase sempre o mesmo bug
// visto por dois caçadores. Refutar os dois custa 2× lentes à toa.
function fundirProximos(lista) {
  const ordenada = lista.slice().sort((x, y) => (normArq(x.arquivo) < normArq(y.arquivo) ? -1 : normArq(x.arquivo) > normArq(y.arquivo) ? 1 : x.linha - y.linha))
  const mantidos = []
  let duplicados = 0
  for (const f of ordenada) {
    const ult = mantidos[mantidos.length - 1]
    if (ult && normArq(ult.arquivo) === normArq(f.arquivo) && Math.abs(ult.linha - f.linha) <= janelaDup) {
      duplicados++
      if (ordemGrav[f.gravidade] < ordemGrav[ult.gravidade]) ult.gravidade = f.gravidade // fica a pior
      continue
    }
    mantidos.push(Object.assign({}, f, { arquivo: normArq(f.arquivo) }))
  }
  return { mantidos, duplicados }
}

// ── laço principal ───────────────────────────────────────────────────────────
const confirmados = []
const refutados = []
const naoVerificados = []
let fila = [] // achados que passaram do cap da rodada: vão primeiro na próxima
let secas = 0
let rodadas = 0
let brutos = 0
let duplicadosTotal = 0
let descartadosJanela = 0 // achados caídos na janela ±janelaDup (nunca contados antes)
let agentesFalhos = 0 // caçadores que não devolveram nada (null): infra, não seca
let lentesFalhas = 0 // refutadores que não devolveram nada
let parouPor = 'rodadas'

log('gauntlet: ' + a.areas.length + ' área(s), até ' + maxRodadas + ' rodada(s), ' + lentes.length + ' lente(s), ' + descTeto)

for (let rodada = 1; rodada <= maxRodadas; rodada++) {
  if (secas >= secasParaParar) { parouPor = 'secou'; break }
  if (encostou()) { parouPor = 'teto'; log('teto de tokens encostado antes da rodada ' + rodada + ' (' + tokensAgora() + ')'); break }
  rodadas = rodada
  phase('Caçar')
  log('rodada ' + rodada + '/' + maxRodadas + ' — ' + confirmados.length + ' confirmado(s) — ' + tokensAgora())

  const jaReportados = Array.from(previous).concat(rotulos).slice(-80)
  const respostas = await parallel(
      a.areas.map((ar) => () =>
        agent(
          CABECALHO +
            '\n\nSUA ÁREA (' + ar.key + '): ' + ar.prompt +
            (jaReportados.length
              ? '\n\nJÁ REPORTADOS (não repita; procure OUTRA coisa):\n  ' + jaReportados.join('\n  ')
              : '') +
            '\n\nReporte só o que você conseguir amarrar a um arquivo:linha E a um cenário que você EXECUTOU ' +
            '(teste, script, medição). Nada de "poderia acontecer". Se a correção depender de uma escolha do dono ' +
            '(número de balanceamento, comportamento de produto), preencha decisaoNecessaria. ' +
            'Se não achar nada novo, devolva findings: [].',
          opts({ label: 'caçar:' + ar.key + ':r' + rodada, phase: 'Caçar', schema: ACHADO }, 'cacador'),
        ),
      ),
    )
  const falhas = respostas.filter((r) => !r).length
  agentesFalhos += falhas
  const achados = respostas
    .filter(Boolean)
    .flatMap((r) => r.findings ?? [])
    .filter((f) => f && f.arquivo && Number.isInteger(f.linha) && f.titulo)

  brutos += achados.length
  const { mantidos, duplicados } = fundirProximos(achados)
  duplicadosTotal += duplicados
  const novos = mantidos.filter((f) => !jaVisto(f))
  descartadosJanela += mantidos.length - novos.length
  novos.forEach((f) => { vistos.add(chaveDe(f)); rotulos.push(rotulo(f)) })

  let lote = fila.concat(novos)
  fila = []
  if (lote.length === 0) {
    if (falhas === a.areas.length) {
      log('rodada ' + rodada + ': todos os ' + falhas + ' caçador(es) falharam (null) — não conta como seca')
      continue
    }
    secas++
    log('rodada ' + rodada + ': nada novo (' + secas + '/' + secasParaParar + ' seca(s))' + (falhas ? ', ' + falhas + ' caçador(es) falharam' : ''))
    continue
  }
  secas = 0
  if (lote.length > maxAchadosPorRodada) {
    fila = lote.slice(maxAchadosPorRodada)
    lote = lote.slice(0, maxAchadosPorRodada)
    log(fila.length + ' achado(s) passaram do cap de ' + maxAchadosPorRodada + ' por rodada e ficam para a próxima')
  }
  log('rodada ' + rodada + ': ' + achados.length + ' bruto(s), ' + duplicados + ' fundido(s), ' + lote.length + ' vão para refutação')

  if (encostou()) {
    // Sem verba para refutar: não fingimos que foram verificados.
    naoVerificados.push(...lote, ...fila)
    fila = []
    parouPor = 'teto'
    log('teto encostado (' + tokensAgora() + '): ' + naoVerificados.length + ' achado(s) ficam SEM refutação')
    break
  }

  phase('Refutar')
  const julgados = await parallel(
    lote.map((f) => () =>
      parallel(
        lentes.map((lente, i) => () =>
          agent(
            CABECALHO +
              '\n\nTENTE REFUTAR este achado pela ótica: "' + lente + '".' +
              '\n\nArquivo: ' + f.arquivo + ':' + f.linha +
              '\nÁrea: ' + f.area +
              '\nGravidade alegada: ' + f.gravidade +
              '\nTítulo: ' + f.titulo +
              '\nCenário: ' + f.cenario +
              '\nEvidência do caçador: ' + f.evidencia +
              '\nCorreção proposta: ' + f.correcao +
              (f.regraDoDono ? '\nRegra do dono citada: ' + f.regraDoDono : '') +
              '\n\nLeia o código de verdade e, quando der, RODE o cenário. Muito achado é falso-positivo por ' +
              'leitura apressada. Na dúvida, refute (refutado=true). Se for real, diga a gravidade que você daria.',
            opts(
              { label: 'refutar:' + f.arquivo.split('/').pop() + ':' + f.linha + ':L' + (i + 1), phase: 'Refutar', schema: VEREDITO },
              'refutador',
            ),
          ),
        ),
      ).then((vs) => {
        const valid = (v) => v && typeof v.refutado === 'boolean' && typeof v.porque === 'string' && v.porque.trim()
        const vivos = vs.filter(valid)
        lentesFalhas += vs.length - vivos.length
        const votos = vs.map((v, i) => valid(v) && { lente: lentes[i] || 'lente ' + (i + 1), refutado: v.refutado, porque: v.porque }).filter(Boolean)
        if (vivos.length === 0) return { f: Object.assign({}, f, { votos }), vivo: null } // nenhuma lente respondeu: sem verificação, não refutado
        const contra = vivos.filter((v) => v.refutado).length
        const sobrevive = contra * 2 < vivos.length // empate = refutado; em rapido (2 lentes) uma lente basta para derrubar
        if (!sobrevive) return { f: Object.assign({}, f, { votos }), vivo: false }
        // Regrada: se metade ou mais dos refutadores dão outra gravidade, ela vale.
        const sugestoes = vivos.map((v) => v.gravidadeSugerida).filter((g) => g && g !== f.gravidade)
        const contagem = {}
        for (const g of sugestoes) contagem[g] = (contagem[g] || 0) + 1
        let gravidade = f.gravidade
        let gravidadeOriginal
        for (const g of Object.keys(contagem)) {
          if (contagem[g] * 2 >= vivos.length) { gravidadeOriginal = f.gravidade; gravidade = g }
        }
        return { f: Object.assign({}, f, { gravidade, gravidadeOriginal, votos }), vivo: true }
      }),
    ),
  )
  for (const j of julgados.filter(Boolean)) (j.vivo === null ? naoVerificados : j.vivo ? confirmados : refutados).push(j.f)
  log('rodada ' + rodada + ': ' + julgados.filter((j) => j && j.vivo).length + ' sobreviveram, ' + julgados.filter((j) => j && j.vivo === false).length + ' refutado(s), ' + julgados.filter((j) => j && j.vivo === null).length + ' sem verificação — ' + tokensAgora())
}
if (fila.length) naoVerificados.push(...fila)
if (parouPor === 'rodadas' && secas >= secasParaParar) parouPor = 'secou' // a última rodada permitida também secou

const porGrav = (x, y) =>
  ordemGrav[x.gravidade] - ordemGrav[y.gravidade] || (x.regraDoDono ? -1 : 0) - (y.regraDoDono ? -1 : 0)
confirmados.sort(porGrav)
naoVerificados.sort(porGrav)

const resumo = {
  rodadas,
  parouPor,
  achadosBrutos: brutos,
  duplicadosFundidos: duplicadosTotal,
  descartadosJanela,
  reused,
  refutados: refutados.length,
  confirmados: confirmados.length,
  naoVerificados: naoVerificados.length,
  agentesFalhos,
  lentesFalhas,
  porGravidade: {
    alta: confirmados.filter((f) => f.gravidade === 'alta').length,
    media: confirmados.filter((f) => f.gravidade === 'media').length,
    baixa: confirmados.filter((f) => f.gravidade === 'baixa').length,
  },
  comDecisao: confirmados.filter((f) => f.decisaoNecessaria).length,
  tokens: gastoRun(), // tokens de saída deste run (delta do pool da sessão)
  tokensSessao: gastoSessao(),
  tetoRun,
  tetoSessao,
}
log('FIM (' + parouPor + '): ' + confirmados.length + ' confirmado(s) [' + resumo.porGravidade.alta + ' alta, ' + resumo.porGravidade.media + ' média, ' + resumo.porGravidade.baixa + ' baixa], ' + refutados.length + ' refutado(s), ' + naoVerificados.length + ' sem verificação — ' + tokensAgora())

// vistos: rótulos 'arquivo:linha — título' — passe de volta em args.jaVistos para uma rodada extra não repetir
const complete = (f) => f.votos.length === lentes.length
const seenUpdates = confirmados.filter(complete).map((f) => ({ id: rotulo(f), verdict: 'confirmed', evidence: JSON.stringify(f.votos) }))
  .concat(refutados.filter(complete).map((f) => ({ id: rotulo(f), verdict: 'refuted', evidence: JSON.stringify(f.votos) })))
return { confirmados, naoVerificados, refutados, resumo, vistos: rotulos, previouslyJudged, seenUpdates }
