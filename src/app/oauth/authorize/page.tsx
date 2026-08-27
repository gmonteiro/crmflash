import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getClient } from "@/lib/oauth/store"
import { validateAuthorizeParams } from "@/app/api/oauth/approve/route"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v)
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const client = await getClient(params.get("client_id") ?? "")
  const parsed = validateAuthorizeParams(params, client)

  if (!parsed.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Pedido inválido</CardTitle>
            <CardDescription>{parsed.error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Conectar {client!.client_name} ao CRMFlash</CardTitle>
          <CardDescription>Autorizando como {user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p className="font-medium">Esta conexão vai poder:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Ler seu pipeline, empresas, pessoas e próximos passos</li>
              <li>Registrar atividades, próximos passos e sinais</li>
              <li>Mover empresas de estágio no funil</li>
              <li>Cadastrar empresa ou pessoa nova</li>
            </ul>
            <p className="pt-2 font-medium">Não vai poder:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Apagar nada</li>
              <li>Ver dados de outro workspace</li>
            </ul>
          </div>

          <form method="POST" action="/api/oauth/approve" className="space-y-2">
            {[...params.entries()].map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button type="submit" className="w-full">
              Autorizar
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Você pode revogar a qualquer momento em Configurações.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
