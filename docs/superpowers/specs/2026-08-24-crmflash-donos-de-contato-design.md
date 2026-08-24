# Donos de contato

Data: 2026-08-24
Estado: aprovado

## Problema

Depois da 010 o CRM é de um workspace, não de uma pessoa. Todo mundo vê tudo —
que é o que o time queria — mas se perdeu a resposta para "de quem é este
contato?". A coluna `user_id` sobrou como *autoria* ("quem criou esta linha"), e
a própria 010 deixou isso escrito no `comment on column`: não é escopo de
acesso, e também não é dono.

Isso dói em dois lugares:

1. **No import.** Quem sobe uma planilha some. Duas semanas depois ninguém sabe
   qual lista veio de quem.
2. **Nas listagens.** `/people` e `/companies` mostram 4.278 pessoas e 3.058
   empresas sem nenhuma pista de quem trabalha cada uma.

E há um caso que a autoria não consegue representar: o contato em comum. O
dedup do import pula quem já existe, então quando a Maria sobe uma lista que
tem alguém que o João já subiu, a linha continua sendo só do João. A informação
"os dois têm esse contato" hoje não é gravada em lugar nenhum — não é uma
coluna que falta, é uma cardinalidade que falta.

## Decisões

| Pergunta | Decisão |
|---|---|
| Quem é o dono no import? | Sempre quem está logado. Sem escolher outro membro, sem coluna de dono na planilha. |
| Contato que o dedup pula | Vira co-dono. A linha continua única e ganha um segundo dono. |
| Dono de empresa | Derivado: donos dos contatos daquela empresa + quem criou a empresa. |
| Coluna Dono | Só leitura nesta rodada. |

Fora de escopo: editar dono na célula, dono nas telas de detalhe de
pessoa/empresa.

**Adendo (mesmo dia): filtrar por dono entrou no escopo.** Ver a seção Filtros.

## Desenho

### `people_owners` — a tabela que falta

```sql
create table people_owners (
  person_id  uuid not null references people(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, user_id)
);
```

Sem `workspace_id`: a tabela é escopada pelo pai, como `people_tags` e
`shortlist_members` já são. A PK composta é o que torna "cada pessoa é dona no
máximo uma vez" invariante de banco em vez de regra que o import precisa
lembrar.

`on delete cascade` no `user_id` — e não o `set null` que a 010 usou em
`people.user_id`. São coisas diferentes: autoria é histórico e sobrevive à conta
apagada; propriedade é um vínculo vivo e morre com ela. Um contato pode ficar
sem dono; não pode ter um dono que não existe.

Backfill: `insert into people_owners select id, user_id from people where
user_id is not null` — quem criou passa a ser dono do que criou.

RLS igual à das duas filhas que já existem:

```sql
create policy people_owners_ws_all on people_owners for all
  using (exists (select 1 from people p
                 where p.id = people_owners.person_id
                   and p.workspace_id = current_workspace()))
  with check (...mesma expressão...);
```

### `company_owners` — view, não tabela

```sql
create view company_owners as
  select p.company_id as company_id, po.user_id
    from people p join people_owners po on po.person_id = p.id
   where p.company_id is not null
  union
  select c.id, c.user_id from companies c where c.user_id is not null;
```

Uma tabela de donos de empresa precisaria ser mantida em sincronia toda vez que
um contato troca de empresa, ganha dono, ou é apagado. A view não pode sair de
sincronia porque não guarda nada. Com 3.058 empresas e leitura de 25 por
página, o custo não justifica materializar.

`security_invoker = on`: a view é avaliada com os privilégios de quem consulta,
então a RLS de `people` e `companies` continua valendo. Sem isso ela rodaria
como dona e viraria um furo que devolve os donos de qualquer workspace.

`union` (não `union all`): o mesmo usuário aparece pelos dois lados quando
criou a empresa e também tem contato nela.

### Trigger, não chamadas espalhadas

```sql
create trigger people_owners_seed after insert on people
  for each row execute function seed_person_owner();
```

Contato nasce em cinco lugares: import, formulário de pessoa, copilot,
`/api/integration/activities` e `/api/integration/search`. Escrever o dono em
cada um é cinco lugares para esquecer — e o próximo lugar já nasce errado. O
trigger transforma "todo contato criado tem o autor como dono" em propriedade
do schema.

`security definer` no trigger: as rotas de integração escrevem com service role
(que ignora RLS) mas o formulário escreve como usuário, e um `insert` de dentro
do trigger passaria pela policy de `people_owners`. Falhar ali derrubaria a
criação do contato inteiro. Não abre nada: a função só insere `(new.id,
new.user_id)`, valores que a linha já carrega.

### Import: o único ponto que muda

O dedup hoje monta um `Set` de chaves a partir de um `select first_name,
last_name, current_title, current_company` — descarta o `id`, porque só
precisava responder sim/não. Passa a montar um `Map` chave → `id`, e para cada
linha pulada insere `(person_id, usuário logado)` em `people_owners` com
`ignoreDuplicates` (subir a mesma planilha duas vezes não pode dar erro).

Os contatos novos não precisam de nada: o trigger cuida.

As empresas criadas no import já gravam `user_id` — é o segundo braço da view.

A tela de mapeamento ganha uma linha "Importando como **`login`**", para o dono
gravado ficar visível antes do botão, não descoberto depois na listagem.

### Colunas

`Dono` em `/people` (depois de Company) e em `/companies` (depois de Website).
Renderiza login — `email` antes do `@` — no mesmo formato que a timeline e os
próximos passos já usam. Um dono: `joao`. Dois: `joao, maria`.

Os donos vêm em uma query por página, com os 25 ids visíveis, no padrão que
`shortlistsByPerson` já estabeleceu na tabela de people. Nada de N+1, nada de
carregar 4.278 vínculos para mostrar 25.

**Divergência declarada:** a timeline esconde o autor quando o workspace tem uma
pessoa só (ali "quem fez" é sempre "eu", e vira ruído). A coluna Dono aparece
sempre. Coluna de tabela que some sozinha confunde mais do que o ruído que
evita, e a coluna foi pedida explicitamente.

## Filtros

Um `<Select>` de dono nas duas listagens, ao lado dos filtros que já existem.
Some quando o workspace tem uma pessoa só — filtro de uma opção não separa
nada. Isso diverge da coluna, que aparece sempre, e a divergência é
intencional: a coluna responde "de quem é?", que continua valendo com um dono
só; o filtro responde "mostre só os de fulano", que com uma pessoa é a lista
inteira.

**People sai de graça.** Existe FK `people_owners.person_id → people.id`, então
o PostgREST infere a relação e o filtro é um embed:

```
people?select=*,company:companies(*),people_owners!inner(user_id)
      &people_owners.user_id=eq.<uuid>
```

`!inner` descarta quem não tem o vínculo. A PK `(person_id, user_id)` garante
que ninguém casa duas vezes, então a contagem continua exata e a paginação não
repete linha.

**Companies precisou de migration.** `company_owners` é view com `union`: não
tem FK, e o embed volta `PGRST200 no matches were found` — confirmado contra o
banco. As saídas:

1. `companies?select=*,people!inner(people_owners!inner(user_id))` — funciona
   sem migration, mas responde "empresas com contato meu". Medido no banco:
   3.044 de 3.059. As 15 que faltam são empresas sem contato nenhum, onde o
   dono é só quem criou — a coluna mostraria o nome e o filtro esconderia a
   linha.
2. Buscar os ids na view e mandar `id=in.(...)` — até 3.058 UUIDs numa URL.
3. **Relação computada** (migration 014): `owners(companies)`, uma função que
   recebe a linha e devolve as linhas de `company_owners` dela. O PostgREST
   reconhece a assinatura e aceita `select=*,owners!inner(user_id)`.

Escolhida a 3: é a única em que filtro e coluna respondem a mesma pergunta.
`stable` e sem `security definer`, senão o `security_invoker` da view seria
contornado e o filtro devolveria empresa de outro workspace.

## Verificação

`scripts/verify-contact-owners.mjs`, no molde do `verify-workspace-rls.mjs`:
cria um insider e um outsider descartáveis e afirma que

- o trigger grava o dono ao criar um contato;
- inserir o mesmo par duas vezes não estoura;
- `people_owners` e `company_owners` não vazam para quem está fora do
  workspace;
- a view devolve os dois nomes quando dois usuários são donos do mesmo contato;
- a view devolve o criador da empresa mesmo sem contato nela.

A migration roda à mão no SQL Editor do Supabase, como as 010–012.

## Riscos

**A view fica lenta se `people.company_id` não tiver índice.** Tem
(`idx_people_company_id`, da 001).

**Contato sem dono.** Acontece se `people.user_id` for nulo na criação (rota de
integração sem `INTEGRATION_USER_ID`) ou se a conta do dono for apagada. A
coluna mostra vazio. É honesto — inventar um dono seria pior.

**Import grande.** Um arquivo com 5.000 linhas já existentes vira um upsert de
5.000 vínculos. Vai em lotes de 500, como os inserts de pessoas e empresas.
