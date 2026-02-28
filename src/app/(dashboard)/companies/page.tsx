"use client"

import { useState, useCallback } from "react"
import { useCompanies } from "@/hooks/use-companies"
import { useBulkEnrich } from "@/hooks/use-enrich"
import { createClient } from "@/lib/supabase/client"
import { CompanyTable } from "@/components/companies/company-table"
import { CompanyForm } from "@/components/companies/company-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INDUSTRIES } from "@/lib/constants"
import { Search, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { CompanyFormData } from "@/lib/validators"
import type { Company } from "@/types/database"

function isUnenriched(c: Company) {
  return (
    c.industry === null &&
    c.description === null &&
    c.employee_count === null &&
    c.estimated_revenue === null &&
    c.size_tier === null
  )
}

export default function CompaniesPage() {
  const [search, setSearch] = useState("")
  const [industry, setIndustry] = useState("all")
  const [page, setPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)

  const { companies, loading, pageCount, refetch, createCompany, deleteCompany } = useCompanies({
    search: search || undefined,
    industry: industry !== "all" ? industry : undefined,
    page,
  })

  const bulk = useBulkEnrich()

  const handleCreate = useCallback(async (data: CompanyFormData) => {
    const company = await createCompany(data)
    if (company) toast.success("Company created")
    else toast.error("Failed to create company")
  }, [createCompany])

  const handleDelete = useCallback(async (id: string) => {
    const success = await deleteCompany(id)
    if (success) toast.success("Company deleted")
    else toast.error("Failed to delete company")
  }, [deleteCompany])

  const handleEnrichAll = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("companies")
      .select("id, name, industry, description, employee_count, estimated_revenue, size_tier")

    if (!data || data.length === 0) {
      toast.error("No companies found")
      return
    }

    const unenriched = (data as Company[]).filter(isUnenriched)

    if (unenriched.length === 0) {
      toast.info("All companies are already enriched")
      return
    }

    setEnrichOpen(true)
    await bulk.run(unenriched.map((c) => ({ id: c.id, name: c.name })))
  }, [bulk])

  const handleEnrichClose = useCallback(() => {
    setEnrichOpen(false)
    refetch()
  }, [refetch])

  const enrichPercent = bulk.total > 0 ? Math.round((bulk.current / bulk.total) * 100) : 0

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Companies</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="pl-8"
            />
          </div>
          <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(0) }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Industry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Industries</SelectItem>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind}>
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEnrichAll} disabled={bulk.running}>
            <Sparkles className="mr-2 h-4 w-4" />
            Enrich All
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Company
          </Button>
        </div>
      </div>

      <CompanyTable
        companies={companies}
        loading={loading}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        onDelete={handleDelete}
      />

      <CompanyForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />

      <Dialog open={enrichOpen} onOpenChange={(open) => { if (!open && !bulk.running) handleEnrichClose() }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Enriching Companies</DialogTitle>
            <DialogDescription>
              {bulk.running
                ? `Processing ${bulk.current} of ${bulk.total}...`
                : `Completed — ${bulk.succeeded} succeeded, ${bulk.failed} failed`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Progress value={enrichPercent} />
            {bulk.running && bulk.currentName && (
              <p className="text-sm text-muted-foreground truncate">
                Enriching: {bulk.currentName}
              </p>
            )}
            <div className="flex gap-4 text-sm">
              <span className="text-green-600">Succeeded: {bulk.succeeded}</span>
              <span className="text-red-600">Failed: {bulk.failed}</span>
            </div>
          </div>
          <DialogFooter>
            {bulk.running ? (
              <Button variant="outline" onClick={bulk.cancel}>
                Cancel
              </Button>
            ) : (
              <Button onClick={handleEnrichClose}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
