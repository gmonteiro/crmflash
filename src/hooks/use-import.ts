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
  const [results, setResults] = useState({ success: 0, errors: 0, skipped: 0, total: 0 })

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

    const rows = parseResult.rows

    // validateRow is pure string ops + one regex — sub-millisecond per row.
    const validationResults = rows.map((row, idx) =>
      validateRow(row, columnMapping, idx)
    )

    // Intra-file dedup: by email first, then by name+company for rows without email
    const seenEmails = new Set<string>()
    const seenNames = new Set<string>()
    for (const v of validationResults) {
      if (!v.valid) continue
      const email = v.data.email?.toLowerCase()
      if (email) {
        if (seenEmails.has(email)) {
          v.valid = false
          v.errors.push(`Duplicate email "${v.data.email}" in file`)
        } else {
          seenEmails.add(email)
        }
      } else {
        const nameKey = `${(v.data.first_name || "").toLowerCase()}|${(v.data.last_name || "").toLowerCase()}|${(v.data.current_company || "").toLowerCase()}`
        if (seenNames.has(nameKey)) {
          v.valid = false
          v.errors.push(`Duplicate person "${v.data.first_name} ${v.data.last_name}" in file`)
        } else {
          seenNames.add(nameKey)
        }
      }
    }

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

    const validRows = validations.filter((v) => v.valid)

    // --- Database dedup: skip people that already exist ---
    // Fetch all existing people (email + name+company) for this user
    const existingEmails = new Set<string>()
    const existingNames = new Set<string>()
    const { data: allPeople } = await supabase
      .from("people")
      .select("email, first_name, last_name, current_company")
      .eq("user_id", user.id)

    if (allPeople) {
      for (const p of allPeople) {
        if (p.email) existingEmails.add(p.email.toLowerCase())
        const nameKey = `${(p.first_name || "").toLowerCase()}|${(p.last_name || "").toLowerCase()}|${(p.current_company || "").toLowerCase()}`
        existingNames.add(nameKey)
      }
    }

    let skippedCount = 0
    const deduplicatedRows = validRows.filter((v) => {
      const email = v.data.email?.toLowerCase()
      if (email && existingEmails.has(email)) {
        skippedCount++
        return false
      }
      if (!email) {
        const nameKey = `${(v.data.first_name || "").toLowerCase()}|${(v.data.last_name || "").toLowerCase()}|${(v.data.current_company || "").toLowerCase()}`
        if (existingNames.has(nameKey)) {
          skippedCount++
          return false
        }
      }
      return true
    })

    // --- Pre-deduplicate companies (case-insensitive) ---
    const companyMap = new Map<string, string>() // lowercase name -> id

    // Fetch all existing companies for this user (single query, case-insensitive match)
    const { data: allCompanies } = await supabase
      .from("companies")
      .select("id, name")
      .eq("user_id", user.id)

    if (allCompanies) {
      for (const c of allCompanies) {
        companyMap.set(c.name.toLowerCase(), c.id)
      }
    }

    const uniqueCompanyNames = [
      ...new Set(
        deduplicatedRows
          .map((v) => v.data.current_company?.trim())
          .filter((name): name is string => !!name)
      ),
    ]

    const missingNames = uniqueCompanyNames.filter(
      (name) => !companyMap.has(name.toLowerCase())
    )

    if (missingNames.length > 0) {
      const insertChunkSize = 500
      for (let i = 0; i < missingNames.length; i += insertChunkSize) {
        const chunk = missingNames.slice(i, i + insertChunkSize)
        const { data: created } = await supabase
          .from("companies")
          .insert(chunk.map((name) => ({ name, user_id: user.id })))
          .select("id, name")

        if (created) {
          for (const c of created) {
            companyMap.set(c.name.toLowerCase(), c.id)
          }
        }
      }
    }

    // --- Batch insert people, 500 at a time ---
    const batchSize = 500

    for (let i = 0; i < deduplicatedRows.length; i += batchSize) {
      const batch = deduplicatedRows.slice(i, i + batchSize)

      const inserts = batch.map((row) => {
        const data = row.data
        const companyId = data.current_company
          ? companyMap.get(data.current_company.trim().toLowerCase()) ?? null
          : null

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

      const { error } = await supabase.from("people").insert(inserts)

      if (error) {
        errorCount += batch.length
        importErrors.push({ batch: i / batchSize, error: error.message })
      } else {
        successCount += batch.length
      }

      setProgress(Math.round(((i + batch.length) / deduplicatedRows.length) * 100))
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

    setResults({ success: successCount, errors: errorCount, skipped: skippedCount, total: validations.length })
    setStep("done")
  }

  function reset() {
    setStep("upload")
    setFile(null)
    setParseResult(null)
    setColumnMapping({})
    setValidations([])
    setProgress(0)
    setResults({ success: 0, errors: 0, skipped: 0, total: 0 })
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
