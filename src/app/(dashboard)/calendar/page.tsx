"use client"

import { CalendarView } from "@/components/calendar/calendar-view"

export default function CalendarPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">Calendar</h1>
      <CalendarView />
    </div>
  )
}
