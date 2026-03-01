"use client"

import { useState, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Upload, X } from "lucide-react"
import { DOCUMENT_TYPES, MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from "@/lib/constants"
import type { DocumentType } from "@/types/database"

interface DocumentUploadDialogProps {
  open: boolean
  onClose: () => void
  onUpload: (file: File, docType: DocumentType, description?: string) => Promise<unknown>
}

export function DocumentUploadDialog({ open, onClose, onUpload }: DocumentUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocumentType>("other")
  const [description, setDescription] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_SIZE) return "File too large. Maximum 10MB."
    if (!ALLOWED_FILE_TYPES.includes(f.type)) return "File type not allowed."
    return null
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const err = validateFile(f)
    if (err) {
      setError(err)
      setFile(null)
    } else {
      setError("")
      setFile(f)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (!f) return
    const err = validateFile(f)
    if (err) {
      setError(err)
      setFile(null)
    } else {
      setError("")
      setFile(f)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setUploading(true)
    await onUpload(file, docType, description.trim() || undefined)
    setUploading(false)
    setFile(null)
    setDocType("other")
    setDescription("")
    setError("")
    onClose()
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Drop zone */}
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">({formatSize(file.size)})</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click or drag & drop a file
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, DOCX, images, text, Excel — max 10MB
                </p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={ALLOWED_FILE_TYPES.join(",")}
              onChange={handleFileChange}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-desc">Description</Label>
            <Textarea
              id="doc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={uploading || !file}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
