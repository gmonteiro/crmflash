import { z } from "zod"
import { openItems } from "@/lib/hub/open-items"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import type { McpTool } from "../../registry"

const input = z.object({})

export const openItemsTool: McpTool<typeof input> = {
  name: "open_items",
  description:
    "Tudo que está esperando você, a mesma lista da página Pendências: conversas de e-mail e " +
    "WhatsApp em que o cliente escreveu por último e ninguém respondeu (aguardando você), " +
    "conversas em que você escreveu e o cliente está há 3+ dias sem responder (aguardando o " +
    "cliente), decisões abertas (fila de identidade e propostas da IA) e alertas do sistema " +
    "(coletor de WhatsApp ou cron parado). Use para responder 'o que está pendente?'.",
  input,
  async handler(identity) {
    // Leitura com o cliente do usuário: a RLS escopa ao workspace dele.
    const store = new SupabaseHubStore(identity.supabase, identity.workspaceId, identity.userId)
    return openItems(store, { now: Date.now() })
  },
}
