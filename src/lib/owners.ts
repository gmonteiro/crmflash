/**
 * Login de exibição: o e-mail antes do @.
 *
 * Mesmo formato que a timeline e os próximos passos já usam para autoria — se
 * um dia isso virar "nome do perfil", muda aqui e nos dois `authorLabel`.
 */
export function loginFromEmail(email: string): string {
  return email.split("@")[0]
}

/**
 * user_ids → logins, ordenados e sem os que não são do workspace.
 *
 * Ordem alfabética de propósito: a lista vem do banco em ordem de inserção, e
 * a coluna piscando entre "joao, maria" e "maria, joao" a cada refetch é ruído
 * que parece mudança de dado.
 */
export function ownerLabels(
  userIds: string[] | undefined,
  emails: Record<string, string>
): string[] {
  if (!userIds || userIds.length === 0) return []
  return userIds
    .map((id) => emails[id])
    .filter((email): email is string => !!email)
    .map(loginFromEmail)
    .sort((a, b) => a.localeCompare(b))
}
