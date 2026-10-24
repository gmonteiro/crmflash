import { NextResponse } from "next/server"
import { openItems } from "@/lib/hub/open-items"
import { sessionHubStore } from "@/lib/workspace/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await openItems(s.store, { now: Date.now() }))
}
