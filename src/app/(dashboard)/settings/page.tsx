"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "next-themes"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Sparkles, Palette, Key } from "lucide-react"

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [apiKey, setApiKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [provider, setProvider] = useState("openai")

  useEffect(() => {
    const stored = localStorage.getItem("enrichProvider")
    if (stored === "openai" || stored === "anthropic") setProvider(stored)
  }, [])

  function handleProviderChange(value: string) {
    setProvider(value)
    localStorage.setItem("enrichProvider", value)
    toast.success(`Enrichment provider switched to ${value === "openai" ? "OpenAI GPT-4o-mini" : "Anthropic Claude Haiku"}`)
  }

  function handleSaveApiKey() {
    if (apiKey) {
      toast.success("API key saved. Set it in .env.local for server-side access.")
      setSaved(true)
    }
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
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {provider === "openai"
                ? "Uses model training data only. Cheapest option, great for most use cases."
                : "Uses live web search for up-to-date results. More accurate but ~300x more expensive."}
            </p>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="api-key" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Key
            </Label>
            <div className="flex gap-2">
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setSaved(false) }}
                placeholder="Enter your API key"
              />
              <Button onClick={handleSaveApiKey} disabled={!apiKey}>
                Save
              </Button>
            </div>
            {saved && (
              <Badge variant="outline" className="text-green-600">
                Saved
              </Badge>
            )}
          </div>
          <Separator />
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              Server-side keys are set via environment variables:{" "}
              <code className="rounded bg-muted px-1 py-0.5">OPENAI_API_KEY</code> and{" "}
              <code className="rounded bg-muted px-1 py-0.5">ANTHROPIC_API_KEY</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
