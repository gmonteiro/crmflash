-- 015_people_dedup_key.sql
-- Torna o dedup do import uma decisao do banco em vez de uma aposta do cliente.
--
-- POR QUE ISTO PRECISA EXISTIR
-- O idx_people_dedup da 010 e um indice de EXPRESSAO:
--   (workspace_id, lower(trim(first_name)), ..., lower(trim(coalesce(...))))
-- Indice de expressao o PostgREST nao sabe enderecar: `onConflict` so aceita
-- lista de colunas. Sem onConflict o import so tem `.insert()` puro, e insert
-- multi-row no Postgres e UMA statement — uma linha que colide aborta as
-- outras 499 do lote junto. Foi o que aconteceu na importacao de 3.871
-- contatos do LinkedIn: 8 lotes, 8 colisoes, 3.738 contatos perdidos e um
-- "duplicate key value violates unique constraint" solitario no console.
--
-- A coluna gerada resolve materializando a expressao. O indice passa a ser
-- (workspace_id, dedup_key) — duas colunas reais, enderecaveis por onConflict,
-- e o import vira upsert com ignoreDuplicates: colisao vira linha pulada em
-- silencio, que e o comportamento que o usuario ja espera dos duplicados.
--
-- A chave e a MESMA da 010, caractere por caractere. Isto nao afrouxa nem
-- aperta o dedup: so muda onde a expressao mora. first_name e last_name sao
-- NOT NULL desde a 001, entao a concatenacao nunca vira NULL e o indice cobre
-- todas as linhas — sem o buraco de "NULL nao colide" que apareceria se
-- alguma das quatro pudesse faltar.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.

begin;

-- ---------------------------------------------------------------------------
-- 1. dedup_key
--
-- stored, nao virtual: o indice precisa dela materializada. Custa ~40 bytes
-- por linha nas 4.278 pessoas atuais, o que e menos do que o indice de
-- expressao que ela substitui ja custava.
-- ---------------------------------------------------------------------------
alter table people
  add column if not exists dedup_key text
  generated always as (
    lower(trim(first_name)) || '|' ||
    lower(trim(last_name)) || '|' ||
    lower(trim(coalesce(current_title, ''))) || '|' ||
    lower(trim(coalesce(current_company, '')))
  ) stored;

comment on column people.dedup_key is
  'Chave de dedup do import, materializada para o PostgREST poder usar onConflict. Mesma expressao do idx_people_dedup da 010.';

-- ---------------------------------------------------------------------------
-- 2. O indice
--
-- Se a 010 rodou, o indice antigo cobre exatamente o mesmo conjunto de linhas
-- que este — nenhuma linha existente pode violar o novo. O drop vem antes do
-- create para nao manter os dois escrevendo ao mesmo tempo.
-- ---------------------------------------------------------------------------
drop index if exists idx_people_dedup;

create unique index idx_people_dedup on people (workspace_id, dedup_key);

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- begin;
--   drop index if exists idx_people_dedup;
--   alter table people drop column if exists dedup_key;
--   create unique index idx_people_dedup on people (
--     workspace_id,
--     lower(trim(first_name)),
--     lower(trim(last_name)),
--     lower(trim(coalesce(current_title, ''))),
--     lower(trim(coalesce(current_company, '')))
--   );
-- commit;
-- ---------------------------------------------------------------------------
