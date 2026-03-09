"use client"

import { useState } from "react"
import { useShortlists } from "@/hooks/use-shortlists"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import type { ShortlistEntityType } from "@/types/database"

interface AddToShortlistDialogProps {
  open: boolean
  onClose: () => void
  entityType: ShortlistEntityType
  selectedIds: string[]
  onDone: () => void
}

export function AddToShortlistDialog({
  open,
  onClose,
  entityType,
  selectedIds,
  onDone,
}: AddToShortlistDialogProps) {
  const { shortlists, loading, createShortlist, addMembers } = useShortlists(entityType)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState("")
  const [saving, setSaving] = useState(false)

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    let targetIds = [...checked]

    // Create new shortlist if name is provided
    if (newName.trim()) {
      const created = await createShortlist(newName.trim())
      if (created) {
        targetIds.push(created.id)
      } else {
        toast.error("Failed to create shortlist")
        setSaving(false)
        return
      }
    }

    if (targetIds.length === 0) {
      toast.error("Select at least one shortlist or create a new one")
      setSaving(false)
      return
    }

    let allOk = true
    for (const slId of targetIds) {
      const ok = await addMembers(slId, selectedIds)
      if (!ok) allOk = false
    }

    setSaving(false)
    if (allOk) {
      toast.success(`Added ${selectedIds.length} item(s) to ${targetIds.length} shortlist(s)`)
    } else {
      toast.error("Some items could not be added")
    }

    setChecked(new Set())
    setNewName("")
    onDone()
    onClose()
  }

  const handleClose = () => {
    setChecked(new Set())
    setNewName("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Shortlist</DialogTitle>
          <DialogDescription>
            Add {selectedIds.length} selected {entityType === "person" ? "contact(s)" : "company(ies)"} to shortlists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shortlists.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No shortlists yet. Create one below.</p>
          ) : (
            shortlists.map((sl) => (
              <label
                key={sl.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  checked={checked.has(sl.id)}
                  onCheckedChange={() => toggle(sl.id)}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{sl.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({sl.member_count ?? 0})
                  </span>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="New shortlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || (checked.size === 0 && !newName.trim())}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
