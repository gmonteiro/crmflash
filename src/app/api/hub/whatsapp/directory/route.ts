import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { buildDirectory } from "@/lib/hub/whatsapp-ingest"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await buildDirectory(await SupabaseHubStore.fromEnv()))
  } catch (e) {
    console.error("[hub/whatsapp/directory]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
