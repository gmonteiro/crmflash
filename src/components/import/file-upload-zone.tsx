"use client"

import { useCallback } from "react"
import { Upload, FileSpreadsheet } from "lucide-react"

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void
}

export function FileUploadZone({ onFileSelect }: FileUploadZoneProps) {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
    },
    [onFileSelect]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
    },
    [onFileSelect]
  )

  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 transition-colors hover:border-muted-foreground/50"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Upload className="mb-4 h-12 w-12 text-muted-foreground/50" />
      <h3 className="mb-2 text-lg font-semibold">Drop your file here</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Supports CSV and XLSX files
      </p>
      <label className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        Browse Files
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleChange}
          className="hidden"
        />
      </label>
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <FileSpreadsheet className="h-4 w-4" />
        .csv, .xlsx
      </div>
    </div>
  )
}

function isValidFile(file: File): boolean {
  const validTypes = [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ]
  const validExtensions = [".csv", ".xlsx", ".xls"]
  return (
    validTypes.includes(file.type) ||
    validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
  )
}
