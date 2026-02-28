"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { KANBAN_COLORS } from "@/lib/constants"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface AddColumnDialogProps {
  onAdd: (title: string, color: string) => void
}

export function AddColumnDialog({ onAdd }: AddColumnDialogProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [color, setColor] = useState<string>(KANBAN_COLORS[0])

  function handleSubmit() {
    if (!title.trim()) return
    onAdd(title.trim(), color)
    setTitle("")
    setColor(KANBAN_COLORS[0])
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Add Column
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="col-title">Title</Label>
            <Input
              id="col-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="e.g., Follow Up"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {KANBAN_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    "h-8 w-8 rounded-full transition-transform",
                    c === color && "ring-2 ring-ring ring-offset-2 scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <Button onClick={handleSubmit} className="w-full" disabled={!title.trim()}>
            Create Column
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
