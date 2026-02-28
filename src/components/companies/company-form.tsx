"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { companySchema, type CompanyFormData } from "@/lib/validators"
import { INDUSTRIES, SIZE_TIERS } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Loader2 } from "lucide-react"

interface CompanyFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CompanyFormData) => Promise<void>
  defaultValues?: Partial<CompanyFormData>
  title?: string
}

export function CompanyForm({
  open,
  onClose,
  onSubmit,
  defaultValues,
  title = "Add Company",
}: CompanyFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      domain: "",
      linkedin_url: "",
      industry: "",
      size_tier: null,
      estimated_revenue: null,
      employee_count: null,
      description: "",
      website: "",
      ...defaultValues,
    },
  })

  async function handleFormSubmit(data: CompanyFormData) {
    await onSubmit(data)
    reset()
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="mt-6 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Company Name *</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Industry</Label>
            <Select
              value={watch("industry") || ""}
              onValueChange={(val) => setValue("industry", val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((ind) => (
                  <SelectItem key={ind} value={ind}>
                    {ind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Size Tier</Label>
            <Select
              value={watch("size_tier") || ""}
              onValueChange={(val) => setValue("size_tier", val as CompanyFormData["size_tier"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {SIZE_TIERS.map((tier) => (
                  <SelectItem key={tier.value} value={tier.value}>
                    {tier.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="employee_count">Employees</Label>
              <Input id="employee_count" type="number" {...register("employee_count")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="estimated_revenue">Revenue ($)</Label>
              <Input id="estimated_revenue" type="number" {...register("estimated_revenue")} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="website">Website</Label>
            <Input id="website" {...register("website")} placeholder="https://..." />
          </div>

          <div className="space-y-1">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" {...register("domain")} placeholder="example.com" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="linkedin_url">LinkedIn URL</Label>
            <Input id="linkedin_url" {...register("linkedin_url")} placeholder="https://linkedin.com/company/..." />
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
