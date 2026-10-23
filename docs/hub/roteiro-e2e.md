# Roteiro ponta a ponta do MVP: reunião acontece → CRM se atualiza

Para rodar com uma reunião real. Leva cerca de 20 minutos, mais a reunião.

Cada passo diz o que conferir e como. As consultas SQL rodam no SQL Editor do
Supabase. Troque `<EMPRESA>` pelo id da conta usada no teste.

## 0. Pré-requisitos (uma vez)

1. **Migrações aplicadas, nesta ordem, no SQL Editor:**
   - CRM: `019_hub_eventos.sql`, `020_identidade.sql`, `021_inferencias_e_sync.sql`.
   - TranscriptionApp: `023_meeting_calendar_event_unique.sql` (PR gmonteiro/TranscriptionApp#6).
   - Se a 020 avisar `chaves de nome duplicadas`, rode a consulta comentada no fim dela e resolva os duplicados antes. O índice único de nome fica de fora até lá; o resto funciona sem ele.

   Para conferir:
   ```sql
   select count(*) from person_identities;                    -- > 0 (backfill dos e-mails)
   select count(*) from company_domains;                      -- > 0 se havia companies.domain
   select proname from pg_proc where proname = 'bump_client_event';
   ```

2. **Google:**
   - Projeto do Google Cloud com tela de consentimento **Internal**.
   - Calendar API ligada.
   - Cliente OAuth do tipo "App para computador".
   - Depois, no CRM:
     ```bash
     node --env-file=.env.local scripts/google-refresh-token.mjs
     ```
     Faça login com a conta **comercial** da Lumeis e copie o `GOOGLE_REFRESH_TOKEN`.

3. **Token do TranscriptionApp:** no TranscriptionApp, `node scripts/gen-service-token.mjs`.
   - O token vai para o CRM, em `TRANSCRIPTIONAPP_SERVICE_TOKEN`.
   - O hash vai para o TranscriptionApp, em `TAPP_SERVICE_TOKEN_SHA256`.

4. **Variáveis na Vercel (Production).** A lista está no PR. Faça o redeploy dos dois projetos.

5. **Pré-voo:**
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" https://crmflash.vercel.app/api/cron/calendar-sync | jq
   ```
   Esperado: `fullSync: true`, `seen > 0`. Um `401` aqui é `CRON_SECRET`; um `500 Google token 400` é o refresh token.

## 1. Convite

1. Escolha uma conta do funil com domínio próprio (não gmail).
   - Confira que o domínio está ligado: `select * from company_domains where company_id = '<EMPRESA>';`
   - Se não estiver, ligue na mão: `insert into company_domains (workspace_id, domain, company_id, source) select workspace_id, 'acme.com.br', id, 'manual' from companies where id = '<EMPRESA>';`
2. Crie no Calendar um convite com uma pessoa dessa empresa.
3. No Claude (MCP do CRM): **"roda o sync_now só do calendar"**.

**Conferir:**
```sql
select kind, title, client_engaged, engagement_rule, occurred_at
  from activities where company_id = '<EMPRESA>' and source = 'calendar' order by created_at desc;
```
- Uma linha `meeting.scheduled`, com `client_engaged = false` e `engagement_rule = cal.lumeis_invite`.
- A pessoa existe, ligada pelo e-mail: `select p.full_name, i.value_norm, i.confidence from person_identities i join people p on p.id = i.person_id where i.value_norm = '<email do convidado>';`
- O contador **não** mudou (o convite foi seu): `select last_client_event_at from companies where id = '<EMPRESA>';`
- **Idempotência:** rode o `sync_now` de novo. A contagem da primeira consulta continua a mesma.

## 2. Reunião

1. Na hora, abra o TranscriptionApp e grave **pelo card "Agenda"**: é isso que grava o `google_calendar_event_id`.
2. A reunião precisa ter fala do cliente. Gravação só com a sua voz não conta como ação dele, por desenho.
3. Termine e espere o `transcribe-full` (a reunião vai para `completed`).

## 3. Ingestão e extração

No Claude: **"sync_now"**. A saída `transcripts.processed[0]` deve vir com:
- `status: "linked"`;
- `companies: ["<EMPRESA>"]`;
- `extracted: true`;
- `dropped`: quantos itens a IA tentou e foram recusados por citação não literal. Pode ser maior que zero; é o filtro funcionando.

**Conferir:**
```sql
-- O evento da reunião e quem agiu
select kind, client_engaged, engagement_rule, occurred_at, summary->>'text' as resumo
  from activities where company_id = '<EMPRESA>' and kind = 'meeting.held';

-- O contador foi para o horário da REUNIÃO, não para a hora do sync
select last_client_event_at from companies where id = '<EMPRESA>';

-- O que a IA concluiu, com a evidência
select field, status, value, evidence->0->>'quote' as citacao, evidence->0->>'locator' as onde
  from inferences where company_id = '<EMPRESA>' order by created_at;

-- Próximos passos criados, com prazo
select title, due_date, description, source_ref from company_next_steps
 where company_id = '<EMPRESA>' and source_ref like 'tapp:%';
```

**Esperado:**
- `meeting.held` com `client_engaged = true` e `engagement_rule = meeting.client_spoke`.
- `last_client_event_at` igual ao `occurred_at` da reunião.
- Champion e dor:
  - Campo vazio antes do teste: `status = applied`, e o valor aparece no card da empresa.
  - Campo já preenchido: `status = proposed`, e a proposta aparece no `whats_stuck`. Nada foi sobrescrito.
- Cada citação está de fato na transcrição. Abra o `app_url` e procure o trecho.
- `stage_suggestion`, se houver, aparece **sempre** como `proposed`.

## 4. Nada duplica

Rode o `sync_now` mais duas vezes e repita as quatro consultas do passo 3. As contagens têm que ser idênticas.

O custo também: na segunda rodada, `extracted: false` (não chamou o modelo de novo).

## 5. Estágio só com o seu clique

1. No Claude: **"o que está parado?"** (`whats_stuck`). Se houve sugestão de estágio, ela aparece como pendência `inference_proposed`, com a citação no subtítulo.
2. Antes de responder, a empresa continua no estágio de antes. Confira no board.
3. Responda "Mover para …" e confira:
   ```sql
   select to_title, direction, occurred_at from company_stage_events where company_id = '<EMPRESA>' order by occurred_at desc limit 1;
   select status, decided_at from inferences where company_id = '<EMPRESA>' and field = 'stage_suggestion';
   ```

## 6. Explicação

No Claude: **"por que o CRM acha que o champion da <empresa> é <nome>?"** (`explain`). A resposta tem que trazer a frase e o link da gravação.

## 7. Casos de borda (opcional, mas é onde quebra)

| Caso | Como provocar | Esperado |
|---|---|---|
| Domínio desconhecido | Convite com alguém de `@novaempresa.com` | Nada é gravado na conta; um caso `dominio_desconhecido` aparece em `list_identity_reviews`. Resolva com `resolve_identity` (`create_company` ou `link_company`) e rode o `sync_now`: o convite é religado |
| E-mail pessoal | Convidado `@gmail.com` | Caso `email_generico_desconhecido`; nunca liga empresa sozinho |
| Reunião sem convite | Gravar uma reunião fora do card Agenda, em horário sem convite | Caso `reuniao_sem_convite`; resolva com `attach_transcript` |
| Reunião remarcada | Mude o horário do convite e rode o `sync_now` | Um `meeting.rescheduled`, uma vez por novo horário |
| Cancelada | Cancele o convite | `meeting.cancelled`, `client_engaged = false` |
| Ligação de ontem | "registra a ligação de ontem às 15h com o João, ele atendeu" | `log_activity` com `occurred_at`; o contador vai para ontem às 15h, não para agora |

## 8. Envio revisado do TranscriptionApp (opcional)

No TranscriptionApp, abra a reunião do passo 2 → "Enviar para o CRM" → destino
**empresa** → revise próximos passos (prazo, responsável), marque um sinal e
deixe um contato marcado → Enviar.

A resposta de cada destino traz `next_steps_created`, `signals_captured`,
`contacts_created`, `contacts_in_review` e `structured` item a item.

**Conferir:**
```sql
-- Seus passos: chave tapp:<reunião>:h:..., prazo e responsável
select title, due_date, description, status, source_ref from company_next_steps
 where company_id = '<EMPRESA>' and source_ref like 'tapp:%' order by created_at;

-- De onde veio cada coisa: model = 'humano:transcriptionapp' é você; o resto é a IA
select field, status, model, value->>'title' as passo from inferences
 where company_id = '<EMPRESA>' and (field like 'next_step:%' or field like 'signal:%') order by created_at;
```

**Esperado:**
- Passo que a IA já tinha criado da mesma reunião com o mesmo sentido: **uma** linha, com os seus valores e `source_ref` `...:h:...`; a inferência da IA fica `superseded`.
- Rode o `sync_now` depois: nenhum passo novo. O que só a IA viu aparece como `proposed` e vira pergunta no `whats_stuck` ("Cria?").
- Envie de novo pelo app: contagens iguais, resposta com `existing`.
- Contato homônimo na empresa: caso `homonimos_na_empresa` na fila, nenhuma pessoa nova.

## Se algo der errado

- **`500 TRANSCRIPTIONAPP_API_URL…`:** falta variável no CRM.
- **`TranscriptionApp 401`:** o hash e o token não batem. Gere de novo pelo script.
- **`transcripts.failed` com `Extração…`:** o cursor não avançou, e a próxima rodada tenta de novo. Veja o erro na saída.
- **Reunião `no_calendar_event` apesar de ter convite:**
  - Confira se a gravação começou pelo card Agenda, ou se o horário cai dentro do convite (±15 min).
  - Também não pode haver dois convites no mesmo horário.
- **Inserts voltando 400 em silêncio:** migração não aplicada. Rode as consultas do passo 0.
