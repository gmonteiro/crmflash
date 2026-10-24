import type { WaDirectory } from "../../../src/lib/whatsapp/contract"
import { companyNameKey, normalizePersonName } from "../../../src/lib/identity/normalize"

// O diretório que o CRM manda, em forma de busca. As chaves de nome vêm da
// MESMA normalização do CRM (import direto de normalize.ts): "João  SILVA" no
// celular e "Joao Silva" no CRM dão a mesma chave dos dois lados.

export interface DirectoryIndex {
  personByPhone: Map<string, { personId: string | null; ignored: boolean }>
  peopleByName: Map<string, { id: string; companyId: string | null }[]>
  companies: { id: string; nameKey: string }[]
  groupById: Map<string, { companyId: string | null; ignored: boolean }>
  companyByPersonId: Map<string, string | null>
}

export const nameKey = (raw: string): string | null => normalizePersonName(raw)
export const groupKey = (raw: string): string => companyNameKey(raw) ?? ""

export function indexDirectory(d: WaDirectory): DirectoryIndex {
  const personByPhone = new Map<string, { personId: string | null; ignored: boolean }>()
  for (const p of d.phones) for (const dig of p.digits) personByPhone.set(dig, { personId: p.personId, ignored: p.ignored })
  const peopleByName = new Map<string, { id: string; companyId: string | null }[]>()
  const companyByPersonId = new Map<string, string | null>()
  for (const p of d.people) {
    const list = peopleByName.get(p.nameKey) ?? []
    list.push({ id: p.id, companyId: p.companyId })
    peopleByName.set(p.nameKey, list)
    companyByPersonId.set(p.id, p.companyId)
  }
  const groupById = new Map(d.groups.map((g) => [g.groupId, { companyId: g.companyId, ignored: g.ignored }]))
  return { personByPhone, peopleByName, companies: d.companies, groupById, companyByPersonId }
}
