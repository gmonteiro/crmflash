// Gera o token do coletor de WhatsApp, grava em collectors/whatsapp/.env
// (WHATSAPP_COLLECTOR_TOKEN) e imprime SÓ o SHA-256, que vai para a Vercel
// como WHATSAPP_COLLECTOR_TOKEN_SHA256. O token em claro nunca aparece na tela.
import { randomBytes, createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const envPath = fileURLToPath(new URL("../collectors/whatsapp/.env", import.meta.url))
const token = randomBytes(32).toString("base64url")
const sha = createHash("sha256").update(token).digest("hex")

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
env = env.replace(/^WHATSAPP_COLLECTOR_TOKEN=.*\r?\n?/m, "")
if (env && !env.endsWith("\n")) env += "\n"
env += `WHATSAPP_COLLECTOR_TOKEN=${token}\n`
writeFileSync(envPath, env)

console.log(`token gravado em ${envPath}`)
console.log(`WHATSAPP_COLLECTOR_TOKEN_SHA256=${sha}`)
