"use client"

import { Button } from "@/components/ui/button"
import { Sparkles, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useEnrich } from "@/hooks/use-enrich"
import { ReasoningPanel } from "./reasoning-panel"

interface EnrichButtonProps {
  type: "person" | "company"
  id: string
  onEnriched?: () => void
}

export function EnrichButton({ type, id, onEnriched }: EnrichButtonProps) {
  const { enrichPerson, enrichCompany, loading, reasoning, clearReasoning } = useEnrich()

  async function handleEnrich() {
    clearReasoning()
    const success = type === "person"
      ? await enrichPerson(id)
      : await enrichCompany(id)

    if (success) {
      toast.success("Enriched successfully with AI")
      onEnriched?.()
    } else {
      toast.error("Failed to enrich. Check your API key configuration.")
    }
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleEnrich}
        disabled={loading}
        title="Enrich with AI"
      >
        {loading ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-4 w-4" />
        )}
        Enrich
      </Button>
      <ReasoningPanel reasoning={reasoning} loading={loading} />
    </div>
  )
}
