# CRMFlash — Servidor MCP

**Data:** 2026-08-27
**Status:** Fatia 1 implementada e verificada contra o banco. Fatia 2 (OAuth) pendente.

## Problema

O CRMFlash só é operável pela própria interface. Registrar que uma reunião
aconteceu, mover um estágio ou consultar o que está parado exige abrir o app,
achar a empresa e clicar. O copiloto reduziu o atrito — ele pergunta em vez de
esperar — mas continua preso a `/dashboard`.

Na prática, o momento em que a informação existe (logo depois da reunião, no
celular, a caminho da próxima) é o momento em que o CRM está mais longe. O que
não é registrado nos primeiros minutos costuma não ser registrado nunca, e um
pipeline com `last_client_event_at` desatualizado produz um copiloto que
pergunta a coisa errada.

Um servidor MCP inverte isso: o CRM vira ferramenta do Claude. Você narra a
reunião no chat — no desktop ou no celular — e o pipeline fica em dia sem passar
pelo app.

## Estado atual relevante

- **Um workspace por pessoa.** `getWorkspaceId` usa `.maybeSingle()` sobre
  `workspace_members`; não existe seletor de workspace nem workspace "atual".
  O token pode carregar o workspace fixo.
- **RLS por workspace, já em produção.** `current_workspace()` é `SECURITY
  DEFINER` e lê `auth.uid()`. Todas as policies escopam por ela.
  `scripts/verify-workspace-rls.mjs` verifica isso hoje.
- **O projeto assina com chave assimétrica.** A chave corrente é ECC P-256
  (`kid 7c25a0d6-…`) e a Supabase não exporta a parte privada. O segredo HS256
  legado ainda existe, mas em "Previously used keys", com instrução de revogar.
  **Não dá para assinar um JWT nós mesmos** — só cunhar sessão pelo admin API.
  (A anon key continua sendo um JWT HS256 legado; isso não diz nada sobre a
  chave que assina as sessões, e confundir as duas foi o erro que este design
  cometeu na primeira versão.)
- **Derivações de pipeline já centralizadas em `src/lib/pipeline/`:**
  `fetchPipelineSnapshot()`, `detectQuestions()`, `buildCompanyQueue()`,
  `computePipelineMetrics()`, `applyStageMove()`, `inferDirection()`,
  `daysSinceClientEvent()`, `daysInCurrentStage()`, `isTerminal()`.
  Métricas e copiloto já leem a mesma fonte.
- **Precedente de acesso máquina-a-máquina:** `/api/integration/*` autentica
  por segredo compartilhado (`validateIntegrationAuth`), usa service role e
  escopa `workspace_id` na mão em cada query.
- **Tabelas relevantes:** `companies`, `people`, `company_activities`,
  `company_next_steps`, `company_commitment_signals`, `company_stage_events`,
  `copilot_question_events`, `kanban_columns`.
- **Duas tabelas de atividade, com donos diferentes.** `activities` é escrita
  só pelo TranscriptionApp (`/api/integration/activities`) e lida pelo snapshot
  — é dela que a regra `meeting_yesterday` tira "houve reunião ontem".
  `company_activities` é onde **todo o app** escreve: timeline, documentos,
  next steps, pipeline e o próprio copiloto. O MCP escreve em
  `company_activities`. Consequência aceita: narrar uma reunião pelo MCP não
  dispara `meeting_yesterday` — e não deve mesmo, já que a pergunta daquela
  regra é exatamente o que você acabou de responder.
- **As escritas do copiloto estão presas ao cliente.** `applyEffect` e
  `recordEvent` vivem dentro de `useCopilot()` (`src/hooks/use-copilot.ts`), e
  são exatamente o que as tools de escrita precisam. Extraí-las para
  `src/lib/pipeline/` é pré-requisito da Fatia 1.
- **Já instalados:** `zod`, `@supabase/supabase-js`, `vitest`.
- **Produção:** `https://crmflash.vercel.app`.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Direção | O CRM **exposto** como MCP | O cliente é o Claude; o CRM é a ferramenta |
| Escopo | Leitura **e** escrita | Ler sem poder registrar não tira nenhum passo do app |
| Hospedagem | `/api/mcp` no próprio Next.js, na Vercel | Uma base, um deploy; libera celular e qualquer máquina |
| Autenticação | **OAuth 2.1** | É a única forma de o claude.ai (web e celular) conectar; não há onde colar Bearer lá |
| Acesso ao banco | **Sessão Supabase cunhada pelo servidor** (admin API) | A RLS que já existe passa a escopar toda tool; filtro esquecido deixa de ser vazamento |
| Cadastro novo | `find_or_create`, com o dedup do wizard de import | Narrar reunião de empresa nova não pode exigir abrir o app |
| Interpretação de texto livre | **Fora** | O cliente já é o Claude; passar por Haiku interpretaria duas vezes |
| Exclusão | Nenhuma tool apaga | Erro do modelo se desfaz no app; o inverso não |

### Por que as tools não falam com o banco

Cada tool chama `src/lib/pipeline/`, não o Supabase diretamente. A mesma
`applyStageMove()` que o drag&drop usa, a mesma `detectQuestions()` que o
copiloto usa. Regra de pipeline que mude, muda nos dois de uma vez.

O contrário — tools reimplementando "o que é um estágio terminal", "quando a
pergunta reaparece" — produz um segundo CRM, divergente do primeiro, dentro do
mesmo repositório. É exatamente o que `src/lib/pipeline/` foi extraído para
evitar.

### Por que sessão cunhada e não service role

O `/api/integration/*` usa service role e escopa na mão. Funciona porque são
três rotas de forma conhecida. Numa superfície de 14 tools com escrita, um
`.eq("workspace_id", …)` esquecido é vazamento entre workspaces, e nenhum teste
existente pega.

Cunhando uma sessão real pelo admin API — `generate_link` seguido de `verify` —
o token sai assinado pela chave **corrente** do projeto, e `auth.uid()` e
`current_workspace()` funcionam nativamente. Três consequências:

1. A RLS escopa toda query sem a tool pedir.
2. `user_id` nos INSERTs sai correto — a autoria na timeline funciona de graça.
3. `verify-workspace-rls.mjs` passa a cobrir o caminho do MCP.

A alternativa de **assinar** o JWT nós mesmos morreu quando o projeto migrou para
chaves assimétricas. E reaproveitar a sessão do navegador nunca serviu: o refresh
token rotaciona a cada uso, então MCP e navegador brigariam pela mesma sessão.
Cunhar resolve os dois — é uma sessão independente, assinada pela chave corrente.

Custo: cada `verify` cria uma linha em `auth.sessions`. Por isso `session.ts`
mantém cache de processo e renova por refresh token, cunhando do zero só quando
não há o que renovar.

## Arquitetura

```
/api/mcp/route.ts          transporte JSON-RPC sobre Streamable HTTP
        ↓
src/lib/mcp/registry.ts    catálogo: nome, descrição, schema zod, handler
src/lib/mcp/tools/*.ts     uma tool por arquivo
        ↓
src/lib/mcp/identity.ts    token → { userId, workspaceId, supabase }
src/lib/mcp/session.ts     cunha e renova a sessão pelo admin API
        ↓
src/lib/pipeline/*         o que já existe
```

`identity.ts` expõe **uma** função — `resolveIdentity(request)` — com duas
implementações por trás:

- **Fatia 1:** token de desenvolvimento em env var, resolvido para um usuário
  fixo. Nunca vai para produção.
- **Fatia 2:** token OAuth opaco, consultado em `mcp_oauth_tokens`.

O transporte e as tools não sabem qual está ativa. É o que permite construir e
usar a fatia 1 no Claude Code enquanto a 2 não existe, sem que isso vire uma
concessão no produto final.

## Fatia 1 — transporte e tools

### Transporte

`POST /api/mcp` falando JSON-RPC 2.0 sobre Streamable HTTP: `initialize`,
`tools/list`, `tools/call`. Sem SSE e sem estado de sessão — cada requisição
carrega seu token e é resolvida sozinha, que é o que a Vercel comporta bem.

`maxDuration = 60`, como o `/api/enrich` já faz.

### As 14 tools

**Leitura**

| Tool | Devolve | Reusa |
|---|---|---|
| `whats_stuck` | Fila do copiloto por prioridade, cada item com seu `question_key` | `detectQuestions()` + `buildCompanyQueue()` |
| `company_situation` | Estágio, dias sem evento do cliente, dias no estágio, timeline recente, next steps pendentes, sinais capturados, champion, comprador econômico, hipótese de dor, pessoas vinculadas | `fetchPipelineSnapshot()` + `stages.ts` |
| `pipeline_overview` | Estágios, contagem por estágio e métricas | `computePipelineMetrics()` |
| `agenda` | Next steps por janela: vencidos, hoje, próximos 7 dias | `company_next_steps` |
| `search` | Pessoas e empresas por nome | mesma forma do `/api/integration/search` |

**Escrita**

| Tool | Efeito | Guarda |
|---|---|---|
| `log_activity` | Grava `company_activities` | `client_engaged: boolean` obrigatório; só ele sobe `last_client_event_at` |
| `set_next_step` | Cria ou atualiza next step | Auto-cria activity, como no app |
| `complete_next_step` | Marca concluído | Não sobe `last_client_event_at` |
| `move_stage` | Move a empresa de estágio | Passa por `applyStageMove()`; `inferDirection()` grava o `company_stage_events` |
| `capture_signal` | Grava `company_commitment_signals` | `signal_type` restrito ao enum de 6 valores |
| `set_company_context` | Champion, comprador econômico, hipótese de dor | Campos de `companies` |
| `answer_copilot_question` | Grava `copilot_question_events` | Exige `question_key` vindo de `whats_stuck` |
| `find_or_create_company` | Devolve empresa existente ou cria | Dedup case-insensitive por nome |
| `find_or_create_person` | Devolve pessoa existente ou cria | Dedup por `first_name + last_name + current_title + current_company`, igual ao import |

`whats_stuck` e `answer_copilot_question` são um par: a primeira devolve o
`question_key` determinístico (`rule_id:company_id[:entity_id]`), a segunda o
consome. Sem isso o modelo teria que reconstruir a chave, e reconstruir errado
significa suprimir a pergunta errada.

`answer_copilot_question` **não aplica** o efeito — grava a supressão. Quem
aplica é a tool específica (`log_activity`, `move_stage`, …). Separar as duas
coisas evita que uma resposta ambígua vire escrita silenciosa, e mantém o
`suppress_until` como o único mecanismo de dedup, como já é hoje.

### Invariantes de escrita

Cinco garantias, todas no servidor. Nenhuma delegada ao modelo.

1. **RLS herdada.** O JWT carrega `sub = user_id`; `current_workspace()`
   escopa toda query.
2. **`last_client_event_at` só sobe com `client_engaged: true`.** Parâmetro
   obrigatório, sem default. "Cobrei, aguardando", "concluído" e "reunião não
   aconteceu" passam `false`. A invariante do módulo 11.3 vira assinatura de
   tipo em vez de convenção.
3. **Nenhuma tool apaga.** Não existe `delete_*`. Correção é registro novo ou
   update.
4. **Idempotência.** `log_activity` recusa duplicata exata — mesma empresa,
   tipo, data e título — nas últimas 24h, e devolve a linha original. Repetir a
   chamada não gera duas reuniões.
5. **`find_or_create` antes de criar.** Nenhuma tool cria empresa ou pessoa sem
   passar pela normalização que o wizard de import já usa.

Mais `rateLimit()` por token, no padrão de `/api/integration/*`.

## Fatia 2 — OAuth 2.1

O CRMFlash não vira provedor de identidade. O Supabase Auth continua sendo o
login; o app apenas emite **tokens de acesso ao MCP** em cima de uma sessão que
já existe.

### Endpoints

| Rota | Papel |
|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 — aponta o autorizador a partir do recurso `/api/mcp` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 — metadata do autorizador |
| `POST /api/oauth/register` | RFC 7591 — registro dinâmico, para o claude.ai se cadastrar sozinho |
| `GET /api/oauth/authorize` | Sem sessão → redireciona para `/login?next=…`. Com sessão → tela de consentimento |
| `POST /api/oauth/token` | `authorization_code` + PKCE, e `refresh_token` |
| `POST /api/oauth/revoke` | RFC 7009 |

PKCE `S256` obrigatório (é OAuth 2.1, não opcional). Access token opaco com 1h
de validade; refresh rotativo.

### Tabelas

Três, na migração `015_mcp_oauth.sql`:

- `mcp_oauth_clients` — clientes registrados (`client_id`, `redirect_uris`,
  `client_name`)
- `mcp_oauth_codes` — codes de uso único, com `code_challenge` e expiração curta
- `mcp_oauth_tokens` — access e refresh hasheados, com `user_id`,
  `workspace_id`, `client_id`, `expires_at`, `revoked_at`

Tokens são guardados **hasheados**. Vazamento da tabela não vira acesso.

### Consentimento e revogação

A tela de `/api/oauth/authorize` diz, em texto claro, que o cliente vai poder
ler o pipeline e registrar atividades, próximos passos e movimentos de estágio —
e que não vai poder apagar nada.

Em `/settings`, uma seção lista as conexões ativas (cliente, data, último uso)
com botão de revogar. Sem isso, um token vazado é permanente — e é a única parte
do desenho que não tem como ser consertada depois do incidente.

## Testes

- **Unit por tool**, com `vitest` e fixtures — forma da saída e respeito às
  invariantes, com atenção ao `client_engaged` e ao dedup de `log_activity`.
- **`scripts/verify-mcp-rls.mjs`**, no espírito de `verify-workspace-rls.mjs`:
  dois workspaces, token de A, afirmar que nenhuma das 14 tools lê ou escreve em
  B. Roda contra o banco real, como o verificador atual.
- **Conformidade OAuth**: `authorize → token → refresh → revoke` ponta a ponta,
  mais os caminhos negativos — PKCE inválido, code reusado, token revogado,
  `redirect_uri` divergente.

## Riscos aceitos

- **Todo membro do workspace pode tudo.** O MCP herda o modelo de papéis do app,
  que é plano por decisão anterior. Não introduz nem resolve isso.
- **O modelo pode escrever coisa errada.** Mitigado por: nada é apagável, tudo
  tem autoria (`user_id`), e a timeline mostra quem registrou. Um erro é
  visível e corrigível no app.
- **`SUPABASE_JWT_SECRET` em env var na Vercel.** É o segredo que assina toda
  sessão do app. Não é um risco novo — a service role key já está lá e tem poder
  equivalente — mas amplia a superfície em um item.
- **Sem SSE.** Tools longas ficam limitadas ao `maxDuration = 60`. Nenhuma das
  14 faz chamada externa, então não deve morder; se uma vier a fazer
  (enrichment via MCP, por exemplo), o desenho precisa ser revisitado.

## Fora de escopo

- Interpretação de texto livre no servidor (`/api/copilot/interpret` espelhado).
- Enriquecimento por IA disparado pelo MCP.
- Upload e leitura de documentos de empresa.
- Import de CSV/XLSX pelo chat.
- Múltiplos workspaces por token.

## Insumos pendentes

Nenhum. O desenho original dependia de um `SUPABASE_JWT_SECRET` que não existe
mais como chave ativa; cunhar a sessão usa a service role key, que já está
configurada.
