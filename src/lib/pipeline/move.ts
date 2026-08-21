import type { SupabaseClient } from "@supabase/supabase-js"
import type { StageEventDirection } from "@/types/database"

export interface MoveStageColumn {
  id: string
  title: string
  position: number
}

interface ApplyStageMoveParams {
  // workspaceId escopa; userId diz quem moveu o card.
  workspaceId: string
  userId: string | null
  companyId: string
  from: MoveStageColumn | null
  to: MoveStageColumn
  position: number
}

// Determina a direção do movimento a partir dos estágios de origem/destino.
// Exportada para que o copiloto possa antecipar a direção antes de escrever.
export function inferDirection(
  from: MoveStageColumn | null,
  to: MoveStageColumn
): StageEventDirection {
  if (!from) return "enter"
  if (/gelad/i.test(to.title)) return "frozen"
  if (to.position > from.position) return "advance"
  if (to.position < from.position) return "retreat"
  return "advance"
}

// Move a empresa de estágio: atualiza companies, registra o evento no log e —
// só quando o movimento é um avanço — marca evento do cliente.
// Quando a empresa já está na coluna de destino, apenas reposiciona (sem log).
export async function applyStageMove(
  supabase: SupabaseClient,
  { workspaceId, userId, companyId, from, to, position }: ApplyStageMoveParams
): Promise<StageEventDirection | null> {
  const changedColumn = !from || from.id !== to.id
  const direction = changedColumn ? inferDirection(from, to) : null

  const companyUpdate: Record<string, unknown> = {
    kanban_column_id: to.id,
    kanban_position: position,
  }
  // Avanço reflete uma ação do cliente → registra evento do cliente.
  if (direction === "advance") {
    companyUpdate.last_client_event_at = new Date().toISOString()
  }

  await supabase
    .from("companies")
    .update(companyUpdate)
    .eq("id", companyId)
    .eq("workspace_id", workspaceId)

  if (direction) {
    await supabase.from("company_stage_events").insert({
      workspace_id: workspaceId,
      user_id: userId,
      company_id: companyId,
      from_column_id: from?.id ?? null,
      to_column_id: to.id,
      from_title: from?.title ?? null,
      to_title: to.title,
      from_position: from?.position ?? null,
      to_position: to.position,
      direction,
    })
  }

  return direction
}
