"use client"

import { useState } from "react"
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

  function handleSaveApiKey() {
    // In a real app, this would be stored securely server-side
    // For now we show it as a UI pattern
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
            Configure AI provider for data enrichment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Provider Configuration</p>
            <p>
              Set <code className="rounded bg-muted px-1 py-0.5">ENRICH_PROVIDER</code> in{" "}
              <code className="rounded bg-muted px-1 py-0.5">.env.local</code> to choose your provider:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">openai</code> (default) — Uses GPT-4o-mini. Set{" "}
                <code className="rounded bg-muted px-1 py-0.5">OPENAI_API_KEY</code>. Cheapest option (~$0.0002/company).
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">anthropic</code> — Uses Claude Haiku + web search. Set{" "}
                <code className="rounded bg-muted px-1 py-0.5">ANTHROPIC_API_KEY</code>. More accurate (~$0.06/company).
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
