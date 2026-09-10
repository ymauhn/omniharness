# Style rules (binding)

Verbatim from the author's consolidated context file (`thesis_context.md`, section 4), written in Portuguese, the working language between author and assistant. Each rule was extracted from a direct correction by the author and cost at least one rework cycle. They bind every edit this skill makes; the model does not edit this file. Metric names and label prefixes in the examples belong to the original dissertation and are overridden by the manuscript's `project.md`.

English summary: no em-dashes (use commas or parentheses); every section opens with a paragraph saying what it contains; active voice, declarative sentences, no empty hedging; one claim, one evidence; decimal comma to point and thousands separator converted; metric names as identifiers; `—` means run absent and `n/a` means not applicable, never invent either; four decimals for metrics, two for Smin and GPU hours; fixed terminology; the black-box principle (what was not reimplemented is omitted, not guessed); hyperparameters presented as universal; never touch the author's manual edits; limitations declared in a numbered subsection where each item says what it prevents concluding; Notation paragraph early; baseline before the search grid.

---

## 4. Estilo e padronização de escrita — REGRAS VINCULANTES

Estas regras foram extraídas de correções diretas do autor ao longo da sessão. Cada uma custou pelo
menos um ciclo de retrabalho.

### 4.1 Pontuação e prosa

1. **Proibido travessão.** Palavras do autor: *"não devemos usar travessões; utilize vírgulas ou
   parênteses em vez disso."* Verificado: `cap5_final.tex` tem **zero** ocorrências de `---` e de
   ` -- `. Esta regra vale para o Capítulo 6 e para as Conclusões.
   *(Observe que este arquivo de contexto usa travessões livremente; ele não é o texto da tese.)*
2. **Toda seção abre com um parágrafo que descreve o que a seção contém.** Pedido explícito para a
   §3.1 e generalizado depois. Vale para seção, e é boa prática para subseção longa.
3. Prosa em inglês acadêmico, voz preferencialmente ativa, frases declarativas. Evite hedging
   vazio ("it can be argued that"); se a evidência é fraca, diga que é fraca e por quê.
4. Uma afirmação, uma evidência. O autor rejeita frases órfãs — uma sentença conclusiva sem o
   parágrafo que a sustenta foi explicitamente apontada e movida ("ordering is not cosmetic").

### 4.2 Números e notação

5. **Separador decimal.** Os arquivos de resultado em `RESULTADOS_CAPITULO_6/` usam **vírgula**
   decimal (`0,5869`). A dissertação é em inglês e usa **ponto** (`0.5869`). **Converter sempre.**
   Esta é a armadilha mecânica mais provável do Capítulo 6.
   O mesmo vale para o separador de milhar: `9.221` no `.md` em português é `9,221` em inglês.
6. **`w_fmax`**, não "weighted fmax". Idem: `fmax`, `fmax*`, `smin`, `auprc`, `iauprc` como nomes
   de métrica; `Smin` em bits, menor é melhor (dizer isso na legenda de toda tabela que o mostre).
7. `—` significa **run ausente**. `n/a` significa **não aplicável por construção**. São coisas
   diferentes e **nunca** se inventa valor para nenhuma das duas.
8. Precisão: quatro casas decimais para métricas, duas para Smin, duas para horas de GPU.

### 4.3 Terminologia fixada

| Use | Não use |
|---|---|
| "concatenation of protein language model layers" | "layer concatenation" isolado |
| "evaluated" | "carried" (correção explícita do autor) |
| "fixed, non-parametric propagation" | "propagation" sem o qualificador, quando o contraste com a GNN estiver em jogo |
| "Early Fusion" / "Late Fusion" (capitalizado) | "early fusion" minúsculo em posição de nome próprio |
| "ProteinLoss" | "protein loss" |
| "isolated protein" (grau zero no grafo limiarizado) | "unconnected", "orphan" |

9. **A distinção paramétrico × não paramétrico deve ser explícita** sempre que a propagação fixa e
   a GNN forem comparadas (pedido do autor para a §5.6, e vale a fortiori no Capítulo 6, onde a
   comparação é o resultado principal).

### 4.4 Princípios de honestidade metodológica

10. **Princípio da caixa preta.** O que não foi reimplementado por nós é tratado como caixa preta
    herdada; o que não conseguimos descobrir, **omitimos** — não especulamos e não preenchemos com
    plausibilidade. Exemplo aplicado: a GPU do Colab não foi registrada, então o apêndice diz
    "não registrado", e não "provavelmente uma A100".
11. **Hiperparâmetros apresentados como universais.** Decisão explícita do autor: *"pode deixar
    universal mesmo, não precisa nem falar da mudança de duas linhas e uma frase de exceção da
    early fusion."* Não escreva cláusulas de exceção para hiperparâmetro.
12. **Métodos comparativos são descritos como se sempre tivessem sido avaliados com as nossas
    métricas e o nosso `evaluate_collect`**, uniformemente. Não narre o processo de repontuação
    como uma correção posterior.
13. **Não altere edições manuais do autor.** Palavras dele: *"tome esse cuidado de não alterar mais
    nada, nem mesmo o travessão e a referência que ajustei."* Se um trecho difere do que você
    esperava, presuma que ele o editou de propósito.
14. **Limitações são declaradas, não escondidas, mas também não infladas.** O padrão que ele
    aceitou: uma subseção final de limitações com itens numerados, cada um dizendo o que a limitação
    impede de concluir.

### 4.5 Estrutura

15. Padrão adotado no Capítulo 5, a ser espelhado: **três subseções por geração**
    (Representation, Propagation, Prediction Head), com subsubseções abaixo.
16. Parágrafo de "Notation" vem cedo na seção que introduz a notação, não num apêndice de símbolos.
17. Baseline **antes** da grade de busca (ruling explícito do autor sobre ordenação).

---

