"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Building2, Kanban, Upload } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { CopilotPanel } from "@/components/copilot/copilot-panel"
import { CompanySearch } from "@/components/dashboard/company-search"
import Link from "next/link"

interface Stats {
  totalPeople: number
  totalCompanies: number
  totalImports: number
  kanbanStats: { title: string; color: string; count: number }[]
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    const supabase = createClient()

    const [peopleRes, companiesRes, importsRes, columnsRes, boardRes] = await Promise.all([
      supabase.from("people").select("id", { count: "exact", head: true }),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      supabase.from("import_history").select("id", { count: "exact", head: true }),
      supabase.from("kanban_columns").select("id, title, color").order("position"),
      // O board é de EMPRESAS desde a refatoração do kanban. Uma query só —
      // antes era um count por coluna (N+1) e contava pessoas.
      supabase
        .from("companies")
        .select("kanban_column_id")
        .not("kanban_column_id", "is", null)
        .limit(5000),
    ])

    const perColumn = new Map<string, number>()
    for (const row of (boardRes.data ?? []) as { kanban_column_id: string }[]) {
      perColumn.set(row.kanban_column_id, (perColumn.get(row.kanban_column_id) ?? 0) + 1)
    }

    const kanbanStats = ((columnsRes.data ?? []) as { id: string; title: string; color: string }[])
      .map((col) => ({
        title: col.title,
        color: col.color,
        count: perColumn.get(col.id) ?? 0,
      }))

    setStats({
      totalPeople: peopleRes.count ?? 0,
      totalCompanies: companiesRes.count ?? 0,
      totalImports: importsRes.count ?? 0,
      kanbanStats,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {/* Porta de entrada para uma conta específica: você já sabe o nome e
            quer a situação dela sem passar por /companies. */}
        <div className="w-full sm:max-w-sm">
          <CompanySearch />
        </div>
      </div>

      {/* O copiloto vem primeiro: é o que você alimenta todo dia. */}
      <CopilotPanel onApplied={loadStats} />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/people">
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalPeople}</div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/companies">
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Companies</CardTitle>
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalCompanies}</div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/import">
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Imports</CardTitle>
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalImports}</div>
                </CardContent>
              </Card>
            </Link>
          </div>

          {stats && stats.kanbanStats.length > 0 && (
            <div>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Kanban className="h-5 w-5" />
                Pipeline Overview
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {stats.kanbanStats.map((col) => (
                  <Link key={col.title} href="/kanban">
                    <Card className="transition-colors hover:bg-muted/50">
                      <CardContent className="pt-4">
                        <div className="mb-1 flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: col.color }}
                          />
                          <span className="text-sm font-medium">{col.title}</span>
                        </div>
                        <div className="text-2xl font-bold">{col.count}</div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
