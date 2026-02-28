"use client"

import { use } from "react"
import { CompanyDetailCard } from "@/components/companies/company-detail-card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/companies">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Companies
        </Button>
      </Link>

      <CompanyDetailCard companyId={id} />
    </div>
  )
}
