"use client"

import { useState } from "react"
import { useCompanyDocuments } from "@/hooks/use-company-documents"
import { DocumentUploadDialog } from "./document-upload-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Upload, Download, Trash2, FileText, FileSpreadsheet, Image, File } from "lucide-react"
import { format, parseISO } from "date-fns"
import { DOCUMENT_TYPES } from "@/lib/constants"
import type { CompanyDocument } from "@/types/database"

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet
  if (mimeType.includes("pdf") || mimeType.includes("word")) return FileText
  return File
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface CompanyDocumentsTabProps {
  companyId: string
}

export function CompanyDocumentsTab({ companyId }: CompanyDocumentsTabProps) {
  const { documents, loading, uploadDocument, downloadDocument, deleteDocument } = useCompanyDocuments(companyId)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  function getDocTypeLabel(docType: string) {
    return DOCUMENT_TYPES.find((t) => t.value === docType)?.label ?? docType
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {documents.length} document{documents.length !== 1 ? "s" : ""}
        </h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Upload className="mr-1 h-4 w-4" />
          Upload
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mb-3" />
          <p className="text-sm">No documents yet.</p>
          <p className="text-xs">Upload contracts, proposals, or other files.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const Icon = getFileIcon(doc.mime_type)
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {getDocTypeLabel(doc.doc_type)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatSize(doc.file_size)}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(doc.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  {doc.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{doc.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => downloadDocument(doc)}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteDocument(doc)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <DocumentUploadDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onUpload={uploadDocument}
      />
    </div>
  )
}
