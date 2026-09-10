# Roadmap

Ordem por relação esforço/retorno. Os números vêm de um run real de 308
agentes (~100 achados brutos, 299 refutações) e de 3 runs de fumaça.

## O modelo de custo que orienta tudo

Não existe contexto compartilhado entre agentes: cada subagente nasce vazio,
e o "cache lido" gigantesco por agente é a re-leitura do **próprio** histórico
dele a cada turno. Na prática:

```
custo ≈ agentes × turnos² × tamanho-do-contexto
```

O termo quadrático é o que dói. Um agente que gasta 12 turnos se orientando
no repositório custa muito mais que o dobro de um que gasta 6. Consequências:

- Reduzir **turnos por agente** vale mais que baratear o modelo.
- Dividir uma etapa em duas (um agente barato executa, um caro analisa)
  **aumenta** o gasto: os dois recarregam contexto do zero.
- `effort` é um botão mais barato que `model` — corta saída sem duplicar
  leitura.

## 1. `jaVistos` persistente

**Hoje:** a lista de achados já conhecidos é passada à mão nos args.
**Proposta:** o driver grava em `.claude/gauntlet-achados.json` e o run
seguinte se auto-semeia.
**Retorno:** alto, custo quase zero. Num teste real derrubou o custo de um run
de 112k para 42k tokens.

## 2. Pré-loop com estimativa

**Proposta:** antes do loop oficial, rodar **um** caçador numa área só, medir
o delta real de `budget.spent()` e o tempo, e extrapolar pela fórmula do
README. Apresentar três configurações com o custo previsto e perguntar antes
de disparar.
**Retorno:** controla o gasto na origem, e a medição é do *seu* repositório —
melhor que a tabela estática de hoje. Custo do próprio pré-loop: 1 agente.

## 3. Regras gravadas no checkpoint

**Proposta:** no checkpoint da fase 3, a resposta do dono a um
`decisaoNecessaria` volta para o `regras` do `.claude/gauntlet-loop.json` e
passa a entrar no prompt de todo caçador futuro.
**Momento certo de te inserir:** depois da primeira rodada, antes das
seguintes — é o único ponto com informação suficiente para decidir e ainda
com loop sobrando para aproveitar a decisão.
**Retorno:** cresce a cada run; sem isso, todo gauntlet redescobre o que você
já transformou em regra.

## 4. Lentes escalonadas com curto-circuito

**Hoje:** as N lentes rodam em paralelo, então todo achado custa N agentes —
inclusive o obviamente falso.
**Proposta:** `lentes[]` heterogêneo. Lente 1 barata e **sequencial**
primeiro; só o que ela não matar escala para as lentes fortes.
**Detalhe que faz funcionar:** a lente barata **não pode julgar**, só validar
mecanicamente — o arquivo/linha existe? o repro roda e reproduz? já está em
`jaVistos` ou nas `regras`? Se puder opinar "isso é intencional", vai matar
bug de verdade. Julgamento fica com as lentes fortes.
**Retorno:** ~metade das refutações. Custo: perde paralelismo, fica mais lento
em tempo de parede.

## 5. Fase de reconhecimento com mapa

**Proposta:** 1 agente barato por área produz um mapa de ≤2 KB (arquivos que
importam, símbolos de entrada, como rodar o repro daquela área, o que já foi
decidido). Esse mapa entra no prompt de cada caçador, que começa orientado em
vez de gastar 5-8 turnos de `grep`/`read` descobrindo onde fica a função
central. Cache no repositório, invalidado pelo hash de `git rev-parse HEAD`.
**Retorno:** ataca o termo quadrático diretamente. É a maior mudança
estrutural — fazer por último, medindo antes e depois com o pré-loop (2) de
régua.

## Sobre grafos de conhecimento

Avaliado e **não** recomendado por ora: grafo ajuda quando a pergunta é "o que
mais quebra se eu mexer aqui" (análise de impacto cruzado), não quando é
"onde eu olho". Para o segundo caso, um mapa em texto de 2 KB entrega o mesmo
por muito menos, sem dependência externa.

## Escalonamento de modelo por etapa

Hoje todos os agentes herdam o modelo da sessão; os presets variam apenas o
esforço. Quando fizer sentido diferenciar:

| Etapa | Modelo | Esforço | Por quê |
|---|---|---|---|
| Caçador | o mais forte | medium/high | cria o valor; erro aqui se multiplica pelo número de lentes |
| 1ª lente | barato | low | peneira mecânica, sem julgamento |
| 2ª/3ª lentes | o mais forte | high | só nos sobreviventes da peneira |
| Gravidade e o que vira pergunta pro dono | o mais forte | — | é julgamento, e chega no humano |

Caçador fraco é economia falsa: um achado-lixo custa exatamente os mesmos N
agentes de refutação que um achado bom, só que para morrer.
