"use client"

import { useState, useEffect } from "react"
import { useCompanyPipeline } from "@/hooks/use-company-pipeline"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Target, Zap, CalendarCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { COMMITMENT_SIGNALS, STAGE_EXIT_CRITERIA, STALE_DAYS, FROZEN_DAYS } from "@/lib/constants"
import type { CommitmentSignalType } from "@/types/database"
import { differenceInCalendarDays, parseISO, format } from "date-fns"

interface CompanyPipelineTabProps {
  companyId: string
}

export function CompanyPipelineTab({ companyId }: CompanyPipelineTabProps) {
  const {
    pipeline,
    signals,
    loading,
    updateField,
    markClientEventToday,
    hasSignal,
    toggleSignal,
  } = useCompanyPipeline(companyId)

  const [champion, setChampion] = useState("")
  const [buyer, setBuyer] = useState("")
  const [pain, setPain] = useState("")

  useEffect(() => {
    if (pipeline) {
      setChampion(pipeline.champion_name ?? "")
      setBuyer(pipeline.economic_buyer_name ?? "")
      setPain(pipeline.pain_hypothesis ?? "")
    }
  }, [pipeline])

  if (loading || !pipeline) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const criteria = pipeline.stageTitle ? STAGE_EXIT_CRITERIA[pipeline.stageTitle] : null
  const days = pipeline.last_client_event_at
    ? differenceInCalendarDays(new Date(), parseISO(pipeline.last_client_event_at))
    : null
  const isFrozen = days === null || days >= FROZEN_DAYS
  const isStale = days !== null && days >= STALE_DAYS && days < FROZEN_DAYS

  return (
    <div className="space-y-6">
      {/* Estágio atual + critério de saída */}
      <div className="rounded-md border bg-muted/40 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Target className="h-4 w-4 text-primary" />
          Estágio: {pipeline.stageTitle ?? "fora do board"}
        </div>
        {criteria && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Só sai daqui quando: </span>
            {criteria}
          </p>
        )}
      </div>

      {/* Último evento do cliente */}
      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Último evento do cliente</p>
          <p
            className={cn(
              "text-sm font-medium",
              isFrozen
                ? "text-red-600 dark:text-red-400"
                : isStale
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {pipeline.last_client_event_at
              ? `${format(parseISO(pipeline.last_client_event_at), "dd/MM/yyyy")} · ${days === 0 ? "hoje" : `há ${days}d`}`
              : "nenhum registrado"}
            {isFrozen && !!pipeline.last_client_event_at && " · candidato a gelado"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={markClientEventToday}>
          <CalendarCheck className="mr-1 h-4 w-4" />
          Evento hoje
        </Button>
      </div>

      {/* Sinais de compromisso */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-medium">Sinais de compromisso</h3>
          <span className="text-xs text-muted-foreground">({signals.length}/6)</span>
        </div>
        <div className="space-y-1.5">
          {COMMITMENT_SIGNALS.map((sig) => {
            const checked = hasSignal(sig.value as CommitmentSignalType)
            return (
              <label
                key={sig.value}
                className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleSignal(sig.value as CommitmentSignalType, sig.label)}
                />
                <span className={cn("text-sm", checked && "font-medium")}>{sig.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Champion / quem assina / hipótese de dor */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="champion" className="text-xs">Champion</Label>
          <Input
            id="champion"
            value={champion}
            placeholder="Quem defende internamente"
            onChange={(e) => setChampion(e.target.value)}
            onBlur={() => champion !== (pipeline.champion_name ?? "") && updateField("champion_name", champion)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="buyer" className="text-xs">Quem assina</Label>
          <Input
            id="buyer"
            value={buyer}
            placeholder="Economic buyer / aprovador"
            onChange={(e) => setBuyer(e.target.value)}
            onBlur={() => buyer !== (pipeline.economic_buyer_name ?? "") && updateField("economic_buyer_name", buyer)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pain" className="text-xs">Hipótese de dor</Label>
        <Textarea
          id="pain"
          value={pain}
          rows={3}
          placeholder="A dor descrita na linguagem do cliente (processo atual, ordem de grandeza: horas/mês, R$, headcount)"
          onChange={(e) => setPain(e.target.value)}
          onBlur={() => pain !== (pipeline.pain_hypothesis ?? "") && updateField("pain_hypothesis", pain)}
        />
      </div>
    </div>
  )
}
