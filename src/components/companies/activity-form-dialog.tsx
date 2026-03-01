"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { ACTIVITY_TYPES } from "@/lib/constants"

interface ActivityFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: { type: string; title: string; description?: string; date: string }) => Promise<unknown>
}

export function ActivityFormDialog({ open, onClose, onSubmit }: ActivityFormDialogProps) {
  const [type, setType] = useState("meeting")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16))
  const [saving, setSaving] = useState(false)

  const manualTypes = ACTIVITY_TYPES.filter(
    (t) => !["document_uploaded", "next_step_created"].includes(t.value)
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date) return

    setSaving(true)
    await onSubmit({
      type,
      title: title.trim(),
      description: description.trim() || undefined,
      date: new Date(date).toISOString(),
    })
    setSaving(false)
    setType("meeting")
    setTitle("")
    setDescription("")
    setDate(new Date().toISOString().slice(0, 16))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Activity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {manualTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="act-title">Title *</Label>
            <Input
              id="act-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Quarterly review meeting"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="act-desc">Description</Label>
            <Textarea
              id="act-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this activity..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="act-date">Date & Time *</Label>
            <Input
              id="act-date"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
