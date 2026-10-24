import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { openCandidates } from "@/lib/hub/whatsapp-ingest"
import { waCandidatesBody } from "@/lib/whatsapp/schemas"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = waCandidatesBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  try {
    return NextResponse.json(await openCandidates(await SupabaseHubStore.fromEnv(), parsed.data.candidates))
  } catch (e) {
    console.error("[hub/whatsapp/candidates]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
