import { NextResponse } from "next/server"
import { z } from "zod"
import { decideInference, resolveReview } from "@/lib/hub/decisions"
import { verifyCsrfOrigin } from "@/lib/utils"
import { sessionHubStore } from "@/lib/workspace/server"

const resolution = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link_person"), personId: z.string().uuid() }),
  z.object({ type: z.literal("link_company"), companyId: z.string().uuid() }),
  z.object({ type: z.literal("create_company"), name: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("ignore") }),
])
const body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review"), id: z.string().uuid(), resolution }),
  z.object({ type: z.literal("inference"), id: z.string().uuid(), decision: z.enum(["accept", "reject"]) }),
])

// Estágio nunca muda daqui: aceitar sugestão de estágio é no copiloto da conta,
// que move pelo move_stage. Caso de projeto/reunião precisa reingerir (MCP).
export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 })
  const ctx = { workspaceId: s.workspaceId, userId: s.userId }

  if (parsed.data.type === "inference") {
    const { data: inf, error } = await s.supabase.from("inferences").select("field").eq("id", parsed.data.id).maybeSingle()
    // A guarda falha fechada: sem ler a proposta, não decide nada.
    if (error) return NextResponse.json({ ok: false, detail: "Falha ao ler a proposta." }, { status: 500 })
    if (!inf) return NextResponse.json({ ok: false, detail: "Proposta não encontrada." }, { status: 404 })
    if (inf?.field === "stage_suggestion" && parsed.data.decision === "accept") {
      return NextResponse.json({ ok: false, detail: "Sugestão de estágio se aceita no copiloto da conta." }, { status: 400 })
    }
    return NextResponse.json(await decideInference(s.supabase, ctx, parsed.data.id, parsed.data.decision))
  }

  const { data: rev, error } = await s.supabase.from("identity_reviews").select("observed").eq("id", parsed.data.id).maybeSingle()
  if (error) return NextResponse.json({ ok: false, detail: "Falha ao ler o caso." }, { status: 500 })
  if (!rev) return NextResponse.json({ ok: false, detail: "Caso não encontrado." }, { status: 404 })
  const obs = (rev.observed ?? {}) as { project_id?: string; meeting_id?: string }
  if (obs.project_id || obs.meeting_id) {
    return NextResponse.json({ ok: false, detail: "Projeto e reunião se resolvem no claude.ai (resolve_identity), que reprocessa as transcrições." }, { status: 400 })
  }
  return NextResponse.json(await resolveReview(s.supabase, ctx, parsed.data.id, parsed.data.resolution))
}
