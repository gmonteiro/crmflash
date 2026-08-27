import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { computePipelineMetrics } from "@/lib/pipeline/metrics"
import { colById } from "@/lib/pipeline/stages"
import type { McpTool } from "../registry"

const input = z.object({
  window_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe("Janela em dias para movimentos, sinais e novos qualificados."),
})

export const pipelineOverview: McpTool<typeof input> = {
  name: "pipeline_overview",
  description:
    "Visão geral do funil comercial: quantas empresas em cada estágio, movimentos " +
    "líquidos, sinais capturados, cards parados e tempo médio por estágio. Use quando " +
    "a pergunta for sobre o pipeline como um todo, não sobre uma empresa específica.",
  input,
  async handler({ supabase }, { window_days }) {
    const snap = await fetchPipelineSnapshot(supabase)
    const metrics = computePipelineMetrics(snap, { windowDays: window_days })
    const byId = colById(snap.columns)

    const stages = snap.columns.map((col) => ({
      title: col.title,
      companies: snap.companies.filter((c) => byId.get(c.kanban_column_id)?.id === col.id)
        .length,
    }))

    return {
      window_days: metrics.windowDays,
      total_on_board: metrics.totalOnBoard,
      stages,
      net_movement: metrics.net,
      signals_in_window: metrics.signalsWeek,
      stalled_total: metrics.totalStalled,
      funnel: metrics.funnel,
      avg_days_per_stage: metrics.avgTime,
      outcomes: metrics.outcomes,
    }
  },
}
