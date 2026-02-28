"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { parseCsv, type ParseResult } from "@/lib/import/parse-csv"
import { parseXlsx } from "@/lib/import/parse-xlsx"
import { autoMapColumns } from "@/lib/import/map-columns"
import { validateRow, type RowValidation } from "@/lib/import/validate-row"

export type ImportStep = "upload" | "mapping" | "preview" | "executing" | "done"

export function useImport() {
  const [step, setStep] = useState<ImportStep>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [validations, setValidations] = useState<RowValidation[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState({ success: 0, errors: 0, total: 0 })

  async function handleFileSelect(f: File) {
    setFile(f)
    const isXlsx = f.name.endsWith(".xlsx") || f.name.endsWith(".xls")
    const result = isXlsx ? await parseXlsx(f) : await parseCsv(f)
    setParseResult(result)

    const mapping = autoMapColumns(result.headers)
    setColumnMapping(mapping)
    setStep("mapping")
  }

  function confirmMapping() {
    if (!parseResult) return

    const validationResults = parseResult.rows.map((row, idx) =>
      validateRow(row, columnMapping, idx)
    )
    setValidations(validationResults)
    setStep("preview")
  }

  async function executeImport() {
    if (!parseResult || !file) return

    setStep("executing")
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Create import history record
    const { data: importRecord } = await supabase
      .from("import_history")
      .insert({
        user_id: user.id,
        filename: file.name,
        file_type: file.name.endsWith(".xlsx") || file.name.endsWith(".xls") ? "xlsx" : "csv",
        row_count: validations.length,
        column_mapping: columnMapping,
        status: "processing",
      })
      .select()
      .single()

    let successCount = 0
    let errorCount = 0
    const importErrors: Record<string, unknown>[] = []

    // Batch insert, 50 at a time
    const validRows = validations.filter((v) => v.valid)
    const batchSize = 50

    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize)

      const inserts = await Promise.all(
        batch.map(async (row) => {
          const data = row.data

          // Auto-create company if current_company provided
          let companyId: string | null = null
          if (data.current_company) {
            const { data: existing } = await supabase
              .from("companies")
              .select("id")
              .eq("user_id", user.id)
              .ilike("name", data.current_company)
              .limit(1)

            if (existing && existing.length > 0) {
              companyId = existing[0].id
            } else {
              const { data: newCompany } = await supabase
                .from("companies")
                .insert({ name: data.current_company, user_id: user.id })
                .select("id")
                .single()
              companyId = newCompany?.id ?? null
            }
          }

          return {
            user_id: user.id,
            first_name: data.first_name || "Unknown",
            last_name: data.last_name || "",
            email: data.email || null,
            phone: data.phone || null,
            linkedin_url: data.linkedin_url || null,
            current_title: data.current_title || null,
            current_company: data.current_company || null,
            company_id: companyId,
            category: data.category || null,
            notes: data.notes || null,
            kanban_column_id: null,
            kanban_position: null,
          }
        })
      )

      const { error } = await supabase.from("people").insert(inserts)

      if (error) {
        errorCount += batch.length
        importErrors.push({ batch: i / batchSize, error: error.message })
      } else {
        successCount += batch.length
      }

      setProgress(Math.round(((i + batch.length) / validRows.length) * 100))
    }

    // Count invalid rows as errors
    errorCount += validations.filter((v) => !v.valid).length

    // Update import record
    if (importRecord) {
      await supabase
        .from("import_history")
        .update({
          success_count: successCount,
          error_count: errorCount,
          errors: importErrors,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", importRecord.id)
    }

    setResults({ success: successCount, errors: errorCount, total: validations.length })
    setStep("done")
  }

  function reset() {
    setStep("upload")
    setFile(null)
    setParseResult(null)
    setColumnMapping({})
    setValidations([])
    setProgress(0)
    setResults({ success: 0, errors: 0, total: 0 })
  }

  return {
    step,
    file,
    parseResult,
    columnMapping,
    setColumnMapping,
    validations,
    progress,
    results,
    handleFileSelect,
    confirmMapping,
    executeImport,
    reset,
  }
}
