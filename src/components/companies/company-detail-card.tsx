"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Building2, Globe, Linkedin, Users, ExternalLink } from "lucide-react"
import Link from "next/link"
import type { Company, Person } from "@/types/database"
import { EnrichButton } from "@/components/shared/enrich-button"

interface CompanyDetailCardProps {
  companyId: string
}

export function CompanyDetailCard({ companyId }: CompanyDetailCardProps) {
  const [company, setCompany] = useState<Company | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [companyRes, peopleRes] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).single(),
      supabase.from("people").select("id, full_name, current_title, email").eq("company_id", companyId),
    ])
    if (companyRes.data) setCompany(companyRes.data)
    if (peopleRes.data) setPeople(peopleRes.data as Person[])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <Skeleton className="h-64 w-full" />
  }

  if (!company) {
    return <p className="text-muted-foreground">Company not found.</p>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
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
            <EnrichButton type="company" id={company.id} onEnriched={load} />
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4 space-y-3">
          {company.description && (
            <p className="text-sm">{company.description}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Globe className="h-4 w-4" />
                {company.domain || company.website}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {company.linkedin_url && (
              <a
                href={company.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Linkedin className="h-4 w-4" />
                LinkedIn Profile
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {company.employee_count && (
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                {company.employee_count.toLocaleString()} employees
              </div>
            )}
            {company.estimated_revenue && (
              <div className="text-sm">
                Revenue: ${company.estimated_revenue.toLocaleString()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            People ({people.length})
          </h3>
        </CardHeader>
        <CardContent>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No people associated with this company.</p>
          ) : (
            <div className="space-y-2">
              {people.map((person) => (
                <Link
                  key={person.id}
                  href={`/people/${person.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-muted"
                >
                  <div>
                    <p className="text-sm font-medium">{person.full_name}</p>
                    {person.current_title && (
                      <p className="text-xs text-muted-foreground">{person.current_title}</p>
                    )}
                  </div>
                  {person.email && (
                    <span className="text-xs text-muted-foreground">{person.email}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
