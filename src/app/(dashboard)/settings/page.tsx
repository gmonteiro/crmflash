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
      toast.success("API key saved. Set ANTHROPIC_API_KEY in .env.local for server-side access.")
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
            AI Enrichment
          </CardTitle>
          <CardDescription>
            Configure Claude API for AI-powered data enrichment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="anthropic-key" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              Anthropic API Key
            </Label>
            <div className="flex gap-2">
              <Input
                id="anthropic-key"
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setSaved(false) }}
                placeholder="Enter your Anthropic API key"
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
            <p>Get your API key from <span className="font-medium">console.anthropic.com</span></p>
            <p>Set the <code className="rounded bg-muted px-1 py-0.5">ANTHROPIC_API_KEY</code> environment variable in your <code className="rounded bg-muted px-1 py-0.5">.env.local</code> file for server-side enrichment.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
