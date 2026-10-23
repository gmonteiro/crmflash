// Gera o GOOGLE_REFRESH_TOKEN da conta comercial da Lumeis, uma vez.
//
//   node --env-file=.env.local scripts/google-refresh-token.mjs [escopos...]
//
// Precisa de GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET de um cliente
// OAuth do tipo "App para computador" (Desktop), num projeto do Google Cloud
// com tela de consentimento INTERNAL (só contas do Workspace da Lumeis: sem
// verificação do Google, mesmo para o Gmail na fase 2).
//
// Abre o navegador na tela de consentimento, recebe o código num servidor
// local e imprime o refresh token. Ele não é gravado em lugar nenhum: copie
// para as variáveis da Vercel (Production) e para o .env.local.
//
// Escopos: sem argumento, só o do MVP (Calendar, leitura). Na fase 2:
//   node --env-file=.env.local scripts/google-refresh-token.mjs calendar.readonly gmail.readonly gmail.send

import http from "node:http"
import { randomBytes } from "node:crypto"

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error("Faltam GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no ambiente.")
  process.exit(1)
}

const scopes = (process.argv.slice(2).length ? process.argv.slice(2) : ["calendar.readonly"]).map((s) =>
  s.startsWith("https://") ? s : `https://www.googleapis.com/auth/${s}`
)
const PORT = 53682
const redirectUri = `http://127.0.0.1:${PORT}/callback`
const state = randomBytes(16).toString("hex")

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: scopes.join(" "),
  access_type: "offline",
  // prompt=consent força o Google a devolver refresh_token mesmo se já houve consentimento.
  prompt: "consent",
  state,
}).toString()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri)
  if (url.pathname !== "/callback") return res.writeHead(404).end()
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400).end("state inválido")
    return
  }
  const code = url.searchParams.get("code")
  if (!code) {
    res.writeHead(400).end(`Sem código: ${url.searchParams.get("error") ?? "?"}`)
    return
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })
  const json = await tokenRes.json()
  if (!json.refresh_token) {
    res.writeHead(500).end("O Google não devolveu refresh_token. Veja o terminal.")
    console.error(json)
    server.close()
    return
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Pronto. Pode fechar esta aba e voltar ao terminal.")
  console.log("\nGOOGLE_REFRESH_TOKEN=" + json.refresh_token)
  console.log("Escopos concedidos:", json.scope)
  server.close()
})

server.listen(PORT, "127.0.0.1", () => {
  console.log("Abra no navegador, logado na conta comercial da Lumeis:\n")
  console.log(authUrl.toString())
})
