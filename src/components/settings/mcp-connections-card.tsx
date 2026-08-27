"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Plug } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useMcpConnections } from "@/hooks/use-mcp-connections"

// Data seca não serve aqui: o token dura 1h e rotaciona, então "usado em
// 27/08" seria a resposta quase sempre e não diria se a conexão ainda está
// viva. A pergunta que a tela responde é "isso ainda está sendo usado?".
function relativo(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
}

export function McpConnectionsCard() {
  const { connections, loading, revoke } = useMcpConnections()

  async function handleRevoke(id: string, name: string) {
    try {
      await revoke(id)
      toast.success(`Acesso de ${name} revogado.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao revogar")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Conexões MCP
        </CardTitle>
        <CardDescription>
          Aplicativos autorizados a ler e registrar no seu pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!loading && connections.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma conexão ativa.</p>
        )}

        {connections.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.clientName}</p>
              <p className="text-xs text-muted-foreground">
                Autorizado em {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                {" · "}
                {c.lastUsedAt ? `usado ${relativo(c.lastUsedAt)}` : "nunca usado"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => handleRevoke(c.id, c.clientName)}>
              Revogar
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
