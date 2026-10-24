import { NextResponse } from "next/server"
import { z } from "zod"
import { verifyCsrfOrigin } from "@/lib/utils"
import { sessionHubStore } from "@/lib/workspace/server"

const body = z.object({
  conversation_key: z.string().regex(/^(gmail|whatsapp):.+/).max(200),
  side: z.enum(["client", "lumeis"]),
  through: z.string().datetime(),
  reason: z.string().trim().max(300).nullable().default(null),
})

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 })
  await s.store.dismissConversation({
    conversationKey: parsed.data.conversation_key,
    side: parsed.data.side,
    // Limita a agora: dispensa futura esconderia a mensagem nova que traz a conversa de volta.
    dismissedThrough: new Date(Math.min(Date.parse(parsed.data.through), Date.now())).toISOString(),
    reason: parsed.data.reason,
    dismissedBy: s.userId,
  })
  return NextResponse.json({ ok: true })
}
