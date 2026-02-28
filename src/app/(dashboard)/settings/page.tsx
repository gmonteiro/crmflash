"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "next-themes"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Sparkles, Palette, Key } from "lucide-react"

type KeyStatus = Record<"openai" | "anthropic" | "perplexity" | "exa", boolean>

const KEY_LABELS: Record<keyof KeyStatus, { name: string; env: string }> = {
  openai: { name: "OpenAI", env: "OPENAI_API_KEY" },
  anthropic: { name: "Anthropic", env: "ANTHROPIC_API_KEY" },
  perplexity: { name: "Perplexity", env: "PERPLEXITY_API_KEY" },
  exa: { name: "Exa", env: "EXA_API_KEY" },
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [provider, setProvider] = useState("openai")
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem("enrichProvider")
    if (stored === "openai" || stored === "anthropic" || stored === "perplexity" || stored === "exa") setProvider(stored)
  }, [])

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setKeyStatus(data) })
      .catch(() => {})
  }, [])

  function handleProviderChange(value: string) {
    setProvider(value)
    localStorage.setItem("enrichProvider", value)
    const labels: Record<string, string> = {
      openai: "OpenAI GPT-4o-mini",
      anthropic: "Anthropic Claude Haiku",
      perplexity: "Perplexity Sonar",
      exa: "Exa Answer",
    }
    toast.success(`Enrichment provider switched to ${labels[value] ?? value}`)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Appearance
          </CardTitle>
          <CardDescription>Customize the look and feel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Enrichment Provider
          </CardTitle>
          <CardDescription>
            Choose which AI model to use for data enrichment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="w-[300px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI GPT-4o-mini — fast, ~$0.0002/company</SelectItem>
                <SelectItem value="anthropic">Anthropic Claude Haiku — web search, ~$0.06/company</SelectItem>
                <SelectItem value="perplexity">Perplexity Sonar — web search, ~$0.006/company</SelectItem>
                <SelectItem value="exa">Exa Answer — web search, ~$0.005/company</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {provider === "openai" && "Uses model training data only. Cheapest option, great for most use cases."}
              {provider === "anthropic" && "Uses live web search for up-to-date results. More accurate but ~300x more expensive."}
              {provider === "perplexity" && "Uses Perplexity Sonar with built-in web search. Good balance of cost and accuracy."}
              {provider === "exa" && "Uses Exa Answer with web citations. Good balance of cost and accuracy."}
            </p>
          </div>
          <Separator />
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Key Status
            </Label>
            <div className="grid gap-2">
              {(Object.entries(KEY_LABELS) as [keyof KeyStatus, { name: string; env: string }][]).map(([key, { name, env }]) => (
                <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{name}</span>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">{env}</code>
                  </div>
                  {keyStatus ? (
                    keyStatus[key] ? (
                      <Badge variant="outline" className="border-green-600 text-green-600">Configured</Badge>
                    ) : (
                      <Badge variant="outline" className="border-red-600 text-red-600">Missing</Badge>
                    )
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Loading...</Badge>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              API keys are set via environment variables on the server (.env.local or hosting provider).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
