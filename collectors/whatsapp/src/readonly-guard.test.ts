import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// A garantia de só leitura não é disciplina, é teste: nenhum arquivo do
// coletor pode citar um método que escreve no WhatsApp.
const FORBIDDEN = [
  "sendMessage",
  "sendSeen",
  "markRead",
  "sendPresenceAvailable",
  "sendPresenceUnavailable",
  "sendStateTyping",
  "sendStateRecording",
  ".reply(",
  ".react(",
  ".forward(",
  ".delete(",
  "archiveChat",
  "pinChat",
  "muteChat",
  "markChatUnread",
  "createGroup",
  "addParticipants",
]

describe("coletor só leitura", () => {
  it("nenhum arquivo do coletor usa método que escreve no WhatsApp", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url))
    const offenders: string[] = []
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "readonly-guard.test.ts")) {
      const src = readFileSync(`${dir}/${f}`, "utf8")
      for (const w of FORBIDDEN) if (src.includes(w)) offenders.push(`${f}: ${w}`)
    }
    expect(offenders).toEqual([])
  })
})
