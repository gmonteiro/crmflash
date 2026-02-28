"use client"

import { Button } from "@/components/ui/button"
import { Sparkles, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useEnrich } from "@/hooks/use-enrich"

interface EnrichButtonProps {
  type: "person" | "company"
  id: string
  onEnriched?: () => void
}

export function EnrichButton({ type, id, onEnriched }: EnrichButtonProps) {
  const { enrichPerson, enrichCompany, loading } = useEnrich()

  async function handleEnrich() {
    const success = type === "person"
      ? await enrichPerson(id)
      : await enrichCompany(id)

    if (success) {
      toast.success("Enriched successfully with AI")
      onEnriched?.()
    } else {
      toast.error("Failed to enrich. Check your ANTHROPIC_API_KEY.")
    }
  }

  return (
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
  )
}
