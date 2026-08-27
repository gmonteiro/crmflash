import { timingSafeEqual } from "crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getAccessToken } from "./session"

export interface McpIdentity {
  userId: string
  workspaceId: string
  /** Cliente já autenticado COMO o usuário: a RLS escopa tudo que ele fizer. */
  supabase: SupabaseClient
}

export function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null

  const [scheme, token] = header.split(" ")
  if (scheme !== "Bearer" || !token) return null

  return token
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Token → identidade.
 *
 * Fatia 1: token único de desenvolvimento, em env var. A Fatia 2 troca só o
 * corpo desta função por uma consulta em mcp_oauth_tokens — o transporte e as
 * 14 tools não sabem qual das duas está ativa, e por isso não mudam.
 */
export async function resolveIdentity(request: Request): Promise<McpIdentity | null> {
  const token = extractBearer(request)
  if (!token) return null

  const expected = process.env.MCP_DEV_TOKEN
  const userId = process.env.MCP_DEV_USER_ID
  if (!expected || !userId) return null
  if (!constantTimeEquals(token, expected)) return null

  // Sessão real, assinada pela chave corrente do projeto — ver session.ts.
  const accessToken = await getAccessToken(userId)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )

  const workspaceId = await resolveWorkspaceId(supabase, userId)
  if (!workspaceId) return null

  return { userId, workspaceId, supabase }
}

/**
 * O workspace do usuário.
 *
 * O filtro por user_id é obrigatório, não defense-in-depth: a RLS de
 * workspace_members escopa por WORKSPACE, então um membro enxerga todos os
 * outros membros — é o que faz a tela de gestão de membros funcionar. Sem o
 * filtro, um workspace com duas pessoas devolve duas linhas e o maybeSingle
 * falha, derrubando a autenticação inteira.
 *
 * Mesma forma de getWorkspaceId em lib/workspace/server.ts.
 */
export async function resolveWorkspaceId(
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
