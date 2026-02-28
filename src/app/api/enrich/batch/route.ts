import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getEnrichProvider } from "@/lib/enrich"
import type { EnrichSSEEvent, CompanyHints } from "@/lib/enrich"

export const maxDuration = 120

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function hasRequiredApiKey(provider: string): boolean {
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY
  return !!process.env.OPENAI_API_KEY
}

export async function POST(request: Request) {
  const { companyIds, provider: requestedProvider } = await request.json()
  const provider = requestedProvider === "anthropic" ? "anthropic" : (requestedProvider === "openai" ? "openai" : undefined)

  if (!hasRequiredApiKey(provider || process.env.ENRICH_PROVIDER || "openai")) {
    return jsonResponse({ error: "API key not configured" }, 500)
  }

  if (!Array.isArray(companyIds) || companyIds.length === 0 || companyIds.length > 5) {
    return jsonResponse({ error: "companyIds must be an array of 1-5 IDs" }, 400)
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const sendEvent = (event: EnrichSSEEvent) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

  const enrichProvider = getEnrichProvider(provider)

  ;(async () => {
    let succeeded = 0
    let failed = 0

    try {
      // Fetch all companies
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name, domain, website, industry, description, employee_count, estimated_revenue, size_tier, linkedin_url")
        .in("id", companyIds)
        .eq("user_id", user.id)

      if (!companies || companies.length === 0) {
        await sendEvent({ type: "error", message: "No companies found" })
        await writer.close()
        return
      }

      // Fetch people for all companies at once
      const { data: allPeople } = await supabase
        .from("people")
        .select("company_id, full_name, current_title, email, linkedin_url, current_company")
        .in("company_id", companyIds)
        .limit(50)

      // Group people by company
      const peopleByCompany = new Map<string, typeof allPeople>()
      for (const p of allPeople ?? []) {
        const list = peopleByCompany.get(p.company_id) ?? []
        list.push(p)
        peopleByCompany.set(p.company_id, list)
      }

      // Build batch input
      const batchInput = companies.map((company) => {
        const people = peopleByCompany.get(company.id) ?? []
        const hints: CompanyHints = {
          name: company.name,
          domain: company.domain,
          website: company.website,
          people: people.map((p) => ({
            name: p.full_name,
            title: p.current_title,
            email: p.email,
            linkedin_url: p.linkedin_url,
            current_company: p.current_company,
          })),
        }
        return { id: company.id, hints }
      })

      // Call provider batch enrichment
      const results = await enrichProvider.enrichCompaniesBatch(batchInput, {
        onReasoning: (chunk) => sendEvent({ type: "reasoning", text: chunk }),
        onBatchItem: async (id, enrichResult) => {
          // Save to DB as each result comes in
          const company = companies.find((c) => c.id === id)
          if (!company) return

          const update: Record<string, unknown> = {}
          if (enrichResult.industry && !company.industry) update.industry = enrichResult.industry
          if (enrichResult.description && !company.description) update.description = enrichResult.description
          if (enrichResult.website && !company.website) update.website = enrichResult.website
          if (enrichResult.domain && !company.domain) update.domain = enrichResult.domain
          if (enrichResult.linkedin_url && !company.linkedin_url) update.linkedin_url = enrichResult.linkedin_url
          if (enrichResult.employee_count && !company.employee_count) update.employee_count = enrichResult.employee_count
          if (enrichResult.estimated_revenue && !company.estimated_revenue) update.estimated_revenue = enrichResult.estimated_revenue
          if (enrichResult.size_tier && !company.size_tier) update.size_tier = enrichResult.size_tier

          if (Object.keys(update).length > 0) {
            const { error } = await supabase
              .from("companies")
              .update(update)
              .eq("id", id)

            if (error) {
              failed++
              await sendEvent({ type: "batch_item", id, success: false, enriched: enrichResult })
              return
            }
          }

          succeeded++
          await sendEvent({ type: "batch_item", id, success: true, enriched: enrichResult })
        },
      })

      // Handle any companies that weren't in onBatchItem callbacks
      for (const company of companies) {
        if (!results.has(company.id)) {
          failed++
          await sendEvent({
            type: "batch_item",
            id: company.id,
            success: false,
            enriched: {},
          })
        }
      }

      await sendEvent({ type: "done", succeeded, failed })
    } catch (err) {
      await sendEvent({ type: "error", message: (err as Error).message })
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
