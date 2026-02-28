"use client"

import { useState, useRef, useEffect } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ReasoningPanelProps {
  reasoning: string
  loading?: boolean
  className?: string
}

export function ReasoningPanel({ reasoning, loading, className }: ReasoningPanelProps) {
  const [open, setOpen] = useState(true)
  const scrollRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [reasoning])

  if (!reasoning && !loading) return null

  return (
    <div className={cn("rounded-md border bg-muted/50 min-h-0 flex flex-col", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground shrink-0"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Brain className="h-3.5 w-3.5" />
        AI Reasoning
        {loading && !reasoning && (
          <span className="ml-auto text-xs animate-pulse">thinking...</span>
        )}
      </button>
      {open && (
        <pre
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 text-xs text-muted-foreground"
        >
          {reasoning || (loading ? "thinking..." : "")}
        </pre>
      )}
    </div>
  )
}
