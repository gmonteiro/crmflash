"use client"

import { useState, useCallback } from "react"
import { useCompanies } from "@/hooks/use-companies"
import { CompanyTable } from "@/components/companies/company-table"
import { CompanyForm } from "@/components/companies/company-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INDUSTRIES } from "@/lib/constants"
import { Search, Plus } from "lucide-react"
import { toast } from "sonner"
import type { CompanyFormData } from "@/lib/validators"

export default function CompaniesPage() {
  const [search, setSearch] = useState("")
  const [industry, setIndustry] = useState("all")
  const [page, setPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)

  const { companies, loading, pageCount, createCompany, deleteCompany } = useCompanies({
    search: search || undefined,
    industry: industry !== "all" ? industry : undefined,
    page,
  })

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
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Company
        </Button>
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
    </div>
  )
}
