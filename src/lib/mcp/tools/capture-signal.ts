import { z } from "zod"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const LABELS: Record<string, string> = {
  second_interlocutor: "Trouxe um segundo interlocutor",
  presented_internally: "Apresentou internamente",
  shared_real_data: "Compartilhou dado real",
  allocated_team_member: "Alocou alguém do time",
  asked_price: "Perguntou preço",
  security_process: "Iniciou processo de segurança",
}

const input = z.object({
  company_id: z.string().uuid(),
  signal: z
    .enum([
      "second_interlocutor",
      "presented_internally",
      "shared_real_data",
      "allocated_team_member",
      "asked_price",
      "security_process",
    ])
    .describe("O sinal de compromisso que o cliente demonstrou."),
})

export const captureSignal: McpTool<typeof input> = {
  name: "capture_signal",
  description:
    "Registra um sinal de compromisso do cliente — trouxe outra pessoa, apresentou " +
    "internamente, compartilhou dado real, alocou alguém, perguntou preço, ou começou " +
    "processo de segurança. Todo sinal é ação do cliente e reseta o contador de dias sem " +
    "contato. Capturar o mesmo sinal duas vezes não faz nada: o histórico não é reescrito.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    await applyEffect(
      supabase,
      { workspaceId, userId, companyId: args.company_id, snapshot: null },
      { kind: "capture_signal", signal: args.signal, label: LABELS[args.signal] }
    )

    return { captured: args.signal, label: LABELS[args.signal] }
  },
}
