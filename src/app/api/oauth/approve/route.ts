import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getWorkspaceId } from "@/lib/workspace/server"
import { getClient, issueCode } from "@/lib/oauth/store"
import { verifyCsrfOrigin } from "@/lib/utils"
import type { McpOAuthClient } from "@/types/database"

export interface AuthorizeParams {
  ok: boolean
  error?: string
  clientId?: string
  redirectUri?: string
  codeChallenge?: string
  state?: string
}

/**
 * Valida o pedido de autorização.
 *
 * A checagem de redirect_uri é por igualdade exata contra o que o cliente
 * registrou — não prefixo. Prefixo deixaria `https://claude.ai/cb.evil.com`
 * passar por `https://claude.ai/cb`, e o code iria para o lugar errado.
 */
export function validateAuthorizeParams(
  params: URLSearchParams,
  client: McpOAuthClient | null
): AuthorizeParams {
  if (!client) return { ok: false, error: "cliente desconhecido" }

  const redirectUri = params.get("redirect_uri") ?? ""
  if (!client.redirect_uris.includes(redirectUri)) {
    return { ok: false, error: "redirect_uri não registrado para este cliente" }
  }

  if (params.get("response_type") !== "code") {
    return { ok: false, error: "response_type precisa ser code" }
  }

  const codeChallenge = params.get("code_challenge") ?? ""
  if (!codeChallenge) return { ok: false, error: "code_challenge é obrigatório" }

  if ((params.get("code_challenge_method") ?? "") !== "S256") {
    return { ok: false, error: "code_challenge_method precisa ser S256" }
  }

  return {
    ok: true,
    clientId: client.client_id,
    redirectUri,
    codeChallenge,
    state: params.get("state") ?? undefined,
  }
}

export async function POST(request: NextRequest) {
  // CSRF: esta rota é um POST autenticado por COOKIE que emite um
  // authorization code. Sem esta checagem, qualquer site poderia postar um
  // formulário com o client_id dele e sair com um code válido do usuário
  // logado, sem nenhum clique consciente.
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 403 })
  }

  const form = await request.formData()
  const params = new URLSearchParams()
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params.set(k, v)
  }

  // A sessão do navegador é o que prova QUEM está autorizando. Sem ela não há
  // o que aprovar — e ela chega aqui pelo cookie, não pelo formulário.
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const workspaceId = await getWorkspaceId(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: "sem workspace" }, { status: 400 })
  }

  const client = await getClient(params.get("client_id") ?? "")
  const parsed = validateAuthorizeParams(params, client)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error },
      { status: 400 }
    )
  }

  const code = await issueCode({
    clientId: parsed.clientId!,
    userId: user.id,
    workspaceId,
    redirectUri: parsed.redirectUri!,
    codeChallenge: parsed.codeChallenge!,
  })

  const target = new URL(parsed.redirectUri!)
  target.searchParams.set("code", code)
  if (parsed.state) target.searchParams.set("state", parsed.state)

  return NextResponse.redirect(target, { status: 303 })
}
