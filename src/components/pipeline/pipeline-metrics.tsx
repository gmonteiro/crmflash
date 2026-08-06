"use client"

import { useState } from "react"
import { usePipelineMetrics } from "@/hooks/use-pipeline-metrics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  TrendingUp, Zap, AlertTriangle, UserPlus, Filter, Clock, Snowflake, ArrowUpRight, ArrowDownRight,
} from "lucide-react"

const WINDOWS = [7, 14, 30]

export function PipelineMetrics() {
  const [windowDays, setWindowDays] = useState(7)
  const { metrics, loading } = usePipelineMetrics(windowDays)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Métricas do Pipeline</h1>
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={windowDays === w ? "default" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setWindowDays(w)}
            >
              {w}d
            </Button>
          ))}
        </div>
      </div>

      {loading || !metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <>
          {/* KPIs — as 3 primeiras são as de levar pra reunião */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              priority
              icon={TrendingUp}
              title="Movimentos líquidos"
              value={`${metrics.net.net > 0 ? "+" : ""}${metrics.net.net}`}
              valueClass={
                metrics.net.net > 0 ? "text-emerald-600 dark:text-emerald-400"
                : metrics.net.net < 0 ? "text-red-600 dark:text-red-400" : ""
              }
              footer={
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                    <ArrowUpRight className="h-3 w-3" />{metrics.net.advance}
                  </span>
                  <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                    <ArrowDownRight className="h-3 w-3" />{metrics.net.regress}
                  </span>
                  <span className="text-muted-foreground">avanços · recuos/gelados</span>
                </span>
              }
            />
            <Kpi
              priority
              icon={Zap}
              title="Sinais de compromisso"
              value={metrics.signalsWeek}
              valueClass="text-violet-600 dark:text-violet-400"
              footer={`capturados nos últimos ${windowDays}d`}
            />
            <Kpi
              priority
              icon={AlertTriangle}
              title="Cards parados"
              value={metrics.totalStalled}
              valueClass={metrics.totalStalled > 0 ? "text-amber-600 dark:text-amber-400" : ""}
              footer="+14d sem evento do cliente"
            />
            <Kpi
              icon={UserPlus}
              title={`Novos em ${metrics.qualifiedStageTitle ?? "—"}`}
              value={metrics.qualifiedWeek}
              footer={`entraram nos últimos ${windowDays}d`}
            />
          </div>

          {/* Cards parados por estágio */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Cards parados por estágio
              </CardTitle>
            </CardHeader>
            <CardContent>
              {metrics.totalStalled === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum card parado. Todo card teve evento do cliente nos últimos {14} dias. 🎯
                </p>
              ) : (
                <div className="space-y-4">
                  {metrics.stalled.filter((s) => s.parados > 0).map((s) => (
                    <div key={s.title}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-sm font-medium">{s.title}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {s.parados}/{s.total} parados
                        </Badge>
                        {s.frozen > 0 && (
                          <Badge variant="destructive" className="text-[10px] gap-0.5">
                            <Snowflake className="h-2.5 w-2.5" />
                            {s.frozen} gelado{s.frozen > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-4">
                        {s.companies.map((c) => (
                          <span
                            key={c.id}
                            className={cn(
                              "rounded border px-1.5 py-0.5 text-xs",
                              c.days === null || c.days >= 30
                                ? "border-red-500/40 text-red-600 dark:text-red-400"
                                : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {c.name} · {c.days === null ? "sem evento" : `há ${c.days}d`}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Funil de conversão */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Filter className="h-4 w-4 text-primary" />
                  Funil de conversão acumulada
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FunnelChart funnel={metrics.funnel} />
                {metrics.outcomes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    {metrics.outcomes.map((o) => (
                      <span key={o.title} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.color }} />
                        {o.title}: <span className="font-medium text-foreground">{o.count}</span>
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Conversão só fica confiável depois de ~20 contas — os números vão se estabilizando conforme o histórico acumula.
                </p>
              </CardContent>
            </Card>

            {/* Tempo médio por estágio */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-primary" />
                  Tempo médio em cada estágio
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TimeChart avgTime={metrics.avgTime} />
                {metrics.avgTime.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Ainda sem histórico de movimentos suficiente. Comece a mover cards no board para acumular.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sinais por tipo */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-violet-500" />
                Sinais capturados por tipo (últimos {windowDays}d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2">
                {metrics.signalsByType.map((s) => (
                  <div key={s.type} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-sm">{s.label}</span>
                    <Badge variant={s.count > 0 ? "default" : "secondary"} className="text-xs">
                      {s.count}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Kpi({
  icon: Icon, title, value, footer, valueClass, priority,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  value: React.ReactNode
  footer: React.ReactNode
  valueClass?: string
  priority?: boolean
}) {
  return (
    <Card className={cn(priority && "border-primary/30")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn("text-3xl font-bold", valueClass)}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{footer}</div>
      </CardContent>
    </Card>
  )
}

function FunnelChart({ funnel }: { funnel: { title: string; color: string; reached: number; conversionFromPrev: number | null }[] }) {
  const max = Math.max(1, ...funnel.map((f) => f.reached))
  return (
    <div className="space-y-2.5">
      {funnel.map((f) => (
        <div key={f.title}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className="font-medium">{f.title}</span>
            <span className="flex items-center gap-2">
              {f.conversionFromPrev !== null && (
                <span className={cn(
                  "tabular-nums",
                  f.conversionFromPrev >= 0.6 ? "text-emerald-600 dark:text-emerald-400"
                  : f.conversionFromPrev >= 0.3 ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400"
                )}>
                  {Math.round(f.conversionFromPrev * 100)}%
                </span>
              )}
              <span className="font-semibold tabular-nums">{f.reached}</span>
            </span>
          </div>
          <div className="h-5 w-full rounded bg-muted overflow-hidden">
            <div
              className="h-full rounded"
              style={{ width: `${(f.reached / max) * 100}%`, backgroundColor: f.color, minWidth: f.reached > 0 ? "2px" : "0" }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function TimeChart({ avgTime }: { avgTime: { title: string; color: string; avgDays: number; samples: number }[] }) {
  if (avgTime.length === 0) return null
  const max = Math.max(1, ...avgTime.map((t) => t.avgDays))
  const slowest = avgTime.reduce((a, b) => (b.avgDays > a.avgDays ? b : a), avgTime[0])
  return (
    <div className="space-y-2.5">
      {avgTime.map((t) => (
        <div key={t.title}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className="font-medium flex items-center gap-1.5">
              {t.title}
              {t.title === slowest.title && (
                <Badge variant="destructive" className="text-[9px] px-1 py-0">gargalo</Badge>
              )}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t.avgDays.toFixed(1)}d <span className="opacity-60">({t.samples})</span>
            </span>
          </div>
          <div className="h-5 w-full rounded bg-muted overflow-hidden">
            <div
              className="h-full rounded"
              style={{
                width: `${(t.avgDays / max) * 100}%`,
                backgroundColor: t.title === slowest.title ? "#ef4444" : t.color,
                minWidth: "2px",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
