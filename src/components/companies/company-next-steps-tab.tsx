"use client"

import { useState } from "react"
import { useCompanyNextSteps } from "@/hooks/use-company-next-steps"
import { NextStepFormDialog } from "./next-step-form-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, ListChecks } from "lucide-react"
import { isBefore, parseISO, format } from "date-fns"

interface CompanyNextStepsTabProps {
  companyId: string
}

export function CompanyNextStepsTab({ companyId }: CompanyNextStepsTabProps) {
  const { pending, completed, loading, createStep, toggleComplete, deleteStep } = useCompanyNextSteps(companyId)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function isOverdue(dueDate: string | null) {
    if (!dueDate) return false
    return isBefore(parseISO(dueDate), today)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {pending.length} pending{completed.length > 0 ? `, ${completed.length} completed` : ""}
        </h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Step
        </Button>
      </div>

      {pending.length === 0 && completed.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <ListChecks className="h-10 w-10 mb-3" />
          <p className="text-sm">No next steps yet.</p>
          <p className="text-xs">Create one to track your action items.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((step) => (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/50"
            >
              <Checkbox
                checked={false}
                onCheckedChange={() => toggleComplete(step.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                {step.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                )}
                {step.due_date && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      Due {format(parseISO(step.due_date), "MMM d, yyyy")}
                    </span>
                    {isOverdue(step.due_date) && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Overdue</Badge>
                    )}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteStep(step.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completed</p>
          {completed.map((step) => (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-md border p-3 opacity-60"
            >
              <Checkbox
                checked={true}
                onCheckedChange={() => toggleComplete(step.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-through">{step.title}</p>
                {step.due_date && (
                  <span className="text-xs text-muted-foreground">
                    Due {format(parseISO(step.due_date), "MMM d, yyyy")}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteStep(step.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <NextStepFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={createStep}
      />
    </div>
  )
}
