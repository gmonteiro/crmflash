"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import type { RowValidation } from "@/lib/import/validate-row"

interface ImportPreviewProps {
  validations: RowValidation[]
  onExecute: () => void
  onBack: () => void
}

export function ImportPreview({ validations, onExecute, onBack }: ImportPreviewProps) {
  const validCount = validations.filter((v) => v.valid).length
  const errorCount = validations.filter((v) => !v.valid).length
  const preview = validations.slice(0, 10)
  const fields = preview.length > 0 ? Object.keys(preview[0].data) : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview Import</CardTitle>
        <div className="flex gap-3 text-sm">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            {validCount} valid
          </span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1">
              <AlertCircle className="h-4 w-4 text-destructive" />
              {errorCount} errors
            </span>
          )}
          <span className="text-muted-foreground">
            {validations.length} total rows
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="w-20">Status</TableHead>
                {fields.map((f) => (
                  <TableHead key={f}>{f}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row, idx) => (
                <TableRow key={idx} className={!row.valid ? "bg-destructive/5" : undefined}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    {row.valid ? (
                      <Badge variant="outline" className="text-green-600">OK</Badge>
                    ) : (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </TableCell>
                  {fields.map((f) => (
                    <TableCell key={f} className="text-sm max-w-[200px] truncate">
                      {row.data[f] || "-"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {errorCount > 0 && (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive mb-1">Validation Errors:</p>
            <ul className="text-xs text-destructive space-y-0.5 max-h-32 overflow-auto">
              {validations
                .filter((v) => !v.valid)
                .slice(0, 20)
                .flatMap((v) => v.errors.map((e, i) => <li key={i}>{e}</li>))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onExecute} disabled={validCount === 0}>
            Import {validCount} Contacts
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
