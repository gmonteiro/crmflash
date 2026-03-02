"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CompanyDocument, DocumentType } from "@/types/database"

export function useCompanyDocuments(companyId: string) {
  const [documents, setDocuments] = useState<CompanyDocument[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("company_documents")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200)

    if (data) setDocuments(data)
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const uploadDocument = useCallback(async (
    file: File,
    docType: DocumentType,
    description?: string
  ) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const fileId = crypto.randomUUID()
    // Sanitize filename: remove path separators and dangerous chars
    const safeName = file.name.replace(/[/\\:*?"<>|]/g, "_").replace(/\.{2,}/g, "_")
    const filePath = `${user.id}/${companyId}/${fileId}_${safeName}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("company-documents")
      .upload(filePath, file)

    if (uploadError) return null

    // Create metadata row
    const { data: doc, error } = await supabase
      .from("company_documents")
      .insert({
        user_id: user.id,
        company_id: companyId,
        name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        doc_type: docType,
        description: description || null,
      })
      .select()
      .single()

    if (error || !doc) return null

    setDocuments((prev) => [doc, ...prev])

    // Auto-create timeline activity
    await supabase.from("company_activities").insert({
      user_id: user.id,
      company_id: companyId,
      type: "document_uploaded",
      title: `Document uploaded: ${file.name}`,
      date: new Date().toISOString(),
    })

    return doc
  }, [companyId])

  const downloadDocument = useCallback(async (doc: CompanyDocument) => {
    const supabase = createClient()
    const { data } = await supabase.storage
      .from("company-documents")
      .createSignedUrl(doc.file_path, 3600)

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank")
    }
  }, [])

  const deleteDocument = useCallback(async (doc: CompanyDocument) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id))

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { fetchDocuments(); return false }

    // Delete file from storage
    await supabase.storage
      .from("company-documents")
      .remove([doc.file_path])

    // Delete metadata row
    const { error } = await supabase
      .from("company_documents")
      .delete()
      .eq("id", doc.id)
      .eq("user_id", user.id)

    if (error) {
      fetchDocuments()
      return false
    }
    return true
  }, [fetchDocuments])

  return { documents, loading, refetch: fetchDocuments, uploadDocument, downloadDocument, deleteDocument }
}
