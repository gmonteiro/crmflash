import "dotenv/config"
import path from "node:path"
import pkg from "whatsapp-web.js"
import { crmClient } from "./crm-client"
import { runCycle } from "./cycle"
import { ReadOnlyWhatsApp } from "./readonly"
import { loadState, saveState } from "./state"
import { startWebServer, updateLastMessage, updateQR, updateStats, updateStatus } from "./web"

const { Client, LocalAuth } = pkg

const CRM_URL = process.env.CRM_URL || "https://crmflash.vercel.app"
const TOKEN = process.env.WHATSAPP_COLLECTOR_TOKEN
if (!TOKEN) throw new Error("WHATSAPP_COLLECTOR_TOKEN não configurado (rode scripts/whatsapp-collector-token.mjs na raiz do crmflash)")
const SESSION = path.resolve(process.env.WA_SESSION_PATH || "./session")
const STATE = path.resolve(process.env.WA_STATE_PATH || "./state.json")
const PORT = parseInt(process.env.PORT || "3011", 10)
const CYCLE_MS = 5 * 60 * 1000

const internal = new Set(
  (process.env.WHATSAPP_INTERNAL_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean)
)

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION, clientId: "crm" }),
  // getChats numa conta grande passa dos 180 s padrão do CDP na primeira carga.
  puppeteer: { headless: true, protocolTimeout: 600_000, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
})
const crm = crmClient(CRM_URL, TOKEN)
let reader: ReadOnlyWhatsApp | null = null
let running = false

async function cycle() {
  if (!reader || running) return
  running = true
  try {
    const state = loadState(STATE)
    const r = await runCycle(reader, crm, state, {
      now: Date.now(),
      internalDigits: internal,
      chatName: (c) => reader!.displayName(c.id) ?? c.name ?? "",
    })
    saveState(STATE, state)
    const line = `${r.linked} vinculadas, ${r.candidates} candidatas novas, ${r.events} eventos, ${r.rejected} recusados`
    console.log(`[ciclo] ${line}`)
    updateStats(line)
  } catch (e) {
    console.error("[ciclo] erro:", e)
    updateLastMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running = false
  }
}

client.on("qr", (qr: string) => updateQR(qr))
client.on("ready", async () => {
  updateStatus("connected")
  const me = client.info?.wid?.user
  if (me) internal.add(me)
  reader = new ReadOnlyWhatsApp(client, client.info?.pushname || "Gabriel")
  console.log("[WhatsApp] conectado, só leitura")
  await cycle()
})
client.on("disconnected", (reason: string) => {
  updateStatus("disconnected")
  reader = null
  console.log(`[WhatsApp] desconectado: ${reason}`)
})

setInterval(cycle, CYCLE_MS)
startWebServer(PORT)
client.initialize()
