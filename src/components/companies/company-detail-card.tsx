"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { Company, Person } from "@/types/database"
import { CompanyDetailHeader } from "./company-detail-header"
import { CompanyOverviewTab } from "./company-overview-tab"
import { CompanyTimelineTab } from "./company-timeline-tab"
import { CompanyDocumentsTab } from "./company-documents-tab"
import { CompanyNextStepsTab } from "./company-next-steps-tab"
import { ActivityTimeline } from "@/components/shared/activity-timeline"

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
          <CompanyDetailHeader company={company} onEnriched={load} />
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <Tabs defaultValue="overview">
            <TabsList variant="line">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="next-steps">Next Steps</TabsTrigger>
              <TabsTrigger value="activities">Activities</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <CompanyOverviewTab company={company} people={people} />
            </TabsContent>
            <TabsContent value="timeline" className="mt-4">
              <CompanyTimelineTab companyId={companyId} />
            </TabsContent>
            <TabsContent value="documents" className="mt-4">
              <CompanyDocumentsTab companyId={companyId} />
            </TabsContent>
            <TabsContent value="next-steps" className="mt-4">
              <CompanyNextStepsTab companyId={companyId} />
            </TabsContent>
            <TabsContent value="activities" className="mt-4">
              <ActivityTimeline companyId={companyId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
