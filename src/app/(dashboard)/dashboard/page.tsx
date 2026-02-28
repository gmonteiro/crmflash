"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Building2, Kanban, Upload } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
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

  useEffect(() => {
    async function loadStats() {
      const supabase = createClient()

      const [peopleRes, companiesRes, importsRes, columnsRes] = await Promise.all([
        supabase.from("people").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("import_history").select("id", { count: "exact", head: true }),
        supabase.from("kanban_columns").select("id, title, color").order("position"),
      ])

      const kanbanStats: Stats["kanbanStats"] = []
      if (columnsRes.data) {
        for (const col of columnsRes.data) {
          const { count } = await supabase
            .from("people")
            .select("id", { count: "exact", head: true })
            .eq("kanban_column_id", col.id)
          kanbanStats.push({ title: col.title, color: col.color, count: count ?? 0 })
        }
      }

      setStats({
        totalPeople: peopleRes.count ?? 0,
        totalCompanies: companiesRes.count ?? 0,
        totalImports: importsRes.count ?? 0,
        kanbanStats,
      })
      setLoading(false)
    }
    loadStats()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

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
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Kanban className="h-5 w-5" />
            Pipeline Overview
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stats.kanbanStats.map((col) => (
              <Card key={col.title}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span className="text-sm font-medium">{col.title}</span>
                  </div>
                  <div className="text-2xl font-bold">{col.count}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
