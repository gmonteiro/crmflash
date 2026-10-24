import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolve o workspace do usuário logado, no servidor.
 *
 * Existe para as rotas que ainda precisam do id explícito para escopar queries
 * e preencher inserts — a RLS já filtra sozinha, mas manter o filtro explícito
 * é o mesmo defense-in-depth adotado no resto do projeto.
 */
export async function getWorkspaceId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .maybeSingle()

  return data?.workspace_id ?? null
}

/** O hub store com o cliente do usuário: a RLS escopa leitura e escrita ao workspace dele. */
export async function sessionHubStore() {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server")
  const { SupabaseHubStore } = await import("@/lib/hub/supabase-store")
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const workspaceId = await getWorkspaceId(supabase, user.id)
  if (!workspaceId) return null
  return { supabase, userId: user.id, workspaceId, store: new SupabaseHubStore(supabase, workspaceId, user.id) }
}
