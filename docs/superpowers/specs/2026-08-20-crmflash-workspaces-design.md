# CRMFlash — Workspaces compartilhados

**Data:** 2026-08-20
**Status:** design aprovado, aguardando plano de implementação

## Problema

O CRMFlash é single-tenant por usuário de ponta a ponta: as 15 tabelas têm
`user_id NOT NULL REFERENCES auth.users`, e as ~59 policies de RLS são todas
`user_id = auth.uid()`. Os hooks ainda filtram `.eq("user_id", user.id)` por
cima, como defense-in-depth do hardening de segurança.

Não existe nenhum conceito de time, organização ou workspace.

Duas pessoas precisam operar **um único** funil comercial: mesmo kanban, mesmas
empresas, mesmas pendências do copiloto. Hoje isso é impossível — até
`kanban_columns` é por usuário, então cada uma teria um quadro diferente.

## Estado atual relevante

- **Um único usuário** cadastrado (`gq.monteiro@gmail.com`).
- 3.058 empresas, 4.278 pessoas, 10 colunas de kanban, 145 membros de shortlist,
  80 atividades de empresa, 77 próximos passos, 48 eventos do copiloto.
- Como só há um usuário, a migração é "cria um workspace e move tudo". Não há
  merge de bases de duas contas.
- Auth: e-mail+senha e OAuth, com signup aberto.
- A integração com o TranscriptionApp autentica por segredo compartilhado e
  resolve o dono por uma env var fixa, `INTEGRATION_USER_ID`.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo do compartilhamento | Workspace do time: **tudo** dentro | É o único desenho em que o kanban é de fato o mesmo quadro |
| Multi-workspace | **Não** — um workspace por pessoa | `workspace_id` sai da sessão; sem seletor, sem "workspace atual", muito menos superfície pra vazamento |
| Papéis | **Plano** — todo membro edita tudo e convida | Escolha explícita do usuário; ver "Riscos aceitos" |
| Convite | Por e-mail, com aceite | Mesmo padrão já rodando em produção no TranscriptionApp (`project_invitations`); não depende de enviar e-mail |
| Autoria | Manter "quem fez"; exibir onde importa | Sai de graça: a coluna `user_id` atual **já é** quem criou a linha. Ela permanece nas 13 tabelas (não custa nada), mas só é exibida na UI onde muda a conversa: atividades, próximos passos, eventos de estágio e copiloto |
| Estratégia de migração | Aditiva: `workspace_id` **ao lado** de `user_id` | Reversível, faseável, e preserva a autoria histórica |

### Por que aditiva e não renomear `user_id` para `workspace_id`

Renomear produz um schema final mais limpo, mas:

- É tudo-ou-nada: os ~87 pontos do código que fazem `.eq("user_id", user.id)`
  quebram no instante em que a migração roda, com 3 mil empresas dentro.
- Joga fora a coluna que já registra quem criou cada linha.

A abordagem aditiva entrega a autoria pedida **sem coluna nova** e permite que
schema e código sejam deployados separadamente (ver "Migração").

### Por que não espelhar o padrão do TranscriptionApp

No TranscriptionApp o compartilhamento funciona porque existe um container — o
projeto — e a reunião aponta pra ele; as policies só acrescentam "membro do
projeto também vê".

No CRMFlash não há container. "Mesmo workspace" teria que ser resolvido por um
join `user_id` → `workspace_members` em cada policy de cada tabela, e os INSERTs
continuariam gravando o `user_id` de quem digitou. O resultado não seria um CRM
único, e sim a união de dois CRMs — com dois quadros de kanban, que é
exatamente o sintoma que motivou o pedido.

## Modelo de dados

### Tabelas novas

```sql
create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  unique (user_id)
);

create table workspace_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  invited_email text not null,
  invited_by    uuid not null references auth.users(id),
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  unique (workspace_id, invited_email)
);
```

`unique (user_id)` — e não `unique (workspace_id, user_id)` — é o que torna "um
workspace por pessoa" invariante de banco em vez de regra que o código precisa
lembrar de aplicar.

### Tabelas existentes

**13 ganham `workspace_id uuid not null references workspaces(id) on delete cascade`:**
`companies`, `people`, `kanban_columns`, `tags`, `shortlists`, `activities`,
`import_history`, `company_documents`, `company_activities`,
`company_next_steps`, `company_commitment_signals`, `company_stage_events`,
`copilot_question_events`.

**2 não mudam:** `people_tags` e `shortlist_members` não têm `user_id` hoje —
já são escopadas pelos pais (`people` / `shortlists`). Adicionar `workspace_id`
nelas criaria uma segunda fonte de verdade para sair de sincronia.

`user_id` permanece nas 13, com significado novo e documentado no schema:

```sql
comment on column companies.user_id is
  'Quem criou esta linha. NAO e escopo de acesso -- use workspace_id.';
```

### Mudanças de constraint e índice

- **`user_id` passa a ser nullable e `ON DELETE SET NULL`** nas 13 tabelas.
  Hoje é `NOT NULL ... ON DELETE CASCADE`, o que está correto enquanto `user_id`
  significa posse. Quando passa a significar autoria, apagar a conta de um
  membro apagaria em cascata todas as empresas, pessoas e atividades que ele
  criou — dados do workspace, não dele.
- **`idx_people_dedup`** (índice único que impede duplicata na importação) passa
  a ser por `workspace_id`. Sem isso, as duas importam a mesma planilha e o CRM
  aceita duplicatas silenciosamente.
- Os índices `idx_*_user_id` passam a ser por `workspace_id`. Com 3.058 empresas
  e 4.278 pessoas, índice na coluna errada degrada toda listagem.
- `create_default_kanban_columns(p_user_id)` vira
  `create_default_kanban_columns(p_workspace_id)`, mantendo o guard interno da
  migration 005 (agora comparando com `current_workspace()`), e passa a ser
  chamada **na criação do workspace**.

## RLS

### A função da qual tudo decorre

```sql
create or replace function current_workspace()
returns uuid
language sql stable security definer
set search_path = public
as $func$
  select workspace_id from workspace_members where user_id = auth.uid();
$func$;
```

Sem parâmetro: não há como pedir o workspace de outra pessoa — exatamente o
buraco que a migration 005 teve que tapar em `create_default_kanban_columns`.
O `set search_path` fecha o vetor clássico de SECURITY DEFINER.

### Policies

- **13 tabelas:** todas as policies viram `workspace_id = current_workspace()`.
- **2 filhas:** o `EXISTS (... user_id = auth.uid())` vira
  `EXISTS (... workspace_id = current_workspace())`.
- **Storage (`company-documents`):** hoje
  `(storage.foldername(name))[1] = auth.uid()::text`. Passa a:

  ```sql
  (storage.foldername(name))[1]::uuid in (
    select user_id from workspace_members where workspace_id = current_workspace()
  )
  ```

  Nenhum arquivo se move.

- **`workspaces`:** leitura para quem é do workspace (`id = current_workspace()`).
  INSERT permitido a usuário autenticado que ainda **não** é membro de nenhum
  workspace (`current_workspace() is null`) — é o que permite o bootstrap do
  primeiro login sem abrir criação de workspace para quem já tem um.
- **`workspace_members`:** leitura para quem é do workspace. DELETE permitido a
  qualquer membro do mesmo workspace (modelo plano), sujeito à guarda do último
  membro abaixo.
- **`workspace_invitations`:** você vê os do seu workspace **ou** os endereçados
  ao seu e-mail. Qualquer membro insere (modelo plano). O convidado atualiza
  para `accepted` / `declined` apenas os do próprio e-mail.

### A única regra que não deriva de `current_workspace()`

Quem está aceitando um convite ainda não é membro, então `current_workspace()`
retorna `null` para ele. A policy de INSERT em `workspace_members` precisa ser:

```
user_id = auth.uid()
AND EXISTS (convite pending para o meu e-mail naquele workspace)
```

### Guarda contra workspace órfão

O modelo plano permite que qualquer membro remova qualquer um. **A remoção do
último membro é bloqueada** — sem isso é possível esvaziar o workspace e deixar
3.058 empresas sem ninguém capaz de vê-las, nem por RLS nem pela UI. Sair
sozinho continua permitido enquanto houver outra pessoa.

A guarda fica num **trigger `BEFORE DELETE` em `workspace_members`**, não na UI
nem numa policy: policy de DELETE não consegue contar as linhas restantes, e
validar só no cliente deixaria a regra contornável por qualquer chamada direta
ao PostgREST.

## Camada de aplicação

São ~87 referências a `user_id` em 23 arquivos, em quatro grupos.

### 1. `WorkspaceProvider` no `(dashboard)/layout.tsx`

O layout já busca o usuário e, se ele não tiver colunas de kanban, chama
`create_default_kanban_columns`. Passa a resolver o workspace no mesmo ponto e
prover por contexto; os hooks consomem `useWorkspace()` em vez de cada um
refazer `auth.getUser()`.

O bootstrap de colunas muda de gatilho: de "usuário sem colunas" para "workspace
recém-criado". Sem isso, a segunda pessoa a logar criaria um segundo conjunto de
colunas em cima do quadro existente.

### 2. Hooks (9 arquivos)

```ts
// antes
.eq("user_id", user.id)
.insert({ ...data, user_id: user.id })

// depois
.eq("workspace_id", workspaceId)
.insert({ ...data, workspace_id: workspaceId, user_id: user.id })
```

O filtro explícito continua mesmo com RLS cobrindo — é o defense-in-depth já
adotado no hardening, e agora protege também contra bug de escopo.

### 3. Rotas de API

- **`/api/integration/*`** (3 rotas): `validateIntegrationAuth` passa a devolver
  `{ userId, workspaceId }`, resolvendo o workspace do `INTEGRATION_USER_ID`.
  **Nada muda no TranscriptionApp** — mesma env var, mesmo secret, mesmo payload.
- **`/api/enrich`, `/api/enrich/batch`, `/api/copilot/interpret`:** escopo por
  workspace.

### 4. Copiloto

`copilot_question_events` escopado por workspace significa **supressão
compartilhada**: se uma responde, a pergunta some para as duas. O oposto faria
as duas serem cobradas pela mesma pendência, que é o caminho mais curto para o
copiloto virar ruído. O `user_id` do evento registra quem respondeu.

Os tetos do `buildCompanyQueue` (6 empresas/dia, 4 pendências/empresa) passam a
valer **por workspace**. Por pessoa, duas pessoas gerariam 12 empresas/dia e o
limite perderia o sentido.

### 5. Telas

- **`/settings`** (já existe): membros, convidar por e-mail, convites pendentes,
  sair do workspace.
- **Convite pendente:** no primeiro login, tela de aceitar/recusar em vez de um
  dashboard vazio.
- **Autoria:** "quem registrou" nas atividades, "de quem é" nos próximos passos,
  "quem moveu" no histórico de estágios.

## Migração

### Fase 1 — `010_workspaces.sql` (schema + RLS, deployável sozinha)

1. Cria as 3 tabelas, `current_workspace()` e as policies delas.
2. Cria o workspace inicial a partir do usuário existente e o insere como membro.
3. Adiciona `workspace_id` nullable nas 13 tabelas, faz backfill via `user_id`,
   depois `set not null`.
4. Aplica `alter column workspace_id set default current_workspace()` nas 13
   (ver "O que torna as fases independentes" — é o que mantém o código antigo
   funcionando entre os dois deploys).
5. Troca `user_id` para nullable / `ON DELETE SET NULL` nas 13.
6. Cria o trigger `BEFORE DELETE` da guarda do último membro.
7. Troca índices, `idx_people_dedup`, as 59 policies e a policy de storage.
8. `create_default_kanban_columns` passa a receber `p_workspace_id`.

### Fase 2 — código

Tudo da seção "Camada de aplicação".

### O que torna as fases independentes

Uma linha por tabela:

```sql
alter table companies alter column workspace_id set default current_workspace();
```

O código antigo, que insere sem `workspace_id`, passa a gravar no workspace
certo em vez de estourar `NOT NULL`. E o `.eq("user_id", user.id)` que ele ainda
faz apenas restringe demais (cada um vê só o que é seu) — nunca vaza. Entre as
duas fases o app segue funcionando exatamente como hoje.

O `default` também fica como rede permanente: qualquer insert que escape sem
`workspace_id` cai no workspace certo em vez de criar linha órfã.

**Rollback da fase 1:** restaurar as policies antigas. Os dados não se moveram.

## Casos de borda

| Caso | Comportamento |
|---|---|
| Convidada já pertence a outro workspace | `unique (user_id)` barra o aceite. A UI explica que ela precisa sair do workspace atual antes — não devolve erro de constraint |
| Convite para e-mail sem conta | Fica `pending` até ela se cadastrar. Não depende de envio de e-mail |
| Pessoa se cadastra antes de aceitar | O signup **não** cria workspace se houver convite `pending` para o e-mail; mostra a tela de convite. Sem isso ela ganharia workspace próprio e o `unique (user_id)` a prenderia num CRM vazio |
| Usuário novo sem convite | Ganha um workspace próprio automaticamente |
| Remoção de membro | Tira o acesso e só. Os dados são do workspace e ficam |
| Remoção do último membro | Bloqueada |

## Verificação

O projeto tem vitest, mas cobre apenas lógica pura (`src/lib/pipeline/`). **O
risco real aqui é RLS, que vitest não alcança.**

- **`scripts/verify-workspace-rls.ts`** — cria dois usuários descartáveis (um
  dentro do workspace, um fora) e, para cada uma das 15 tabelas, afirma que o de
  dentro lê e escreve e o de fora não lê nada. Roda contra o banco real antes do
  deploy da fase 2 e remove os usuários no fim. É o teste que importa.
- **vitest:** cobertura dos tetos do `buildCompanyQueue` agora que são por
  workspace e não por pessoa. Os testes existentes continuam valendo.

## Riscos aceitos

- **Modelo plano de permissões** (escolha explícita do usuário): qualquer membro
  convida e remove qualquer um. Não há como desfazer um convite errado sem risco
  de remoção mútua. Mitigação parcial: bloqueio de remoção do último membro.
- **`user_id` muda de significado sem mudar de nome.** Mitigado por
  `COMMENT ON COLUMN` nas 13 tabelas, mas depende de disciplina para ninguém
  voltar a usá-la como escopo.

## Fora de escopo

Deliberadamente não incluídos, para não construir o que não foi pedido:

- Papéis granulares por módulo.
- Múltiplos workspaces por pessoa e seletor de workspace.
- Transferência de propriedade do workspace (não há "dono" no modelo plano).
- E-mail transacional de convite (o link vai por WhatsApp).
- Log de auditoria além do `user_id` de autoria que já existe.
