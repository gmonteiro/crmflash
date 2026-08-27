import { timingSafeEqual } from "crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getAccessToken } from "./session"
import { lookupAccessToken } from "@/lib/oauth/store"

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

/** Separada para teste: a comparação em tempo constante não é observável de fora. */
export function matchesDevToken(token: string): boolean {
  const expected = process.env.MCP_DEV_TOKEN
  if (!expected) return false
  return constantTimeEquals(token, expected)
}

/** Cliente autenticado COMO o usuário — ver session.ts. A RLS escopa o resto. */
async function clientForUser(userId: string): Promise<SupabaseClient> {
  const accessToken = await getAccessToken(userId)
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}

/**
 * Token → identidade.
 *
 * Dois caminhos: token OAuth (produção) e o token de desenvolvimento em env
 * var (atalho local). O transporte e as 14 tools não sabem qual está ativo.
 */
export async function resolveIdentity(request: Request): Promise<McpIdentity | null> {
  const token = extractBearer(request)
  if (!token) return null

  // OAuth primeiro: é o caminho de produção. Deixar o token de dev em segundo
  // lugar garante que ele nunca sombreie um token real — e em produção ele
  // sequer existe, porque MCP_DEV_TOKEN não vai para lá.
  const granted = await lookupAccessToken(token)
  if (granted) {
    return {
      userId: granted.userId,
      workspaceId: granted.workspaceId,
      supabase: await clientForUser(granted.userId),
    }
  }

  const devUserId = process.env.MCP_DEV_USER_ID
  if (!devUserId || !matchesDevToken(token)) return null

  const supabase = await clientForUser(devUserId)
  const workspaceId = await resolveWorkspaceId(supabase, devUserId)
  if (!workspaceId) return null

  return { userId: devUserId, workspaceId, supabase }
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
