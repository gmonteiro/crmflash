import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { enrichPersonWithAI, enrichCompanyWithAI } from "@/lib/enrich/claude-enrich"

export async function POST(request: Request) {
  try {
    const { type, personId, companyId } = await request.json()

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (type === "person") {
      if (!personId) {
        return NextResponse.json({ error: "personId is required" }, { status: 400 })
      }

      const { data: person } = await supabase
        .from("people")
        .select("id, first_name, last_name, full_name, email, current_title, current_company, company_id, linkedin_url")
        .eq("id", personId)
        .eq("user_id", user.id)
        .single()

      if (!person) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 })
      }

      const enriched = await enrichPersonWithAI({
        full_name: person.full_name,
        email: person.email,
        current_title: person.current_title,
        current_company: person.current_company,
        linkedin_url: person.linkedin_url,
      })

      // Only overwrite empty fields
      const update: Record<string, unknown> = {
        linkedin_enriched_at: new Date().toISOString(),
      }
      if (enriched.current_title && !person.current_title) update.current_title = enriched.current_title
      if (enriched.current_company && !person.current_company) update.current_company = enriched.current_company
      if (enriched.linkedin_url && !person.linkedin_url) update.linkedin_url = enriched.linkedin_url
      if (enriched.notes && !person.current_title) update.notes = enriched.notes

      // Auto-create/associate company if found
      if (enriched.current_company && !person.company_id) {
        const { data: existingCompany } = await supabase
          .from("companies")
          .select("id")
          .eq("user_id", user.id)
          .ilike("name", enriched.current_company)
          .limit(1)

        if (existingCompany && existingCompany.length > 0) {
          update.company_id = existingCompany[0].id
        } else {
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({ name: enriched.current_company, user_id: user.id })
            .select("id")
            .single()

          if (newCompany) update.company_id = newCompany.id
        }
      }

      const { error } = await supabase
        .from("people")
        .update(update)
        .eq("id", personId)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, enriched })
    }

    if (type === "company") {
      if (!companyId) {
        return NextResponse.json({ error: "companyId is required" }, { status: 400 })
      }

      const { data: company } = await supabase
        .from("companies")
        .select("id, name, domain, website, industry, description, employee_count, estimated_revenue, size_tier, linkedin_url")
        .eq("id", companyId)
        .eq("user_id", user.id)
        .single()

      if (!company) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 })
      }

      const { data: people } = await supabase
        .from("people")
        .select("full_name, current_title, email")
        .eq("company_id", companyId)
        .limit(10)

      const enriched = await enrichCompanyWithAI({
        name: company.name,
        domain: company.domain,
        website: company.website,
        people: people?.map((p) => ({ name: p.full_name, title: p.current_title, email: p.email })),
      })

      // Only overwrite empty fields
      const update: Record<string, unknown> = {}
      if (enriched.industry && !company.industry) update.industry = enriched.industry
      if (enriched.description && !company.description) update.description = enriched.description
      if (enriched.website && !company.website) update.website = enriched.website
      if (enriched.domain && !company.domain) update.domain = enriched.domain
      if (enriched.linkedin_url && !company.linkedin_url) update.linkedin_url = enriched.linkedin_url
      if (enriched.employee_count && !company.employee_count) update.employee_count = enriched.employee_count
      if (enriched.estimated_revenue && !company.estimated_revenue) update.estimated_revenue = enriched.estimated_revenue
      if (enriched.size_tier && !company.size_tier) update.size_tier = enriched.size_tier

      if (Object.keys(update).length > 0) {
        const { error } = await supabase
          .from("companies")
          .update(update)
          .eq("id", companyId)

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }

      return NextResponse.json({ success: true, enriched })
    }

    return NextResponse.json({ error: "Invalid type. Use 'person' or 'company'" }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}
