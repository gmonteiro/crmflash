# Triagem por cursor na aba Shortlists

Data: 2026-09-10
Estado: aprovado

## Problema

Fazer shortlist hoje é percorrer o `/people` de cima para baixo, marcando o
checkbox de quem interessa. O checkbox adiciona a pessoa à shortlist mais
antiga ("First", 245 membros). O problema é o que fica para trás: quem já foi
triado e não entrou continua na tela, misturado com quem ainda não foi visto.
Com 7.452 pessoas em páginas de 25, cada sessão começa achando de novo o ponto
onde a anterior parou.

Dois donos trabalham a mesma base. As marcações de um não podem mexer no
ponto de parada do outro.

## O que os dados dizem

Medido no banco em 2026-09-10 (script descartável, só leitura):

- A ordem visível do `/people` é `created_at desc, id asc`. Existem só 26
  valores distintos de `created_at` porque cada import grava o mesmo timestamp
  no lote inteiro. Dentro de um lote a ordem é pelo id: arbitrária, mas
  estável.
- Lotes na ordem da tela: 26/08 (3.174 pessoas, import do Rafael) em cima; dois
  avulsos; fev/mar (4.276 pessoas, import do Guilherme) embaixo. 700 pessoas do
  lote de março também têm o Rafael como dono, herança do dedup do import.
- As marcações confirmam a direção. As do Rafael avançam da linha 1 até a 2.142
  em ordem crescente. As do Guilherme avançam dentro do lote dele no mesmo
  sentido.
- `shortlist_members` não guarda quem marcou. Atribuir pelo dono do contato
  falha nas 700 pessoas em comum: todas foram marcadas pelo Guilherme em
  março, antes do Rafael existir no workspace, e contariam para o Rafael.
- A marcação mais adiantada do Guilherme (Matheus Sepulveda, 20/04) é avulsa,
  do dia em que a shortlist CFO foi criada, 265 linhas depois de onde a
  triagem corrida parou (Fátima Leal, 13/03).

## Decisões

| Pergunta | Decisão |
|---|---|
| Direção da triagem | De cima para baixo na ordem que a tela já usa. Quem some é quem está acima da última marcação, ela inclusive. |
| Ordem da fila | Congelada em `created_at desc, id asc`. Sem ordenar por coluna na fila. |
| Quem aparece na fila | Só os contatos de que o usuário logado é dono (`people_owners`). |
| O que define o corte | Um cursor por usuário, guardado à parte. Só marcações feitas de dentro da fila avançam o cursor. |
| Marcações fora da fila | `/people`, diálogo "Add to Shortlist" e MCP continuam entrando na shortlist e não tocam no cursor. |
| Onde a marcação entra | Na shortlist mais antiga do workspace, igual ao `/people` hoje. |
| Ponto de partida | Guilherme: Fátima Leal (linha 2.426 da fila dele, restam 1.852). Rafael: Ricardo Paiva (linha 2.142, restam 1.732). |
| Onde fica | No topo da aba Shortlists do `/people`, cartões das shortlists abaixo. |

Fora de escopo: busca e filtros na fila, voltar o cursor pela tela, fila de
empresas, gravar quem marcou cada membro.

## Dados

Migração `017_screening_cursors.sql`:

```sql
create table screening_cursors (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  entity_type     text not null check (entity_type in ('person', 'company')),
  cut_created_at  timestamptz not null,
  cut_id          uuid not null,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, user_id, entity_type)
);
```

`cut_created_at` e `cut_id` são a chave de ordenação do último contato triado.
Sem chave estrangeira para `people` de propósito: se o contato for apagado, o
corte continua no mesmo lugar da fila.

`entity_type` entra agora, mesmo com a fila só de pessoas, porque a PK sem ele
teria que ser refeita quando empresas entrarem, e o custo hoje é uma coluna.

RLS: workspace pelo `current_workspace()` e `user_id = auth.uid()`, em todas as
operações. Cada um lê e escreve só o próprio cursor.

Seed na mesma migração, por email via `auth.users`, com `on conflict do
nothing`: a chave (`created_at`, `id`) de Fátima Leal para gq.monteiro@gmail.com
e de Ricardo Paiva para rafael@lumeis.ai. Os ids das duas pessoas ficam
literais na migração; o plano os copia do banco.

## Consulta

Hook `useScreeningQueue()` em `src/hooks/use-screening-queue.ts`.

1. Lê o cursor do usuário (`screening_cursors`, `entity_type = 'person'`).
2. Busca `people` com `people_owners!inner(user_id)` igual ao usuário logado,
   `count: "exact"`, ordem `created_at desc, id asc`, `range` de 25.
3. Se há cursor, aplica "depois do corte":
   `created_at < cut_created_at OR (created_at = cut_created_at AND id > cut_id)`.
   Em PostgREST: `.or("created_at.lt.X,and(created_at.eq.X,id.gt.Y)")`.
4. Sem cursor, a fila começa do topo.

Devolve `people`, `totalCount`, `page`, `totalPages`, `goToPage`, `loading`,
`cursorName` (nome de quem está no corte, buscado à parte; `null` se apagado ou
sem cursor), `mark(ids)` e `refetch`.

A função pura `farthest(people)` recebe as pessoas marcadas e devolve a mais
adiantada na ordem congelada: menor `created_at`; em empate, maior `id`.

## Marcar

`mark(ids)`:

1. Adiciona os ids à shortlist mais antiga com o `addMembers` de
   `useShortlists`. Se falhar, mostra o erro e para. O cursor não move.
2. Faz `upsert` em `screening_cursors` com a chave de `farthest(...)`.
3. Recarrega a fila da página 0 e as etiquetas de shortlist.

Quem foi marcado desaparece junto com quem estava acima. A tabela encolhe.

## Tela

`ScreeningQueue` em `src/components/people/screening-queue.tsx`, renderizado
dentro de `ShortlistsTab` quando `entityType === "person"`, acima dos cartões.

- Linha de contexto: "1.852 para triar. Você parou em Fátima Leal." Sem
  cursor: "1.852 para triar. Começando do topo."
- Abaixo, `PeopleTable` com os mesmos props do `/people`, mais `sortable={false}`,
  prop nova que faz `getPeopleColumns` renderizar os cabeçalhos como texto.
  Edição inline, apagar, etiquetas de shortlist e dono continuam.
- O checkbox chama `mark`. Não há botão "Add to Shortlist" na fila.
- Fila vazia: "Triagem concluída. Você parou em X." no lugar da tabela.

`ShortlistsTab` deixa de ser o único conteúdo da aba; para empresas fica como
está.

## Erros

| Situação | Comportamento |
|---|---|
| `addMembers` falha | Toast de erro, cursor parado, seleção mantida. |
| `upsert` do cursor falha | Toast avisando que a marcação entrou mas o corte não avançou. Refetch. |
| Contato do corte apagado | Corte fica; `cursorName` vira "contato apagado". |
| Sem shortlist no workspace | Fila aparece; checkbox mostra toast pedindo para criar uma shortlist primeiro. |

## Testes

Vitest, em `src/hooks/use-screening-queue.test.ts`:

- `farthest`: escolhe menor `created_at`; em empate, maior `id`; um só elemento
  devolve ele.
- `afterCutFilter`: monta a string do `.or(...)` a partir da chave do corte.

Conferência manual no navegador, com a migração aplicada: a fila do Guilherme
abre em 1.852 nomes com "parou em Fátima Leal"; marcar alguém na página 1 faz a
fila encolher até ele. A do Rafael abre em 1.732.
