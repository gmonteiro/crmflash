// Painel local (http://localhost:3011): QR para parear, status e o último ciclo.
// Adaptado do whatsapp-obsidian.
import http from "http"
import QRCode from "qrcode"

let currentQR: string | null = null
let connectionStatus: "disconnected" | "connecting" | "connected" = "disconnected"
let lastMessage: string | null = null
let lastStats: string | null = null

export function updateQR(qr: string | null) {
  currentQR = qr
  connectionStatus = qr ? "connecting" : connectionStatus
}

export function updateStatus(status: typeof connectionStatus) {
  connectionStatus = status
  if (status === "connected") currentQR = null
}

export function updateLastMessage(msg: string) {
  lastMessage = `${new Date().toLocaleString("pt-BR")} — ${msg}`
}

/** A linha do último ciclo: "12 vinculadas, 2 candidatas novas, 5 eventos, 0 recusados". */
export function updateStats(s: string) {
  lastStats = s
  updateLastMessage(s)
}

async function renderPage(): Promise<string> {
  let qrHtml = ""
  if (currentQR) {
    const dataUrl = await QRCode.toDataURL(currentQR, { width: 300, margin: 2 })
    qrHtml = `
      <div class="qr">
        <h2>📱 Escaneie o QR Code</h2>
        <p>WhatsApp → Dispositivos conectados → Conectar dispositivo</p>
        <img src="${dataUrl}" alt="QR Code" />
      </div>`
  }

  const statusColor =
    connectionStatus === "connected" ? "#22c55e" :
    connectionStatus === "connecting" ? "#eab308" : "#ef4444"

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp → CRM</title>
  <meta http-equiv="refresh" content="5" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 480px; width: 100%; padding: 2rem; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: 999px; background: #1a1a1a; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; }
    .qr { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; color: #111; }
    .qr img { margin-top: 1rem; border-radius: 8px; }
    .qr p { font-size: 0.85rem; color: #666; margin-top: 0.5rem; }
    .connected-msg { background: #1a1a1a; border-radius: 12px; padding: 1.5rem; }
    .connected-msg p { color: #a3a3a3; font-size: 0.85rem; margin-top: 0.5rem; }
    .last { margin-top: 1.5rem; background: #1a1a1a; border-radius: 12px; padding: 1rem; font-size: 0.8rem; color: #a3a3a3; text-align: left; }
    .last strong { color: #e5e5e5; }
  </style>
</head>
<body>
  <div class="container">
    <h1>WhatsApp → CRM (só leitura)</h1>
    <div class="status">
      <span class="dot"></span>
      ${connectionStatus === "connected" ? "Conectado" : connectionStatus === "connecting" ? "Aguardando QR scan..." : "Desconectado"}
    </div>
    ${qrHtml}
    ${connectionStatus === "connected" ? `
      <div class="connected-msg">
        <h2>✅ Conectado</h2>
        <p>Lendo as conversas confirmadas. Nada é enviado, nada é marcado como lido.</p>${lastStats ? `<p>${lastStats}</p>` : ""}
      </div>` : ""}
    ${connectionStatus === "disconnected" && !currentQR ? `
      <div class="connected-msg">
        <h2>⏳ Iniciando...</h2>
        <p>Aguardando conexão com o WhatsApp.</p>
      </div>` : ""}
    ${lastMessage ? `
      <div class="last">
        <strong>Última atividade:</strong><br/>${lastMessage}
      </div>` : ""}
  </div>
</body>
</html>`
}

export function startWebServer(port: number): void {
  const server = http.createServer(async (_req, res) => {
    const html = await renderPage()
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(html)
  })

  server.listen(port, () => {
    console.log(`[Web] Painel disponível em http://localhost:${port}`)
  })
}
