"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMemberEmails } from "@/hooks/use-workspace-members"
import { loginFromEmail } from "@/lib/owners"

interface OwnerFilterProps {
  /** user_id do dono, ou "all". */
  value: string
  onChange: (value: string) => void
}

/**
 * Filtro por dono das listagens.
 *
 * Some quando o workspace tem uma pessoa só — um filtro com uma opção não
 * separa nada. É diferente da coluna Dono, que aparece sempre: a coluna
 * responde "de quem é este contato?", que continua sendo pergunta legítima
 * mesmo com um dono só.
 */
export function OwnerFilter({ value, onChange }: OwnerFilterProps) {
  const emails = useMemberEmails()

  const members = Object.entries(emails)
    .map(([userId, email]) => ({ userId, login: loginFromEmail(email) }))
    .sort((a, b) => a.login.localeCompare(b.login))

  if (members.length < 2) return null

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[150px]">
        <SelectValue placeholder="Dono" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os donos</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.login}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
