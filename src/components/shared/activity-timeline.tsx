"use client"

import { useState } from "react"
import { useActivities } from "@/hooks/use-activities"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Video,
  Phone,
  Mail,
  StickyNote,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Users,
  Volume2,
} from "lucide-react"
import { format } from "date-fns"
import type { Activity } from "@/types/database"

interface ActivityTimelineProps {
  personId?: string
  companyId?: string
}

const TYPE_ICON: Record<string, typeof Video> = {
  meeting: Video,
  call: Phone,
  email: Mail,
  note: StickyNote,
}

const TYPE_COLOR: Record<string, string> = {
  meeting: "bg-blue-500",
  call: "bg-green-500",
  email: "bg-orange-500",
  note: "bg-gray-500",
}

function ActivityItem({ activity }: { activity: Activity }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = TYPE_ICON[activity.type] || StickyNote
  const dotColor = TYPE_COLOR[activity.type] || "bg-gray-500"
  const isFromTranscriptionApp = activity.source === "transcription_app"

  const hasSummary = activity.summary?.executive_summary
  const hasSpeakers = activity.speakers && activity.speakers.length > 0
  const hasTranscript = !!activity.transcript
  const hasExpandableContent = hasSummary || hasSpeakers || hasTranscript

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border last:hidden" />

      {/* Dot */}
      <div className={`relative mt-1 h-6 w-6 shrink-0 rounded-full ${dotColor} flex items-center justify-center`}>
        <Icon className="h-3 w-3 text-white" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{activity.title}</p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(activity.date), "MMM d, yyyy 'at' HH:mm")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isFromTranscriptionApp && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                TranscriptionApp
              </Badge>
            )}
            {activity.source_app_url && (
              <a
                href={activity.source_app_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {activity.description && (
          <p className="text-sm text-muted-foreground mt-1">{activity.description}</p>
        )}

        {hasExpandableContent && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-2 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1 h-3 w-3" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-3 w-3" />
                Details
              </>
            )}
          </Button>
        )}

        {expanded && (
          <div className="mt-2 space-y-3">
            {hasSummary && (
              <div className="rounded-lg bg-muted/50 p-3">
                <h5 className="text-xs font-medium mb-1">Summary</h5>
                <p className="text-sm text-muted-foreground">{activity.summary!.executive_summary}</p>
                {activity.summary!.action_items && activity.summary!.action_items.length > 0 && (
                  <div className="mt-2">
                    <h6 className="text-xs font-medium mb-1">Action Items</h6>
                    <ul className="space-y-0.5">
                      {activity.summary!.action_items.map((item, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                          <span className="text-primary shrink-0">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {hasSpeakers && (
              <div className="rounded-lg bg-muted/50 p-3">
                <h5 className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Speakers
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {activity.speakers!.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {s.name || s.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {hasTranscript && (
              <div className="rounded-lg bg-muted/50 p-3">
                <h5 className="text-xs font-medium mb-1">Transcript</h5>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {activity.transcript}
                </p>
              </div>
            )}

            {activity.audio_url && (
              <a
                href={activity.audio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Volume2 className="h-3 w-3" />
                Play audio
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ActivityTimeline({ personId, companyId }: ActivityTimelineProps) {
  const { activities, loading } = useActivities({ personId, companyId })

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 bg-muted animate-pulse rounded" />
              <div className="h-3 w-32 bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No activities yet.</p>
        <p className="text-xs mt-1">Activities from TranscriptionApp will appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  )
}
