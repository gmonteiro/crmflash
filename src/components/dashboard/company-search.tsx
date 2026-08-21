"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import { Building2, CalendarClock, Loader2, Search, User, Zap, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import { clientEventStatus } from "@/lib/pipeline/health"
import { toIlikePattern } from "@/lib/search-term"
import { cn } from "@/lib/utils"

const MIN_CHARS = 2
const DEBOUNCE_MS = 250
const MAX_RESULTS = 8

interface CompanyHit {
  id: string
  name: string
  stageTitle: string | null
  lastClientEventAt: string | null
  championName: string | null
  signalCount: number
  nextStep: { title: string; dueDate: string | null } | null
}

// O Supabase devolve o relacionamento como objeto ou lista dependendo da
// cardinalidade inferida; normalizamos para nao depender disso.
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

interface Row {
  id: string
  name: string
  kanban_column_id: string | null
  last_client_event_at: string | null
  champion_name: string | null
  kanban_columns: { title: string } | { title: string }[] | null
  company_next_steps: { title: string; due_date: string | null }[] | null
  company_commitment_signals: { signal_type: string }[] | null
}

function toHit(row: Row): CompanyHit {
  const steps = row.company_next_steps ?? []
  // O passo que importa e o que vence primeiro; sem data vai pro fim.
  const sorted = [...steps].sort((a, b) => {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })
  const next = sorted[0]

  return {
    id: row.id,
    name: row.name,
    stageTitle: firstOf(row.kanban_columns)?.title ?? null,
    lastClientEventAt: row.last_client_event_at,
    championName: row.champion_name,
    signalCount: (row.company_commitment_signals ?? []).length,
    nextStep: next ? { title: next.title, dueDate: next.due_date } : null,
  }
}

export function CompanySearch() {
  const router = useRouter()
  // Escopo explicito por workspace, como o resto do app: a RLS sozinha deixaria
  // a busca enxergar contas de todos os workspaces do usuario enquanto as outras
  // telas mostram so o ativo.
  const { workspaceId } = useWorkspace()
  const [term, setTerm] = useState("")
  const [results, setResults] = useState<CompanyHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // Descarta resposta de busca antiga que chegou depois de uma mais nova.
  const requestId = useRef(0)

  // O que fazer com o termo digitado e decidido aqui, no evento — nao no corpo
  // do efeito. Mexer no state sincronamente dentro do efeito dispara renders em
  // cascata (e o lint do React reclama, com razao).
  const handleChange = useCallback((value: string) => {
    setTerm(value)
    setOpen(true)
    const searchable = toIlikePattern(value).length >= MIN_CHARS + 2
    if (searchable) {
      setLoading(true)
    } else {
      setLoading(false)
      setResults([])
    }
  }, [])

  useEffect(() => {
    const pattern = toIlikePattern(term)
    if (pattern.length < MIN_CHARS + 2 || !workspaceId) return

    const id = ++requestId.current
    const timer = setTimeout(async () => {
      const supabase = createClient()
      // Uma query so: estagio, proximos passos pendentes e sinais vem embutidos
      // pelas FKs. Empresas fora do board entram tambem (kanban_column_id null),
      // porque "fora do pipeline" tambem e uma situacao que voce quer ver.
      const { data } = await supabase
        .from("companies")
        .select(
          "id, name, kanban_column_id, last_client_event_at, champion_name, kanban_columns(title), company_next_steps(title, due_date, status), company_commitment_signals(signal_type)"
        )
        .eq("workspace_id", workspaceId)
        .ilike("name", pattern)
        .eq("company_next_steps.status", "pending")
        .order("name")
        .limit(MAX_RESULTS)

      if (id !== requestId.current) return
      setResults(((data ?? []) as unknown as Row[]).map(toHit))
      setActive(0)
      setLoading(false)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [term, workspaceId])

  const openCompany = useCallback(
    (hit: CompanyHit | undefined) => {
      if (!hit) return
      setOpen(false)
      router.push(`/companies/${hit.id}`)
    },
    [router]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false)
        return
      }
      if (!results.length) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % results.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + results.length) % results.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        openCompany(results[active])
      }
    },
    [results, active, openCompany]
  )

  const showPanel = open && toIlikePattern(term).length >= MIN_CHARS + 2

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          // Atraso curto: sem ele o clique num resultado perde o alvo, porque o
          // blur fecha o painel antes do click disparar.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar empresa pelo nome…"
          className="pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {showPanel && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {loading ? "Procurando…" : "Nenhuma empresa com esse nome."}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((hit, i) => {
                const event = clientEventStatus(hit.lastClientEventAt)
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => openCompany(hit)}
                      className={cn(
                        "block w-full px-3 py-2 text-left transition-colors",
                        i === active && "bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{hit.name}</span>
                        <Badge
                          variant={hit.stageTitle ? "outline" : "secondary"}
                          className="ml-auto h-4 min-w-0 max-w-[45%] shrink-0 px-1 text-[10px]"
                          title={hit.stageTitle ?? "Fora do pipeline"}
                        >
                          <span className="truncate">{hit.stageTitle ?? "fora do pipeline"}</span>
                        </Badge>
                      </span>

                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <span className={cn("flex items-center gap-1 font-medium", event.colorClass)}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {event.label}
                        </span>

                        {hit.championName && (
                          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{hit.championName}</span>
                          </span>
                        )}

                        {hit.signalCount > 0 && (
                          <span className="flex items-center gap-1 font-medium text-violet-600 dark:text-violet-400">
                            <Zap className="h-3 w-3" />
                            {hit.signalCount}
                          </span>
                        )}

                        {hit.nextStep ? (
                          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {hit.nextStep.title}
                              {hit.nextStep.dueDate &&
                                ` · ${format(parseISO(hit.nextStep.dueDate), "dd/MM")}`}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                            <AlertTriangle className="h-3 w-3" />
                            sem próximo passo
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
