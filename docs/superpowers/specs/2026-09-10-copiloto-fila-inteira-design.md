# Copiloto: fila inteira com cobrança proporcional

Data: 2026-09-10
Estado: aprovado

## Problema

O painel do copiloto mostra no máximo 6 empresas por carga
(`COPILOT_DAILY_LIMIT`). O resto do pipeline tem pendência mas fica invisível.
Cada resposta libera uma vaga, e a sétima empresa aparece no refresh seguinte.
O usuário lê isso como "ele esconde o que está aberto e só me mostra aos
poucos".

Tirar o teto sem mais nada troca um problema por outro: hoje a única coisa que
faz o copiloto ficar quieto é uma resposta explícita (atalho, narração, adiar,
descartar). Com a lista inteira na tela, uma pendência de higiene (champion,
hipótese de dor) que ninguém respondeu volta todo dia, com o mesmo peso de uma
reunião de ontem.

## Decisões

| Pergunta | Decisão |
|---|---|
| Teto de empresas no painel | Sai. `detectQuestions` não corta empresas por padrão. O teto de 4 pendências por card fica. |
| Teto no MCP | Fica em 6 por padrão em `whats_stuck`, que já aceita `limit` até 50. No chat a lista inteira é ruído. |
| Quando o copiloto "já cobrou" | Quando o card da conta ficou na tela por pelo menos 3 segundos e o usuário clicou em outra conta na lateral. Fechar a página não conta. |
| O que acontece depois de cobrado | Cada pendência do card ganha um evento `seen` com `suppress_until` dado pela cadência da regra (tabela abaixo). |
| "Adiar conta" e "Adiar tudo" | Deixam de ser 1 dia fixo. Gravam `snoozed` com a mesma cadência por regra. |
| Lateral | Lista inteira, ordenada por prioridade, com divisor "Hoje" / "Quando der" e altura máxima com rolagem. |

Fora de escopo: mudar as regras, rascunhos, o MCP marcar "visto" quando o
Claude lê a fila, mexer no `snooze` de pendência única do hook (não tem UI).

## Cadência por regra

`suppress_until = hoje + N`, e a pergunta fica escondida enquanto
`suppress_until >= hoje`. Então N=0 esconde só hoje e a pergunta volta amanhã;
N=1 volta depois de amanhã. Esta é a semântica que já existe em
`recordCopilotEvent`. O "Adiar conta" atual grava N=1 com toast "adiada para
amanhã", ou seja, já escondia por dois dias; a tabela abaixo é o que passa a
valer.

```ts
// src/lib/constants.ts
export const SEEN_SUPPRESS_DAYS: Record<CopilotRuleId, number> = {
  meeting_yesterday: 0,       // volta amanhã
  next_step_overdue: 0,       // volta amanhã
  no_next_step: 2,
  frozen_candidate: 3,
  stalled_card: 3,
  no_signal_past_stage: 7,
  exit_criteria_unmet: 7,
  missing_champion: 7,
  missing_pain_hypothesis: 14,
}
```

A mesma tabela serve para `seen` e para `snoozed` vindo de "Adiar conta" /
"Adiar tudo". Responder depois de "visto" funciona normal: o evento de
resposta é outra linha e a supressão vale pela maior data.

## Dados

Migração `018_copilot_seen.sql`: acrescenta `seen` ao CHECK de `status` em
`copilot_question_events`. `seen` nunca carrega `action_id`, `answer_text` ou
`applied`. Append-only como antes.

```sql
alter table copilot_question_events
  drop constraint copilot_question_events_status_check;
alter table copilot_question_events
  add constraint copilot_question_events_status_check
  check (status in ('answered', 'snoozed', 'dismissed', 'seen'));
```

`recordCopilotEvent` passa a aceitar `status: "seen"`. Os tipos em
`src/types/database.ts` acompanham.

## Comportamento

### Detecção

`detectQuestions(snap, suppressed, opts)`: `opts.limit` continua existindo, mas
sem valor não há corte de empresas. `COPILOT_DAILY_LIMIT` deixa de ser o
default e passa a ser usado só por `whats_stuck` (`limit ?? COPILOT_DAILY_LIMIT`).
O comentário da constante muda para dizer isso.

### Rastreador de "visto"

Função pura em `src/lib/pipeline/seen-tracker.ts`, sem React:

```ts
interface SeenTracker {
  /** Chamado toda vez que o card em foco muda. Devolve a conta que saiu e
   *  merece 'seen', ou null se não ficou tempo suficiente. */
  focus(companyId: string | null, now: number): string | null
  /** Marca uma conta como já tratada: focus nunca mais a devolve. */
  skip(companyId: string): void
}
export function createSeenTracker(minDwellMs = 3000): SeenTracker
```

Regras: guarda `(companyId, since)`. Em `focus(next, now)`, se havia um
anterior diferente de `next`, não tratado, e `now - since >= minDwellMs`,
devolve o anterior e o marca como tratado. Sempre passa a rastrear `next`.
`focus(null)` (fila vazia) só zera. Um mesmo `companyId` só é devolvido uma
vez por sessão.

O painel chama `focus(current?.companyId ?? null, Date.now())` num efeito que
depende de `current?.companyId`. Quando devolve uma conta, chama
`markSeen(item)` do hook. A conta que saiu continua na fila da sessão: `seen`
só age no próximo load. Antes de responder, narrar ou adiar uma conta o painel
chama `skip(companyId)`: a conta sai da fila, `current` muda, e `focus` não a
devolve como vista. "Adiar tudo" chama `skip` para todas.

### Hook

`useCopilot` ganha `markSeen(item: CompanyQueueItem)`: para cada pendência do
card grava `seen` com `SEEN_SUPPRESS_DAYS[ruleId]`. Não mexe em `questions`.

`snoozeCompany(item)` perde o parâmetro `days` e usa
`SEEN_SUPPRESS_DAYS[pending.ruleId]` por pendência. `snoozeAll` idem.

### Painel

- Badge e subtítulo continuam mostrando o total de contas e pendências.
- Lateral: sempre visível quando `queue.length > 0` (hoje só com > 1), com
  `max-h-[32rem] overflow-y-auto`. Um rótulo "Hoje" antes da primeira conta
  com `priority >= 80` e "Quando der" antes da primeira com `priority < 80`.
  Se um dos grupos estiver vazio, o rótulo dele não aparece. O corte 80 é o de
  `stalled_card`: acima dele estão reunião, passo vencido, sem passo e gelado.
- Toast de "Adiar conta" vira `"${nome} adiada"`; "Adiar tudo" vira
  "Perguntas adiadas". O prazo varia por regra, então não dá para prometer
  "amanhã".

### MCP

`whats_stuck` passa `limit ?? COPILOT_DAILY_LIMIT`. Eventos `seen` gravados
pelo painel já valem para o MCP, porque ele lê as mesmas chaves suprimidas.
O MCP não grava `seen`.

## Testes

- `rules.test.ts`: sem `limit`, oito empresas bagunçadas viram oito cards;
  com `limit: 6` continua cortando em 6.
- `constants` ou `rules.test.ts`: `SEEN_SUPPRESS_DAYS` tem uma entrada por
  `CopilotRuleId` (o tipo `Record` garante em compilação; o teste garante que
  urgente < higiene: `meeting_yesterday` e `next_step_overdue` são 0 e
  `missing_pain_hypothesis` é o maior).
- `seen-tracker.test.ts`: troca antes de 3 s não devolve; troca depois de 3 s
  devolve a anterior; mesma conta não devolve duas vezes; `focus(null)` zera;
  conta pré-marcada não é devolvida.
- `copilot-events.test.ts` (novo, se não existir): `seen` insere com os campos
  de resposta nulos e `suppress_until` de hoje + N.
- `whats-stuck.test.ts`: o handler não tem teste (precisa de Supabase). O
  default sai para uma função pura exportada `effectiveLimit(limit?)`, que
  devolve `COPILOT_DAILY_LIMIT` sem valor e o valor quando informado.

## Arquivos

- `supabase/migrations/018_copilot_seen.sql` (novo)
- `src/types/database.ts`, `src/types/copilot.ts`
- `src/lib/constants.ts`
- `src/lib/pipeline/rules.ts`, `rules.test.ts`
- `src/lib/pipeline/copilot-events.ts`
- `src/lib/pipeline/seen-tracker.ts`, `seen-tracker.test.ts` (novos)
- `src/lib/mcp/tools/whats-stuck.ts`, `whats-stuck.test.ts`
- `src/hooks/use-copilot.ts`
- `src/components/copilot/copilot-panel.tsx`
- `docs/specification.md` (linha dos tetos), `docs/memory.md`
