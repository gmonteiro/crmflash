export type ShortlistEntityType = "person" | "company"

export function memberColumn(
  entityType: ShortlistEntityType
): "person_id" | "company_id" {
  return entityType === "person" ? "person_id" : "company_id"
}

/**
 * O banco não valida isto.
 *
 * O CHECK de shortlist_members garante que exatamente um entre person_id e
 * company_id está preenchido — mas não que o preenchido bate com o entity_type
 * da lista. Dá para pôr empresa numa lista de pessoas, e a UI não sabe
 * renderizar. Esta função é a validação que falta.
 */
export function checkEntityMatches(
  entityType: ShortlistEntityType,
  exists: { person: boolean; company: boolean }
): { ok: boolean; reason?: string } {
  if (!exists.person && !exists.company) {
    return { ok: false, reason: "esse id não existe como pessoa nem como empresa" }
  }

  if (entityType === "person" && !exists.person) {
    return { ok: false, reason: "é uma lista de pessoas, e esse id é de uma empresa" }
  }

  if (entityType === "company" && !exists.company) {
    return { ok: false, reason: "é uma lista de empresas, e esse id é de uma pessoa" }
  }

  return { ok: true }
}
