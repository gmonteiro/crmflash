"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace/context"
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { cn } from "@/lib/utils"

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const { workspaceId, loading } = useWorkspace()

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setEmail(user?.email ?? undefined)

      if (loading || !workspaceId) return

      // O bootstrap é por WORKSPACE, não por usuário: se fosse por usuário, a
      // segunda pessoa a logar criaria um segundo conjunto de 10 colunas em
      // cima do quadro que já existe.
      const { data: cols } = await supabase
        .from("kanban_columns")
        .select("id")
        .eq("workspace_id", workspaceId)
        .limit(1)

      if (!cols || cols.length === 0) {
        await supabase.rpc("create_default_kanban_columns", { p_workspace_id: workspaceId })
      }
    }
    init()
  }, [workspaceId, loading])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - desktop */}
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>

      {/* Sidebar - mobile */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:hidden transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar email={email} onMenuClick={() => setMobileOpen(!mobileOpen)} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkspaceProvider>
      <DashboardShell>{children}</DashboardShell>
    </WorkspaceProvider>
  )
}
