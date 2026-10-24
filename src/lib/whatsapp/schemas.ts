import { z } from "zod"

// O candidato NÃO tem campo de mensagem: `.strict()` recusa qualquer coisa a mais.
export const waCandidateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("direct"),
      phone: z.string().min(8).max(20),
      contactName: z.string().trim().min(1).max(120),
      personIds: z.array(z.string().uuid()).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("group"),
      groupId: z.string().regex(/@g\.us$/),
      groupName: z.string().trim().min(1).max(200),
      companyIds: z.array(z.string().uuid()).max(10),
      matchedBy: z.enum(["nome", "participante"]),
    })
    .strict(),
])

export const waDayEventSchema = z.object({
  chatKey: z.string().min(3).max(80),
  chat: z.discriminatedUnion("type", [
    z.object({ type: z.literal("direct"), phone: z.string().min(8).max(20) }),
    z.object({ type: z.literal("group"), groupId: z.string().regex(/@g\.us$/) }),
  ]),
  chatName: z.string().max(200),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["received", "sent"]),
  messageCount: z.number().int().min(1).max(10_000),
  lastAt: z.string().datetime(),
  text: z.string().max(4_000),
  lastMessage: z.object({ id: z.string().min(1).max(200), quote: z.string().max(280) }),
  speakerPhones: z.array(z.string().max(20)).max(50),
})

export const waCandidatesBody = z.object({ candidates: z.array(waCandidateSchema).max(200) })
export const waEventsBody = z.object({ events: z.array(waDayEventSchema).max(50) })
