"use client"

import { use } from "react"
import { usePerson } from "@/hooks/use-people"
import { PersonDetailCard } from "@/components/people/person-detail-card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { person, loading, update, refetch } = usePerson(id)

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/people">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to People
        </Button>
      </Link>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : person ? (
        <PersonDetailCard person={person} onUpdate={update} onRefetch={refetch} />
      ) : (
        <p className="text-muted-foreground">Person not found.</p>
      )}
    </div>
  )
}
