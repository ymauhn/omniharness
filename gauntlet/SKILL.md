---
name: gauntlet-loop
description: Auditoria adversarial de uma codebase em 6 fases — reconhece o diretório, pergunta o escopo, roda o workflow gauntlet-loop (caçadores paralelos por área + refutação por lentes independentes até secar), relata os achados por gravidade, aplica as correções aprovadas e limpa. Use quando pedirem "rode o gauntlet", "gauntlet loop", "caça bugs completa", "auditoria adversarial", "procure bugs, gargalos e problemas de uso".
argument-hint: "[rapido|padrao|profundo] [+300k] [areas=a,b] [desde=<ref>] [so-relatorio] [sem-perguntas] [foco livre…]"
disable-model-invocation: true
---

Pipeline de verificação adversarial. O trabalho pesado é o **driver**
`~/.claude/skills/gauntlet-loop/gauntlet.workflow.js` — um script do tool
`Workflow` que abre um caçador por área em rodadas paralelas, funde achados
próximos, manda cada achado para N lentes de refutação (sobrevive quem não
perde por maioria), e para quando seca, esgota as rodadas ou encosta no teto
de tokens. Esta SKILL.md é o que acontece **em volta** dele: o que perguntar
antes, como ler o resultado, como corrigir e como fechar.

Todos os caminhos abaixo são relativos à raiz do repositório auditado.
Argumentos do gatilho chegam em `$ARGUMENTS`.

## Instalação (uma vez por máquina)

O registro de workflows nomeados só lê `*.js` de `~/.claude/workflows/` e de
`<repo>/.claude/workflows/`. Copie o driver para lá (o nome instalado é
**`gauntlet-driver`**, não `gauntlet-loop`: workflow nomeado também vira
comando `/nome` e colidiria com esta skill):

```bash
mkdir -p ~/.claude/workflows && cp ~/.claude/skills/gauntlet-loop/gauntlet.workflow.js ~/.claude/workflows/gauntlet-driver.js && ls -la ~/.claude/workflows/
```

Repita o `cp` sempre que editar o driver. Se o arquivo foi criado/alterado
**nesta mesma sessão**, veja o Gotcha do cache antes de chamar por nome.

## O gatilho controla o gasto

`/gauntlet-loop <args>`. Tudo é opcional; o que não vier é perguntado na Fase 1
(ou assume o padrão com `sem-perguntas`).

| Token no gatilho | Efeito |
|---|---|
| `rapido` \| `padrao` \| `profundo` | preset do driver: rodadas máx / rodadas secas para parar / lentes / achados por rodada = **rapido** 2/1/2/8 (esforço medium) · **padrao** 5/2/3/20 · **profundo** 8/3/4/40 (refutador em high). Empate = refutado; em `rapido` (2 lentes) uma única lente basta para derrubar o achado |
| `+300k` | teto de **tokens de saída deste run** → `args.tetoTokens = 300000`. O driver para de abrir rodada em 80% do teto (`margemTeto`) para sobrar verba para refutar o que já achou; o que sobrar sem refutação volta em `naoVerificados`, nunca some calado |
| `areas=a,b` | só as áreas com essas `key` (da config do projeto ou das derivadas na Fase 0) |
| `desde=<ref>` | escopo = `git diff --stat <ref>`; o contexto ganha a lista do que mudou |
| `so-relatorio` | para depois da Fase 3 (não corrige nada) |
| `sem-perguntas` | pula a Fase 1: todas as áreas, preset padrao, corrige alta+média |
| qualquer outro texto | vira "FOCO:" no contexto dos caçadores |

`disable-model-invocation: true` no frontmatter garante que esta skill **só
dispara pelo comando** — nunca por interpretação de uma frase solta. Se quiser
que "rode o gauntlet" em texto corrido também dispare, apague essa linha.

### Quanto custa (medido, não chutado)

Gauntlet real neste repositório (6 áreas, até 5 rodadas, 3 lentes), 308
agentes contabilizados pelos `agent-*.jsonl` do run:

| por agente | média | mediana | p90 | máx |
|---|---|---|---|---|
| tokens de saída | 8,3k | 6,4k | 15k | 42k |
| entrada nova (não cacheada) | 156k | | | |
| cache lido | 3,3M | | | |

Ou seja: **`+Nk` limita só a saída**; o custo em dinheiro é dominado por
leitura de cache (~50 chamadas por agente sobre um contexto de ~65k). Use
`/cost` para o valor em dólar.

Limite superior de agentes de um run (o real converge antes, quando seca):

```
agentes_max = áreas × maxRodadas  +  maxAchadosPorRodada × maxRodadas × lentes
```

Neste repositório (6 áreas): rapido ≈ 44 · padrao ≈ 330 · profundo ≈ 1 328
(o harness corta em 1 000). Conversão prática pela média de 8,3k de saída:
`+300k` ≈ 36 agentes ≈ um rapido inteiro; `+1M` ≈ 120 agentes; o padrao
completo consumiu ~2,5M de saída.

Testes de fumaça desta skill (1 área, 1 rodada, 1 lente, esforço low):
1 agente / 34 s / 39k `subagent_tokens`; 3 agentes / 90 s / 112k.

### Como acompanhar durante o run

- `/workflows` — árvore ao vivo: fase, rótulo de cada agente (`caçar:<área>:r<rodada>`, `refutar:<arquivo>:<linha>:L<n>`), tokens.
- O driver loga a cada rodada: `rodada 2/5 — 3 confirmado(s) — tokens 210k de 300k (sessão 9.245k)`.
- No fim, `resumo.tokens` (delta do run), `resumo.tokensSessao`, `resumo.tetoRun`, `resumo.tetoSessao`, `resumo.parouPor ∈ {secou, rodadas, teto}`, `resumo.agentesFalhos` / `resumo.lentesFalhas` (agentes que não devolveram nada) e `resumo.descartadosJanela` (achados caídos na janela ±janelaDup) e o bloco `<usage>` da notificação (`agent_count`, `subagent_tokens`, `duration_ms`).
- `budget.spent()` é o pool de **saída da sessão inteira** (laço principal + todos os workflows). O driver mede o delta desde o início do run; se você digitar `+300k` na mensagem e o harness reconhecer como diretiva, `budget.total` vira teto DURO da sessão (`agent()` lança ao estourar) e aparece em `resumo.tetoSessao`. Se `tetoSessao` vier `null`, a diretiva não foi reconhecida — o `tetoTokens` do driver continua valendo sozinho.

---

## Fase 0 — Reconhecimento (sem perguntar nada ainda)

Rode, na raiz do repositório:

```bash
git status --short | grep '^??' | sort > "$SCRATCH/gauntlet-antes.txt"; wc -l < "$SCRATCH/gauntlet-antes.txt"; git log --oneline -5; git diff --stat HEAD~1 | tail -3; ls CLAUDE.md README.md .claude/gauntlet-loop.json 2>&1 | head
```

(`$SCRATCH` = o scratchpad da sessão. O snapshot de não-versionados é o que
permite, na Fase 5, distinguir sobra de agente de arquivo do usuário.)

Depois, leia:

1. **`.claude/gauntlet-loop.json`** se existir — é a config do projeto
   (`contexto`, `verificar`, `regras`, `areas`, `prefixoTmp`, `lentes`
   opcionais). Formato em `~/.claude/skills/gauntlet-loop/args.exemplo.json`.
   Com config, o resto desta fase só complementa "o que mudou".
2. Sem config: o manifesto (`package.json` scripts / `Makefile` /
   `pyproject.toml` / `go.mod`…) para derivar `verificar` — os comandos de
   typecheck, teste e build que existem de verdade. **Rode cada um uma vez**
   antes de colocá-lo no contexto: comando que não passa hoje entra marcado
   como "já falha antes do gauntlet", senão todo caçador vai reportá-lo.
3. `CLAUDE.md` / `README.md` / `docs/` — regras do dono, arquitetura, o que é
   inegociável (determinismo, privacidade, plataforma-alvo…).
4. `git log --oneline -5` e `git diff --stat <desde|HEAD~1>` — "o que acabou de
   mudar" é onde o bug mora; vai no `contexto` como bloco próprio.
5. Derive 4–8 **áreas** com `{key, prompt}` se a config não trouxer. Cada
   prompt diz o que caçar, onde, e **como medir** (o caçador só pode reportar
   o que executou). Áreas que costumam render: regras/lógica recém-mudada,
   estado & fluxo (promessa pendurada, listener não removido, voltar em hora
   errada), concorrência/determinismo, performance (alocação em laço quente,
   I/O por frame), entrada do usuário & UI (viewport pequena, texto cortado),
   integração externa (serviço fora do ar, timeout), segurança de entrada.
6. Se `$ARGUMENTS` tiver `areas=`, filtre; `desde=`, use o diff como escopo.

## Fase 1 — Perguntas (UM checkpoint só)

Uma única chamada de `AskUserQuestion` com até 4 perguntas; omita as que os
argumentos já responderam. Com `sem-perguntas`, pule a fase.

1. **Áreas** (multiSelect) — as derivadas/da config, todas pré-listadas.
2. **Profundidade** — `rapido` / `padrao` (Recomendado) / `profundo`, com a
   estimativa de agentes e tokens de saída de cada um **nas descrições**
   (fórmula acima com o número real de áreas).
3. **Escopo** — repositório inteiro / só o que mudou desde `<ref>` / uma
   pasta.
4. **Política de correção** — corrigir tudo que sobreviver / só alta+média
   (Recomendado) / só relatório.

Regras do dono que não estão em arquivo: pergunte em texto na mesma rodada
("há regra que vale como requisito e não está no CLAUDE.md?") só se não houver
config — a resposta entra em `regras`.

## Fase 2 — Rodar o driver

### Cross-run history (S4)

Before launching, follow `<harness>/docs/t13/SEEN.md`: inventory all audited code/tests, binding rules and exact driver configuration, including lenses and driver hash; fingerprint actual file contents; obtain a fresh `gauntlet` snapshot. Pass it as `seen` with matching `seenScope` and `seenContext`. When input coverage is uncertain, run cold. The persisted key is the exact `file:line — title`; do not seed `jaVistos` from historical line windows. After saving the phase 3 report and before any fixes, the single coordinator sends only `seenUpdates` to `seen.py record`. Incomplete lens sets and unverified findings are never persisted. Show `previouslyJudged` separately: an old confirmation is still an open issue, not a newly found or fixed one. Recompute the fingerprint after source/config changes. Report `resumo.reused`; fake-agent savings are not real usage measurements. Journal errors preserve evidence and do not authorize a paid retry.

Monte `args` com: `raiz` (caminho absoluto do repo), `preset`, `tetoTokens` (se
`+Nk`), `contexto` (config + "O QUE MUDOU" + "FOCO"), `escopo`, `verificar`,
`regras`, `areas`, `prefixoTmp` (padrão `_gauntlet_`). Passe **objeto JSON**,
não string. Chamada verificada nesta máquina (teste de fumaça, 1 área):

```
Workflow({
  name: "gauntlet-driver",
  args: {
    "raiz": "/caminho/absoluto/do/repo",
    "preset": "rapido", "maxRodadas": 1, "secasParaParar": 1, "numLentes": 1, "maxAchadosPorRodada": 2,
    "esforcoCacador": "low", "esforcoRefutador": "low", "tetoTokens": 200000,
    "contexto": "<o contexto da config + TESTE DE FUMAÇA>",
    "escopo": "somente src/game/ladder.ts e tests/ladder.test.ts",
    "verificar": ["npx vitest run tests/ladder.test.ts"],
    "regras": ["O jogador nunca enfrenta a si mesmo", "A última fase é sempre o chefão"],
    "areas": [{ "key": "escadas", "prompt": "Leia src/game/ladder.ts … Prove com um script que você EXECUTOU. Se não houver, devolva findings: []." }]
  }
})
```

Resultado real dessa chamada: 3 agentes, 90 s, 2 confirmados (1 média
rebaixada de alta pelo refutador, 1 baixa; os dois com `decisaoNecessaria`),
`resumo.tokens` 106 283, `parouPor: "rodadas"`. A mesma chamada com
`jaVistos` = os 2 rótulos devolvidos em `vistos`: 1 agente, 68 s, 0 novos,
`resumo.tokens` 42 423 — é assim que se pede "mais uma rodada" sem pagar
refutação repetida.

Num run de verdade não passe `maxRodadas/numLentes/esforco*` — o preset
cuida. Overrides disponíveis quando precisar: `maxRodadas`, `secasParaParar`,
`numLentes` ou `lentes[]` (textos próprios), `maxAchadosPorRodada`,
`janelaDup` (±linhas para fundir achados, padrão 4), `esforcoCacador` /
`esforcoRefutador` (`low|medium|high|xhigh|max`), `modeloCacador` /
`modeloRefutador`, `margemTeto` (0.8), `jaVistos[]` (o `vistos` de um run
anterior: rodada extra sem repetir achado).

Depois de lançar, **não fique consultando**: a notificação chega sozinha com
o `result` inteiro. Enquanto isso, não edite arquivos do escopo (os caçadores
estão medindo em cima deles). Se precisar dos retornos brutos por agente:
`<transcriptDir>/journal.jsonl` (uma linha `{"type":"result",…}` por agente).

O retorno é `{ confirmados[], naoVerificados[], refutados[], resumo, vistos[] }`.
Cada achado: `area, gravidade, gravidadeOriginal?, arquivo, linha, titulo,
cenario, evidencia, correcao, regraDoDono?, decisaoNecessaria?, votos[]`.

## Fase 3 — Relatório por gravidade + feedback

Apresente **antes de tocar em qualquer arquivo**:

```
🔴 ALTA (n)   | área | arquivo:linha | achado | cenário | correção | regra do dono
🟡 MÉDIA (n)  | …
🟢 BAIXA (n)  | …
⚪ SEM VERIFICAÇÃO (n) — o teto chegou antes da refutação; tratar como suspeita
Refutados: n (título + a lente que derrubou, uma linha cada — o dono pode discordar)
Resumo: rodadas, parouPor, brutos → fundidos → confirmados, tokens do run / teto
```

Dentro de cada nível, os que violam regra do dono vêm primeiro (o driver já
ordena assim). Achado com `gravidadeOriginal` mostra "alta→média (refutador)".

Então **um** `AskUserQuestion`:

- "Quais corrigir?" — todos / só alta / alta+média / nenhum (respeite a
  política da Fase 1 como opção pré-selecionada).
- Cada `decisaoNecessaria` vira uma pergunta própria, com as opções que o
  caçador listou em `correcao` + "deixar como está". Máximo 4 perguntas por
  chamada; se houver mais decisões, agrupe por tema e faça uma segunda
  chamada — mas nunca uma pergunta por vez.

Com `so-relatorio`, pare aqui.

## Fase 4 — Correções

Ordem: alta → média → baixa, agrupando achados do mesmo arquivo numa passada.
Por achado:

1. Se existe runner de testes, **escreva o teste que falha primeiro** a
   partir de `cenario`/`evidencia` (o caçador já provou o cenário; o teste é a
   tradução). Nome definitivo, sem prefixo temporário — ele fica.
2. Correção mínima (`correcao` é ponto de partida, não ordem).
3. Verificação rápida: o teste novo + o comando de `verificar` mais barato que
   cobre o arquivo.
4. Até **5 iterações** por achado. Na 5ª sem verde: desfaça (`git checkout --
   <arquivo>` nos arquivos tocados por ele), marque "não resolvido" com o que
   foi tentado, siga para o próximo.
5. Qualquer coisa que dependa de número de balanceamento, comportamento de
   produto ou escolha de UX que **não** foi decidida na Fase 3: **pare e
   pergunte** — não invente o número.
6. Nunca commite sem pedir.

## Fase 5 — Fechamento

1. Rode **todos** os comandos de `verificar`, na íntegra, e cole a saída
   resumida (n testes verdes, build ok). Falhou? Diga qual e por quê — não
   esconda.
2. Limpeza. Lista sobras dos agentes e o que apareceu de não-versionado desde
   a Fase 0:

```bash
find . -name '_gauntlet_*' -not -path './node_modules/*' -print; echo "sobras: $(find . -name '_gauntlet_*' -not -path './node_modules/*' | wc -l)"; git status --short | grep '^??' | sort > "$SCRATCH/gauntlet-depois.txt"; comm -13 "$SCRATCH/gauntlet-antes.txt" "$SCRATCH/gauntlet-depois.txt"
```

   Arquivos `_gauntlet_*`: apague. Outros novos não-versionados que não são
   seus (o `comm` mostra): **liste e pergunte** antes de apagar — pode ser
   sobra de outro run (`__zz_probe_*`, `_tmp-*`) ou arquivo do usuário.
3. Resumo final: corrigidos / não resolvidos (com o motivo) / adiados por
   decisão / refutados que o dono quis rever; tokens do run e da sessão.
4. Ofereça o commit (mensagem com a lista de achados corrigidos) e, se o
   projeto ainda não tem `.claude/gauntlet-loop.json`, ofereça salvar o
   `contexto/verificar/regras/areas` desta rodada lá — a próxima começa na
   Fase 1 direto.

---

## Usar em outra codebase

1. A skill é global (`~/.claude/skills/gauntlet-loop/`): aparece como
   `/gauntlet-loop` em qualquer pasta. O driver instalado em
   `~/.claude/workflows/gauntlet-driver.js` também é global (e aparece como
   `/gauntlet-driver` — não use esse: recebe `args` como string e falha na
   validação; ele existe para a skill chamar por nome). Nada a copiar por
   projeto.
2. Primeira vez num repositório: `/gauntlet-loop rapido +300k` — a Fase 0
   deriva `verificar` e as áreas sozinha, a Fase 1 confirma, e no fim a skill
   oferece gravar `.claude/gauntlet-loop.json`. Aceite: da segunda vez em
   diante o reconhecimento é só "o que mudou".
3. Para o time inteiro (sem depender da home de cada um): copie a pasta
   `~/.claude/skills/gauntlet-loop/` para `<repo>/.claude/skills/gauntlet-loop/`
   e o driver para `<repo>/.claude/workflows/gauntlet-driver.js`; ambos são
   descobertos a partir de qualquer subpasta do repositório.
4. Monorepo: uma config por app (`apps/x/.claude/gauntlet-loop.json`) e rode
   com o shell dentro de `apps/x` — a varredura de `.claude/` sobe do cwd até
   a home, então a config mais próxima ganha.
5. Sem runner de testes (script solto, notebook, infra): ainda funciona, mas
   diga isso no `contexto` e peça prova por script `_gauntlet_*` — a Fase 4
   então pula o "teste que falha primeiro".

## Gotchas

- **Só `*.js` no registro de nomes.** `~/.claude/workflows/gauntlet-driver.mjs`
  é ignorado silenciosamente (o loader conta `.mjs/.cjs/.ts` como "near
  miss" e segue). O driver no diretório da skill se chama
  `gauntlet.workflow.js` de propósito — não é lido de lá.
- **Workflow nomeado vira comando `/nome` e disputa o nome com skills.** Com
  o driver instalado como `gauntlet-loop.js`, a lista de skills mostrava
  `gauntlet-loop` com a descrição do *workflow*, sobrepondo esta SKILL.md.
  Por isso `meta.name` é `gauntlet-driver`. Se renomear, renomeie os dois
  (o `meta.name` manda; o nome do arquivo é só convenção).
- **O registro é cacheado por diretório de trabalho.** `Workflow({name})`
  memoiza a lista por `cwd`. Arquivo criado/alterado depois do início da
  sessão não aparece (ou aparece a versão antiga) até você mudar o cwd do
  shell (`cd <subpasta>` numa chamada Bash, depois `cd` de volta) ou
  reiniciar a sessão. Verificado: mesma chamada, "not found" na raiz,
  encontrado após `cd tests`.
- **`scriptPath` recusa o diretório da skill** ("must be a script path this
  tool returned, or a file you can already read"). Para rodar o driver sem
  instalar: `Read` o arquivo e passe o conteúdo em `script` — custa ~4k
  tokens de entrada por chamada, funciona em qualquer lugar.
- **O script-file do run vai para a pasta do cwd**
  (`projects/<cwd-slug>/workflows/scripts/…`). Se você mudou de pasta para
  furar o cache, o caminho de `resumeFromRunId` fica nessa outra pasta —
  use o que a notificação devolveu, não o da raiz.
- **`budget.spent()` é da sessão, não do run** — um segundo workflow rodando
  em paralelo (ou horas de sessão) infla o número. O driver mede o delta;
  não compare `resumo.tokensSessao` com o teto do run.
- **Sem template literal no driver.** Crase dentro de crase quebrou o parser
  do harness numa versão anterior; tudo é concatenação. Se editar, mantenha.
- **Agentes deixam sondas para trás.** Sem regra de higiene, o gauntlet
  original deixou ~70 arquivos (`tests/__zz_probe_*.test.ts`,
  `tools/_tmp-*.mjs`). O driver impõe o prefixo `_gauntlet_` + apagar antes
  de responder; verificado no teste de fumaça (sonda criada, usada e
  apagada — `sobras: 0`). O snapshot da Fase 0 pega o que escapar.
- **`args` é JSON, não string.** `args: "{…}"` chega ao script como uma
  string e `a.areas.length` explode.
- **Achado sem refutação não é achado.** Se o teto chegar antes de refutar, o
  driver devolve o lote em `naoVerificados` em vez de fingir que verificou.
  Relate como suspeita, nunca como confirmado.

## Troubleshooting

- **`Workflow "gauntlet-driver" not found. Available: deep-research`**: ou o
  arquivo não é `.js` em `~/.claude/workflows/` / `<repo>/.claude/workflows/`,
  ou o registro está cacheado para este cwd. `ls ~/.claude/workflows/`; se o
  `.js` está lá, `cd` para uma subpasta e chame de novo. (Aconteceu 4 vezes
  nesta máquina: `.js` só no user dir criado em sessão aberta, `.js` no
  projeto idem, `.mjs` sozinho, e após trocar o conteúdo sem trocar de cwd.)
- **`scriptPath must be a script path this tool returned, or a file you can
  already read`**: o caminho aponta para fora do cwd (ex.: a pasta da skill).
  Use `name` com o driver instalado, ou `script` inline.
- **`gauntlet-loop precisa de args.contexto (texto) e args.areas ([{key, prompt}])`**:
  `args` chegou vazio ou como string. Passe objeto.
- **`SyntaxError: Illegal return statement` ao checar o driver com `node --check`**:
  normal — o harness embrulha o corpo numa `async function`. Para checar
  sintaxe fora do harness, embrulhe do mesmo jeito:

```bash
node -e "const fs=require('fs');const body=fs.readFileSync(process.argv[1],'utf8').replace(/export const meta =/,'const meta =');new (Object.getPrototypeOf(async function(){}).constructor)('agent','parallel','pipeline','phase','log','args','budget','workflow',body);console.log('SINTAXE_OK')" ~/.claude/skills/gauntlet-loop/gauntlet.workflow.js
```

- **`resumo.tokens` na casa dos milhões num run pequeno**: versão antiga do
  driver que devolvia `budget.spent()` cru. Reinstale (`cp` da Instalação) e
  fure o cache do cwd.
