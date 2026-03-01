"use client"

import { Badge } from "@/components/ui/badge"
import { Building2 } from "lucide-react"
import { EnrichButton } from "@/components/shared/enrich-button"
import type { Company } from "@/types/database"

interface CompanyDetailHeaderProps {
  company: Company
  onEnriched: () => void
}

export function CompanyDetailHeader({ company, onEnriched }: CompanyDetailHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10 text-xl font-semibold text-primary">
          <Building2 className="h-8 w-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{company.name}</h2>
          <div className="flex flex-wrap gap-2 mt-1">
            {company.industry && <Badge variant="outline">{company.industry}</Badge>}
            {company.size_tier && <Badge variant="secondary">{company.size_tier}</Badge>}
          </div>
        </div>
      </div>
      <EnrichButton type="company" id={company.id} onEnriched={onEnriched} />
    </div>
  )
}
