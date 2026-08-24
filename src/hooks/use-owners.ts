"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

/**
 * Donos das linhas visíveis: id → user_ids.
 *
 * Busca só os ids da página (25) em vez do vínculo inteiro: são 4.278 pessoas
 * e 3.058 empresas no workspace, e carregar tudo para rotular 25 linhas seria
 * pagar o índice inteiro a cada troca de página.
 *
 * A dependência é a chave concatenada, não o array: `ids` é recriado a cada
 * render do pai, e o array cru nas deps do efeito faz refetch infinito.
 */
function useOwners(
  relation: "people_owners" | "company_owners",
  column: "person_id" | "company_id",
  ids: string[]
): Record<string, string[]> {
  const [owners, setOwners] = useState<Record<string, string[]>>({})
  const key = ids.join(",")

  useEffect(() => {
    const list = key ? key.split(",") : []
    if (list.length === 0) {
      setOwners({})
      return
    }

    let cancelled = false

    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from(relation)
        .select(`${column}, user_id`)
        .in(column, list)

      // Trocar de página rápido dispara duas buscas; sem isto a mais lenta
      // pode chegar por último e pintar a coluna com os donos da página velha.
      if (cancelled || !data) return

      const byId: Record<string, string[]> = {}
      for (const row of data as Record<string, string>[]) {
        const id = row[column]
        ;(byId[id] ??= []).push(row.user_id)
      }
      setOwners(byId)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [relation, column, key])

  return owners
}

export function usePeopleOwners(personIds: string[]) {
  return useOwners("people_owners", "person_id", personIds)
}

/** Vem da view company_owners: donos dos contatos da empresa + quem a criou. */
export function useCompanyOwners(companyIds: string[]) {
  return useOwners("company_owners", "company_id", companyIds)
}
