"use client"

import { useState } from "react"
import { useCompanyActivities } from "@/hooks/use-company-activities"
import { ActivityFormDialog } from "./activity-form-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, MessageSquare, Phone, Mail, StickyNote, FileText, ListChecks, History } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ACTIVITY_TYPES } from "@/lib/constants"
import type { ActivityType } from "@/types/database"

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  meeting: MessageSquare,
  call: Phone,
  email: Mail,
  note: StickyNote,
  document_uploaded: FileText,
  next_step_created: ListChecks,
}

interface CompanyTimelineTabProps {
  companyId: string
}

export function CompanyTimelineTab({ companyId }: CompanyTimelineTabProps) {
  const { activities, loading, createActivity, deleteActivity } = useCompanyActivities(companyId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [quickNote, setQuickNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)

  async function handleQuickNote() {
    if (!quickNote.trim()) return
    setSavingNote(true)
    await createActivity({
      type: "note",
      title: quickNote.trim(),
      date: new Date().toISOString(),
    })
    setQuickNote("")
    setSavingNote(false)
  }

  function getActivityMeta(type: string) {
    return ACTIVITY_TYPES.find((t) => t.value === type) ?? { label: type, color: "#6b7280" }
  }

  const isAutoType = (type: string) => ["document_uploaded", "next_step_created"].includes(type)

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Quick note input */}
      <div className="space-y-2">
        <Textarea
          placeholder="Add a quick note..."
          value={quickNote}
          onChange={(e) => setQuickNote(e.target.value)}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleQuickNote()
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Ctrl+Enter to save</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add Activity
            </Button>
            <Button size="sm" onClick={handleQuickNote} disabled={savingNote || !quickNote.trim()}>
              Save Note
            </Button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <History className="h-10 w-10 mb-3" />
          <p className="text-sm">No activities yet.</p>
          <p className="text-xs">Add a note or log an activity to start the timeline.</p>
        </div>
      ) : (
        <div className="relative ml-3">
          {/* Vertical line */}
          <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

          <div className="space-y-4">
            {activities.map((activity) => {
              const meta = getActivityMeta(activity.type)
              const Icon = ACTIVITY_ICONS[activity.type] ?? StickyNote
              const auto = isAutoType(activity.type)

              return (
                <div key={activity.id} className="relative flex gap-3 pl-6">
                  {/* Dot */}
                  <div
                    className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-background flex items-center justify-center"
                    style={{ backgroundColor: meta.color }}
                  >
                    <Icon className="h-2.5 w-2.5 text-white" />
                  </div>

                  <div className={`flex-1 min-w-0 ${auto ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {meta.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(activity.date), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm font-medium mt-0.5">{activity.title}</p>
                        {activity.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{activity.description}</p>
                        )}
                      </div>
                      {!auto && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => deleteActivity(activity.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ActivityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={createActivity}
      />
    </div>
  )
}
