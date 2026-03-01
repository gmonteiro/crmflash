"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"

interface NextStepFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: { title: string; description?: string; due_date?: string }) => Promise<unknown>
}

export function NextStepFormDialog({ open, onClose, onSubmit }: NextStepFormDialogProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    setSaving(true)
    await onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      due_date: dueDate || undefined,
    })
    setSaving(false)
    setTitle("")
    setDescription("")
    setDueDate("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Next Step</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ns-title">Title *</Label>
            <Input
              id="ns-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send follow-up proposal"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-desc">Description</Label>
            <Textarea
              id="ns-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details about this step..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-due">Due Date</Label>
            <Input
              id="ns-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Step
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
