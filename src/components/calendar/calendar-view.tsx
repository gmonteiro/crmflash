"use client"

import { useState } from "react"
import { useCalendar } from "@/hooks/use-calendar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react"
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  isBefore,
  addMonths,
  subMonths,
} from "date-fns"
import Link from "next/link"
import type { CompanyNextStep } from "@/types/database"

export function CalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const { stepsByDate, loading, toggleComplete } = useCalendar(currentMonth)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart)
  const calEnd = endOfWeek(monthEnd)
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const selectedSteps = selectedDate ? (stepsByDate[selectedDate] ?? []) : []

  function isOverdue(step: CompanyNextStep) {
    return step.status === "pending" && step.due_date && isBefore(new Date(step.due_date), today)
  }

  if (loading) {
    return <Skeleton className="h-96 w-full" />
  }

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">{format(currentMonth, "MMMM yyyy")}</h2>
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px rounded-lg border bg-border overflow-hidden">
        {/* Day headers */}
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {day}
          </div>
        ))}

        {/* Day cells */}
        {days.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd")
          const daySteps = stepsByDate[dateKey] ?? []
          const inMonth = isSameMonth(day, currentMonth)
          const isSelected = selectedDate === dateKey
          const pendingCount = daySteps.filter((s) => s.status === "pending").length
          const completedCount = daySteps.filter((s) => s.status === "completed").length
          const overdueCount = daySteps.filter((s) => isOverdue(s)).length

          return (
            <button
              key={dateKey}
              onClick={() => setSelectedDate(isSelected ? null : dateKey)}
              className={`bg-background min-h-[72px] p-1.5 text-left transition-colors hover:bg-muted/50 ${
                !inMonth ? "opacity-40" : ""
              } ${isSelected ? "ring-2 ring-primary ring-inset" : ""}`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday(day) ? "bg-primary text-primary-foreground font-bold" : ""
                }`}
              >
                {format(day, "d")}
              </span>
              {daySteps.length > 0 && (
                <div className="flex gap-0.5 mt-1 flex-wrap">
                  {overdueCount > 0 && (
                    <span className="h-2 w-2 rounded-full bg-destructive" />
                  )}
                  {pendingCount - overdueCount > 0 && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                  {completedCount > 0 && (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3">
              {format(new Date(selectedDate + "T00:00:00"), "EEEE, MMMM d, yyyy")}
            </h3>
            {selectedSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No next steps on this date.</p>
            ) : (
              <div className="space-y-2">
                {selectedSteps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      checked={step.status === "completed"}
                      onCheckedChange={() => toggleComplete(step.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${step.status === "completed" ? "line-through opacity-60" : ""}`}>
                          {step.title}
                        </p>
                        {isOverdue(step) && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Overdue</Badge>
                        )}
                      </div>
                      {step.company && (
                        <Link
                          href={`/companies/${step.company.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {step.company.name}
                        </Link>
                      )}
                      {step.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state if no steps at all this month */}
      {Object.keys(stepsByDate).length === 0 && !selectedDate && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <CalendarDays className="h-10 w-10 mb-3" />
          <p className="text-sm">No next steps scheduled this month.</p>
        </div>
      )}
    </div>
  )
}
