-- 017_screening_cursors.sql
-- Cursor de triagem: onde cada pessoa parou ao percorrer a própria fila de
-- contatos de cima para baixo marcando shortlist.
-- Ver docs/superpowers/specs/2026-09-10-triagem-por-cursor-design.md
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.

begin;

-- cut_created_at + cut_id é a chave de ordenação do último contato triado
-- (a fila é created_at desc, id asc). Sem FK para people de propósito: se o
-- contato for apagado, o corte continua no mesmo lugar da fila.
--
-- entity_type entra já, mesmo com a fila só de pessoas: a PK sem ele teria
-- que ser refeita quando empresas entrarem, e o custo hoje é uma coluna.
create table screening_cursors (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  entity_type     text not null check (entity_type in ('person', 'company')),
  cut_created_at  timestamptz not null,
  cut_id          uuid not null,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, user_id, entity_type)
);

comment on table screening_cursors is
  'Onde cada usuário parou na fila de triagem. Só marcações feitas de dentro da fila movem isto.';

create trigger screening_cursors_updated_at
  before update on screening_cursors
  for each row execute function handle_updated_at();

alter table screening_cursors enable row level security;

-- Cada um lê e escreve só o próprio cursor, dentro do próprio workspace.
create policy screening_cursors_own on screening_cursors for all
  using (workspace_id = current_workspace() and user_id = auth.uid())
  with check (workspace_id = current_workspace() and user_id = auth.uid());

-- Ponto de partida, medido nas marcações existentes em 2026-09-10:
--   Guilherme parou em Fátima Leal (última da triagem corrida de 13/03).
--   Rafael parou em Ricardo Paiva (26/08).
-- A chave sai da própria linha da pessoa, não de literal, para não divergir.
insert into screening_cursors (workspace_id, user_id, entity_type, cut_created_at, cut_id)
select p.workspace_id, u.id, 'person', p.created_at, p.id
  from people p
  join auth.users u on u.email = 'gq.monteiro@gmail.com'
 where p.id = '3318959c-7956-4b44-8cb7-6029ce8dc73d'
on conflict do nothing;

insert into screening_cursors (workspace_id, user_id, entity_type, cut_created_at, cut_id)
select p.workspace_id, u.id, 'person', p.created_at, p.id
  from people p
  join auth.users u on u.email = 'rafael@lumeis.ai'
 where p.id = 'eb3bbb54-8336-4dce-ba89-9b59d194de8f'
on conflict do nothing;

commit;
