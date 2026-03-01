"use client"

import { useImport } from "@/hooks/use-import"
import { FileUploadZone } from "@/components/import/file-upload-zone"
import { ColumnMapper } from "@/components/import/column-mapper"
import { ImportPreview } from "@/components/import/import-preview"
import { ImportProgress } from "@/components/import/import-progress"
import { Loader2 } from "lucide-react"

export default function ImportPage() {
  const {
    step,
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
  } = useImport()

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Import Contacts</h1>

      {/* Step indicators */}
      <div className="flex gap-2 text-sm">
        {["Upload", "Map Columns", "Preview", "Import"].map((label, idx) => {
          const stepMap = ["upload", "mapping", "preview", "executing"]
          const currentIdx = stepMap.indexOf(
            step === "done" ? "executing" : step === "validating" ? "mapping" : step
          )
          const isActive = idx <= currentIdx
          return (
            <div
              key={label}
              className={`flex items-center gap-1 ${
                isActive ? "text-primary font-medium" : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {idx + 1}
              </span>
              {label}
              {idx < 3 && <span className="mx-2 text-muted-foreground">/</span>}
            </div>
          )
        })}
      </div>

      {step === "upload" && (
        <FileUploadZone onFileSelect={handleFileSelect} />
      )}

      {step === "mapping" && parseResult && (
        <ColumnMapper
          headers={parseResult.headers}
          mapping={columnMapping}
          onMappingChange={setColumnMapping}
          onConfirm={confirmMapping}
          sampleRow={parseResult.rows[0]}
        />
      )}

      {step === "validating" && (
        <div className="flex items-center gap-3 rounded-lg border p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-sm text-muted-foreground">
            Validating and checking for duplicates...
          </p>
        </div>
      )}

      {step === "preview" && (
        <ImportPreview
          validations={validations}
          onExecute={executeImport}
          onBack={() => reset()}
        />
      )}

      {(step === "executing" || step === "done") && (
        <ImportProgress
          progress={progress}
          done={step === "done"}
          results={results}
          onReset={reset}
        />
      )}
    </div>
  )
}
