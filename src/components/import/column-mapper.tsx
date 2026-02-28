"use client"

import { IMPORTABLE_FIELDS } from "@/lib/constants"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowRight } from "lucide-react"

interface ColumnMapperProps {
  headers: string[]
  mapping: Record<string, string>
  onMappingChange: (mapping: Record<string, string>) => void
  onConfirm: () => void
  sampleRow?: Record<string, string>
}

export function ColumnMapper({
  headers,
  mapping,
  onMappingChange,
  onConfirm,
  sampleRow,
}: ColumnMapperProps) {
  function updateMapping(header: string, field: string) {
    onMappingChange({ ...mapping, [header]: field })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map Columns</CardTitle>
        <p className="text-sm text-muted-foreground">
          Match your file columns to CRM fields. Columns are auto-detected when possible.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {headers.map((header) => (
          <div key={header} className="flex items-center gap-3">
            <div className="w-1/3">
              <p className="text-sm font-medium">{header}</p>
              {sampleRow && (
                <p className="text-xs text-muted-foreground truncate">
                  e.g.: {sampleRow[header] || "(empty)"}
                </p>
              )}
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Select
              value={mapping[header] || "__skip__"}
              onValueChange={(val) => updateMapping(header, val)}
            >
              <SelectTrigger className="w-1/3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPORTABLE_FIELDS.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        <div className="pt-4">
          <Button onClick={onConfirm}>
            Continue to Preview
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
