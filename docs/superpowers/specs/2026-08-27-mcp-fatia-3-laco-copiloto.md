# CRMFlash — MCP Fatia 3: fechar o laço do copiloto

**Data:** 2026-08-27
**Status:** design aprovado, aguardando plano de implementação

## Problema

A fila do copiloto é o mecanismo que avisa o que precisa de atenção. Pelo MCP,
tratar uma pendência exige **duas chamadas independentes**: a tool que faz o
trabalho, e `answer_copilot_question`, que faz a pergunta sumir da fila.

Nada amarra uma na outra. O modelo pode chamar só a segunda — e é fácil
acontecer: você diz *"isso eu já resolvi"* e ele suprime. A pendência some por
dias, nenhum registro foi criado, e o CRM parece tratado.

É pior que um erro visível. A fila existe justamente para avisar; se ela pode
esvaziar sem trabalho, ela para de servir para a única coisa que faz.

Existe um segundo desperdício. O `whats_stuck` já devolve as opções prontas de
cada pergunta — "Avançou de estágio", "Concluído", "Remarcar +3 dias" — mas elas
são decorativas: nenhuma tool as executa. O modelo tem que reconstruir à mão, com
as tools granulares, um efeito que o app já sabe aplicar em um clique.

## Estado atual relevante

- **As quick actions são declarativas e completas.** Cada uma traz `effects[]` já
  ligados a ids concretos (`{ kind: "complete_next_step", stepId: step.id }`) e
  o próprio `suppressDays`. Executá-las server-side é mecânico — é o que
  `runAction` faz em `use-copilot.ts`.
- **`applyEffect` e `recordCopilotEvent` já estão em `src/lib/pipeline/`**,
  extraídos na Fatia 1. O app e o MCP escrevem pelo mesmo caminho.
- **A chave carrega o contexto:** `question_key` é
  `rule_id:company_id[:entity_id]`. Regra e empresa saem dela sem parâmetro extra.
- **`NARRATION_SUPPRESS_DAYS`** (`src/lib/constants.ts`) já define, por regra,
  quantos dias a pergunta some quando a resposta veio de texto livre. É o que o
  painel usa hoje.
- **Efeitos usados pelas 9 regras:** `move_stage` (5), `note` (4),
  `mark_client_event` (3), e um de cada de `set_field`,
  `reschedule_next_step`, `open_drafts`, `none`, `delete_next_step`,
  `create_next_step`, `complete_next_step`, `capture_signal`.
- **Duas ações são exceção:**
  - `delete_next_step` — uma só, "Não faz mais sentido" na regra
    `next_step_overdue`. Conflita com a invariante "nenhuma tool apaga".
  - `open_drafts` — uma só, "Redigir retomada". Só abre um painel, não escreve
    nada, `suppressDays: 0`.
- **As tools de escrita quase não devolvem id.** Só `log_activity`
  (`activity_id`) e `complete_next_step` (`next_step_id`). `set_next_step`,
  `move_stage`, `capture_signal` e `set_company_context` não devolvem nada
  identificável.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Como garantir que o trabalho aconteceu | A supressão vira **efeito colateral da escrita** | Fechar por construção, não por verificação: não há como suprimir sem ter escrito |
| Ações prontas da fila | Nova tool executa a ação **do app** | Os efeitos já existem, ligados e testados; o modelo escolhe, não improvisa |
| Ação destrutiva (`delete_next_step`) | **Recusada**, com recado para fazer no app | Erro do modelo se desfaz no app; o inverso não. Invariante da Fatia 1 mantida |
| Ação de rascunho (`open_drafts`) | **Não ofertada** | Não escreve nada e `suppressDays: 0`. No chat o Claude já redige o texto direto |
| Suprimir sem trabalho | Tool própria, renomeada | "Adiar" e "não se aplica" são legítimos — e passam a ser inconfundíveis com "tratei" |
| Pergunta que sumiu entre a leitura e a ação | **Recusar** | Efeitos amarrados a um `step.id` já concluído escreveriam no passado |

### Por que não exigir os ids do que foi escrito

Foi a primeira ideia: o modelo faz o trabalho, coleta os ids, passa como
comprovante, e o servidor confere. Duas coisas a derrubaram.

Custa mais peça: quatro das seis tools de escrita não devolvem id, então todas
precisariam mudar. E é mais fraco: o modelo ainda precisa carregar ids de uma
chamada para outra e fazer a segunda chamada — os dois pontos onde ele já falha.

Passar a chave na própria escrita elimina os dois. Não há id para carregar nem
segunda chamada para esquecer, porque não existe segunda chamada.

## Arquitetura

Nada de novo em `src/lib/pipeline/`. A Fatia 3 é uma tool nova, um parâmetro
opcional em quatro tools existentes, e uma renomeação.

```
src/lib/mcp/tools/answer-with-action.ts    executa a quick action do app
src/lib/mcp/tools/*.ts                     ganham answers_question_key
src/lib/mcp/suppress.ts                    valida a chave e grava o evento
        ↓
src/lib/pipeline/effects.ts                applyEffect — sem alteração
src/lib/pipeline/copilot-events.ts         recordCopilotEvent — sem alteração
src/lib/pipeline/rules.ts                  detectQuestions — sem alteração
```

## As mudanças

### 1. `answer_with_action` — nova tool

**Entrada:** `question_key`, `action_id`.

Recalcula a fila com `detectQuestions`, acha a pergunta pela chave, acha a ação
pelo id, aplica cada `effect` via `applyEffect` e grava o evento com o
`suppressDays` da própria ação. Uma chamada, atômica.

**Recusa, com o motivo, quando:**

- a chave não está na fila atual — pendência já tratada, ou o card mudou
- o `action_id` não existe naquela pergunta
- a ação tem efeito `delete_next_step` — "essa opção apaga um próximo passo;
  faça no app"

### 2. `answers_question_key` — parâmetro opcional

Ganham o parâmetro as quatro tools que respondem pendência na prática:
`log_activity`, `set_next_step`, `capture_signal`, `set_company_context`.

Quando presente, a tool faz o trabalho **e** grava a supressão, com
`NARRATION_SUPPRESS_DAYS[rule_id]`. A validação é barata: separa a chave em
`rule_id:company_id`, confere que a regra é uma das nove e que a empresa é a
mesma da tool.

**Chave inválida não desfaz a escrita.** A atividade é registrada e a supressão
é recusada, com o motivo na resposta. Falhar do lado seguro é a pergunta
continuar na fila.

`move_stage` e `complete_next_step` ficam de fora pelo mesmo motivo: avançar
estágio e concluir um passo já são ações prontas das regras que os pedem, e é
por `answer_with_action` que devem ser feitas. Dar as duas portas para a mesma
resposta só multiplicaria o jeito de errar.

### 3. A coluna `applied` deixa de ficar vazia

`copilot_question_events.applied` é um JSONB com o comentário *"proposta
estruturada efetivamente aplicada"*, e está vazio em todas as 64 linhas. Foi
feito para isto.

`answer_with_action` grava ali os efeitos que executou; o caminho de narração
grava o que a tool fez (`{ tool: "log_activity", activity_id: "…" }`). Sem
tabela nova, o histórico passa a responder "o que exatamente foi feito quando
essa pergunta sumiu" — que é a pergunta que se faz quando algo dá errado.

### 4. `answer_copilot_question` → `snooze_copilot_question`

Perde o status `answered`. Sobra `snoozed` e `dismissed` — os casos em que
nenhum trabalho é esperado.

A renomeação é o ponto: a tool que suprime sem fazer nada passa a se chamar pelo
que ela é. "Tratei" deixa de ser expressável sem trabalho.

### 5. `whats_stuck` — dois ajustes

Deixa de listar ações de rascunho, e passa a devolver `suppress_days` junto de
cada opção, para o modelo saber o custo do que escolhe.

## Invariantes

As da Fatia 1 seguem valendo, e uma nova:

1. **Nenhuma tool apaga** — reafirmada: a única ação destrutiva da fila é
   recusada.
2. **`last_client_event_at` só sobe quando o cliente agiu** — inalterada:
   `answer_with_action` usa os efeitos do app, que já respeitam isso.
3. **Nova: suprimir exige escrever.** A única forma de tirar uma pergunta da
   fila como tratada é através de uma tool que escreveu algo.

## Testes

Sem banco:

- separar e validar `question_key` — regra desconhecida, empresa divergente,
  formato quebrado
- `answer_with_action` recusa ação desconhecida e ação destrutiva
- `snooze_copilot_question` não aceita `answered`
- `whats_stuck` não lista ação de rascunho

Contra o banco, como as outras fatias: responder uma pendência real por ação
pronta e outra por narração, e conferir em `copilot_question_events` que existe
uma linha por resposta — e nenhuma linha sem escrita correspondente.

## Riscos aceitos

- **Descartar próximo passo continua exigindo o app.** É o preço de manter a
  invariante. Uma das quatro opções daquela pergunta fica indisponível no chat.
- **O modelo pode escrever sem passar a chave.** Aí o trabalho acontece e a
  pergunta fica na fila — ruído, não perda. É a direção certa do erro.
- **Duas pessoas respondendo a mesma pendência.** A segunda recebe a recusa de
  "pendência não existe mais". Correto, e a mensagem explica.

## Fora de escopo

- `person_situation` e tools de shortlist
- Enriquecimento por IA pelo MCP
- Aceitar nome de empresa no lugar de `company_id`
- Escrita em lote
