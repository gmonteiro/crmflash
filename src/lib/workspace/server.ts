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
