"use client"

import { useState } from "react"
import { Person } from "@/types/database"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ExternalLink, Mail, Phone, Building2, Pencil, Check, X, Linkedin } from "lucide-react"
import Link from "next/link"
import { EnrichButton } from "@/components/shared/enrich-button"

interface PersonDetailCardProps {
  person: Person
  onUpdate: (data: Partial<Person>) => Promise<boolean>
  onRefetch?: () => void
}

export function PersonDetailCard({ person, onUpdate, onRefetch }: PersonDetailCardProps) {
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email || "",
    phone: person.phone || "",
    current_title: person.current_title || "",
    linkedin_url: person.linkedin_url || "",
    category: person.category || "",
    notes: person.notes || "",
  })

  async function handleSave() {
    const success = await onUpdate(editData)
    if (success) setEditing(false)
  }

  function handleCancel() {
    setEditData({
      first_name: person.first_name,
      last_name: person.last_name,
      email: person.email || "",
      phone: person.phone || "",
      current_title: person.current_title || "",
      linkedin_url: person.linkedin_url || "",
      category: person.category || "",
      notes: person.notes || "",
    })
    setEditing(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
              {person.first_name?.[0]}{person.last_name?.[0]}
            </div>
            <div>
              {editing ? (
                <div className="flex gap-2">
                  <Input
                    value={editData.first_name}
                    onChange={(e) => setEditData((d) => ({ ...d, first_name: e.target.value }))}
                    className="h-8 w-32"
                  />
                  <Input
                    value={editData.last_name}
                    onChange={(e) => setEditData((d) => ({ ...d, last_name: e.target.value }))}
                    className="h-8 w-32"
                  />
                </div>
              ) : (
                <h2 className="text-xl font-bold">{person.full_name}</h2>
              )}
              {editing ? (
                <Input
                  value={editData.current_title}
                  onChange={(e) => setEditData((d) => ({ ...d, current_title: e.target.value }))}
                  className="mt-1 h-7 text-sm"
                  placeholder="Title"
                />
              ) : (
                person.current_title && (
                  <p className="text-sm text-muted-foreground">{person.current_title}</p>
                )
              )}
              {person.company && (
                <Link
                  href={`/companies/${person.company.id}`}
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Building2 className="h-3 w-3" />
                  {person.company.name}
                </Link>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <EnrichButton type="person" id={person.id} onEnriched={onRefetch} />
            {editing ? (
              <>
                <Button size="sm" onClick={handleSave}>
                  <Check className="mr-1 h-4 w-4" />
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>
                  <X className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email</Label>
            {editing ? (
              <Input
                value={editData.email}
                onChange={(e) => setEditData((d) => ({ ...d, email: e.target.value }))}
                className="h-8"
              />
            ) : (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{person.email || "-"}</span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Phone</Label>
            {editing ? (
              <Input
                value={editData.phone}
                onChange={(e) => setEditData((d) => ({ ...d, phone: e.target.value }))}
                className="h-8"
              />
            ) : (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{person.phone || "-"}</span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">LinkedIn</Label>
            {editing ? (
              <Input
                value={editData.linkedin_url}
                onChange={(e) => setEditData((d) => ({ ...d, linkedin_url: e.target.value }))}
                className="h-8"
              />
            ) : person.linkedin_url ? (
              <a
                href={person.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Linkedin className="h-4 w-4" />
                Profile
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            {person.category ? (
              <Badge variant="secondary">{person.category}</Badge>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
        </div>

        {person.linkedin_enriched_at && (
          <div className="text-xs text-muted-foreground">
            LinkedIn data enriched: {new Date(person.linkedin_enriched_at).toLocaleDateString()}
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Notes</Label>
          {editing ? (
            <Textarea
              value={editData.notes}
              onChange={(e) => setEditData((d) => ({ ...d, notes: e.target.value }))}
              rows={4}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{person.notes || "No notes yet."}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
