# CRMFlash — MCP Fatia 4: alcance

**Data:** 2026-08-28
**Status:** design aprovado, aguardando plano de implementação

## Problema

O MCP cobre bem o eixo empresa/pipeline e ignora tudo que fica ao lado dele.

**Pessoa é cidadã de segunda classe.** Existe `company_situation`; não existe
equivalente para pessoa. O `search` devolve id, nome e cargo, e acabou — quem é
o dono do contato, de que listas ela participa, qual o e-mail, nada disso é
alcançável. Perguntar *"quem é a Mariana da Alice Wonders?"* devolve menos do
que a tela de detalhe mostra.

**As shortlists são invisíveis.** São duas listas em uso — "First" e "CFO" — com
254 pessoas dentro. Elas existem no banco, na UI e no fluxo de trabalho, e não
existem no chat.

**Os campos de empresa que o enrich preenche não têm tool.** `industry`,
`website`, `domain`, `size_tier`, `employee_count`, `estimated_revenue`,
`description` e `linkedin_url` só mudam por enriquecimento em lote ou pelo
formulário. Descobrir no meio de uma conversa que a empresa tem 300 funcionários
não tem onde ser gravado.

## Estado atual relevante

- **`shortlists`** tem `entity_type` (`person` | `company`) e `name`; as duas
  listas existentes são de pessoa.
- **`shortlist_members`** aponta para pessoa **ou** empresa, com um CHECK de
  exatamente um dos dois. O `entity_type` da lista e o campo preenchido no
  membro precisam concordar — o banco não força essa concordância, só que um
  dos dois seja nulo.
- **`people_owners`** (migration 013) é a co-propriedade do contato: chave
  composta `(person_id, user_id)`. Uma pessoa pode ter vários donos, e é isso
  que a coluna "Dono" da listagem mostra.
- **O enrich do app só preenche campo vazio** — ele age em lote e sem ninguém
  olhando, então é conservador por desenho.
- **Pessoa não tem timeline própria.** `company_activities` não tem
  `person_id`; só a tabela `activities` (do TranscriptionApp) tem. Um dossiê de
  pessoa não tem histórico de interação para mostrar.
- **15 tools hoje**, depois de três fatias.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Enriquecimento | Tool que **escreve os campos**, não que dispara o enrich | O cliente já é o Claude. Proxiar um segundo modelo interpretaria duas vezes — o mesmo argumento que cortou a tool `narrate` na Fatia 1 |
| Sobrescrever campo preenchido | **Pode** | O enrich do app é conservador porque age em lote e sozinho; aqui alguém pediu, olhando o valor |
| Renomear empresa | **Fora** | `name` é identidade e alimenta o dedup. Renomear é decisão de app |
| Tirar de shortlist | **Pode** | A invariante protege conteúdo. Vínculo de lista não tem conteúdo: readicionar restaura idêntico |
| Adicionar e remover | **Uma tool só**, com `member: boolean` | É a mesma decisão com sinal trocado; duas tools duplicariam a validação de concordância |
| Criar shortlist nova | **Fora** | Raro, o nome importa, e é decisão de organização — não de conversa |

## As cinco tools

### `person_situation(person_id)`

O espelho do `company_situation`. Devolve nome, cargo, empresa vinculada (id e
nome), e-mail, telefone, LinkedIn, categoria, notas, data do último
enriquecimento, os donos do contato e as shortlists de que ela participa.

**Não devolve timeline** — pessoa não tem uma. Quando houver interação
registrada, ela está na empresa, e é `company_situation` que mostra.

### `update_company(company_id, …)`

Campos opcionais: `industry`, `website`, `domain`, `size_tier`,
`employee_count`, `estimated_revenue`, `description`, `linkedin_url`. Pelo menos
um é obrigatório.

Devolve o que mudou **e o valor anterior de cada campo**, para a sobrescrita ser
visível em vez de silenciosa. `name` não está na lista.

Não é evento do cliente: descobrir o faturamento de alguém não é o cliente
agindo, então `last_client_event_at` não sobe.

### `list_shortlists()`

Cada lista com id, nome, `entity_type`, descrição e contagem de membros. Sem
argumento — são duas listas, e paginar duas listas seria cerimônia.

### `shortlist_members(shortlist_id)`

Quem está na lista. Para lista de pessoa, devolve id, nome, cargo e empresa;
para lista de empresa, id, nome e estágio. Teto de 500, com aviso explícito no
retorno quando cortar — as listas têm 254 membros hoje e podem crescer.

### `set_shortlist_membership(shortlist_id, entity_id, member)`

`member: true` entra, `false` sai. Idempotente nos dois sentidos: entrar duas
vezes não duplica, sair de quem não está não é erro.

**Valida a concordância que o banco não valida:** uma lista de `entity_type:
person` só aceita pessoa. O CHECK do banco garante que exatamente um dos dois
campos está preenchido, mas não que ele bate com o tipo da lista — sem essa
validação daria para pôr empresa numa lista de pessoas, e a UI não saberia
renderizar.

## Invariantes

As três anteriores seguem valendo. Uma nota sobre a primeira:

1. **Nenhuma tool apaga conteúdo.** `set_shortlist_membership(member: false)`
   remove uma linha de `shortlist_members`, mas essa linha é um par de ids sem
   conteúdo próprio — readicionar restaura idêntico. A invariante ganha a
   palavra "conteúdo", que é o que ela sempre quis dizer.
2. **`last_client_event_at` só sobe quando o cliente agiu** — nenhuma das cinco
   tools novas o toca.
3. **Suprimir exige escrever** — nenhuma das cinco participa da fila do
   copiloto, então nenhuma ganha `answers_question_key`.

## Testes

Sem banco:

- `update_company` exige pelo menos um campo, e recusa `name`
- concordância de tipo em `set_shortlist_membership` — pessoa em lista de
  empresa é recusada, e vice-versa
- schemas de `person_situation` e `shortlist_members` exigem uuid

Contra o banco, como as fatias anteriores: ler uma pessoa real, ler as duas
shortlists reais conferindo as contagens, adicionar e remover alguém de uma
lista confirmando que a remoção some e a readição restaura, e escrever um campo
de empresa conferindo que o retorno mostra o valor anterior.

## Riscos aceitos

- **Sobrescrita silenciosa de dado bom.** O Claude pode escrever um
  `employee_count` errado por cima de um certo. Mitigado por devolver o valor
  anterior — mas quem lê a resposta é o modelo, e quem decide é você. É o preço
  de permitir sobrescrita.
- **Lista de trabalho só cresce pelo app.** Sem criar shortlist, uma lista nova
  exige abrir o CRM.
- **20 tools.** Cada tool acrescentada é uma escolha a mais para o modelo errar.
  Se o `tools/list` começar a atrapalhar, o caminho é a busca de tools do
  protocolo, não cortar capacidade.

## Fora de escopo

- Criar ou renomear shortlist
- Timeline de pessoa (não existe no modelo de dados)
- Editar pessoa (cargo, e-mail) — `find_or_create_person` cria; alterar é app
- Disparar o enriquecimento por IA do app
- Documentos de empresa
