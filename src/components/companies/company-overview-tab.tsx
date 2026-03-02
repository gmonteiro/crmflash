"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Globe, Linkedin, Users, ExternalLink } from "lucide-react"
import Link from "next/link"
import type { Company, Person } from "@/types/database"
import { safeHref } from "@/lib/utils"

interface CompanyOverviewTabProps {
  company: Company
  people: Person[]
}

export function CompanyOverviewTab({ company, people }: CompanyOverviewTabProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {company.description && (
          <p className="text-sm">{company.description}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {safeHref(company.website) && (
            <a
              href={safeHref(company.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Globe className="h-4 w-4" />
              {company.domain || company.website}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {safeHref(company.linkedin_url) && (
            <a
              href={safeHref(company.linkedin_url)}
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
      </div>

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
