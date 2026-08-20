# Copiloto: fila por empresa

**Data:** 2026-08-20
**Status:** implementado

## Problema

A lista lateral do copiloto usa o nome da empresa como título de cada item. Com
`COPILOT_MAX_PER_COMPANY = 2`, a mesma conta aparecia duas vezes — e, como a
ordenação é global por prioridade, nem lado a lado. O usuário lia isso como "o
copiloto está repetindo empresas".

Pior que o visual: responder em texto livre sobre a Acme não tirava a segunda
pergunta da Acme da fila, mesmo quando a narração já tinha coberto o assunto.

## Decisão

A fila passa a ser **por empresa**: um card por conta, com todas as pendências
dela dentro, respondível de uma vez.

### Onde agrupa

Função pura `buildCompanyQueue` em `src/lib/pipeline/queue.ts`. `rules.ts` fica
intocado: cada regra continua produzindo uma pergunta atômica, que é o que
mantém `question_key` (`rule_id:company_id`) estável e, com ele, todo o mecanismo
de supressão. O agrupamento é camada derivada, como `metrics.ts` é do snapshot.

Alternativa descartada: fazer `detectQuestions` devolver a estrutura agrupada.
Acopla detecção e apresentação, e teria mexido no núcleo que as métricas também
usam.

### Tetos

As duas constantes mudam de significado:

| Constante | Antes | Agora |
|---|---|---|
| `COPILOT_DAILY_LIMIT` | 10 perguntas/dia | **6 empresas/dia** |
| `COPILOT_MAX_PER_COMPANY` | 2 perguntas/empresa | **4 pendências por card** |

O corte por empresa em `detectQuestions` só barra conta **nova**: uma empresa que
já entrou continua somando pendências até o teto do card. Sem isso o corte diário
cairia no meio de um card e o usuário responderia a conta pela metade sem saber
que faltava algo.

### Semântica da resposta

- **Atalho** (botão de uma pendência): resolve só aquela linha, com o
  `suppressDays` da própria ação. O resto do card continua de pé.
- **Narração**: responde o card inteiro. As pendências que a narração resolveu
  por dado somem sozinhas no próximo load (as regras recomputam a cada load —
  perguntas nunca são persistidas). As que continuam verdadeiras ficam
  suprimidas pelos dias de `NARRATION_SUPPRESS_DAYS[ruleId]`, para o copiloto
  não insistir amanhã com algo que você acabou de responder.
- **Adiar conta**: suprime todas as pendências da empresa por 1 dia. É o
  escape explícito para "não aconteceu nada aqui".

`/api/copilot/interpret` passa a receber todas as pendências do card em
`questionTitle`, então o modelo extrai champion + próximo passo da mesma
narração em vez de responder só a pergunta do topo.

## Custo aceito

Narrar algo genérico e aplicar suprime as pendências do card pelos dias das
regras. É o preço de "narrar responde o card todo"; quem quer só empurrar a
conta usa "Adiar conta", que é explícito e dura 1 dia.

## Verificação

- `buildCompanyQueue`: agrupamento, herança de prioridade, ordem, lista vazia.
- `detectQuestions`: teto de pendências corta o card e não a empresa; teto
  diário conta empresas; ordem por prioridade dentro do card; supressão.
- Interpretação real contra a API com as 3 pendências no prompt: 3/3 extraíram
  champion e próximo passo com data, sem marcar evento do cliente (preparar
  proposta é ação do vendedor — a invariante de `last_client_event_at` se manteve).
