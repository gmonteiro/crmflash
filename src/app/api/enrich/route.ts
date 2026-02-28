import { createServerSupabaseClient } from "@/lib/supabase/server"
import { enrichPersonWithAI, enrichCompanyWithAI } from "@/lib/enrich/claude-enrich"

export const maxDuration = 60

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(request: Request) {
  const { type, personId, companyId } = await request.json()

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500)
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  if (type !== "person" && type !== "company") {
    return jsonResponse({ error: "Invalid type. Use 'person' or 'company'" }, 400)
  }
  if (type === "person" && !personId) {
    return jsonResponse({ error: "personId is required" }, 400)
  }
  if (type === "company" && !companyId) {
    return jsonResponse({ error: "companyId is required" }, 400)
  }

  // Stream response to keep connection alive during AI processing
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const write = (data: string) => writer.write(encoder.encode(data))
  const onProgress = () => write(" ")

  // Run enrichment in background, streaming keepalive bytes
  ;(async () => {
    try {
      if (type === "person") {
        const { data: person } = await supabase
          .from("people")
          .select("id, first_name, last_name, full_name, email, current_title, current_company, company_id, linkedin_url")
          .eq("id", personId)
          .eq("user_id", user.id)
          .single()

        if (!person) {
          await write(JSON.stringify({ error: "Person not found" }))
          await writer.close()
          return
        }

        const enriched = await enrichPersonWithAI(
          {
            full_name: person.full_name,
            email: person.email,
            current_title: person.current_title,
            current_company: person.current_company,
            linkedin_url: person.linkedin_url,
          },
          { onProgress },
        )

        const update: Record<string, unknown> = {
          linkedin_enriched_at: new Date().toISOString(),
        }
        if (enriched.current_title && !person.current_title) update.current_title = enriched.current_title
        if (enriched.current_company && !person.current_company) update.current_company = enriched.current_company
        if (enriched.linkedin_url && !person.linkedin_url) update.linkedin_url = enriched.linkedin_url
        if (enriched.notes && !person.current_title) update.notes = enriched.notes

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
          await write(JSON.stringify({ error: error.message }))
        } else {
          await write(JSON.stringify({ success: true, enriched }))
        }
      }

      if (type === "company") {
        const { data: company } = await supabase
          .from("companies")
          .select("id, name, domain, website, industry, description, employee_count, estimated_revenue, size_tier, linkedin_url")
          .eq("id", companyId)
          .eq("user_id", user.id)
          .single()

        if (!company) {
          await write(JSON.stringify({ error: "Company not found" }))
          await writer.close()
          return
        }

        const { data: people } = await supabase
          .from("people")
          .select("full_name, current_title, email, linkedin_url, current_company")
          .eq("company_id", companyId)
          .limit(10)

        const enriched = await enrichCompanyWithAI(
          {
            name: company.name,
            domain: company.domain,
            website: company.website,
            people: people?.map((p) => ({
              name: p.full_name,
              title: p.current_title,
              email: p.email,
              linkedin_url: p.linkedin_url,
              current_company: p.current_company,
            })),
          },
          { onProgress },
        )

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
            await write(JSON.stringify({ error: error.message }))
            await writer.close()
            return
          }
        }

        await write(JSON.stringify({ success: true, enriched }))
      }
    } catch (err) {
      await write(JSON.stringify({ error: (err as Error).message }))
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
