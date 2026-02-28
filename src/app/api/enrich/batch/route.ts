import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getEnrichProvider } from "@/lib/enrich"
import type { EnrichSSEEvent, CompanyHints, CompanyEnrichResult } from "@/lib/enrich"

export const maxDuration = 120

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function hasRequiredApiKey(provider: string): boolean {
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY
  if (provider === "perplexity") return !!process.env.PERPLEXITY_API_KEY
  if (provider === "exa") return !!process.env.EXA_API_KEY
  return !!process.env.OPENAI_API_KEY
}

function isNonEmpty(result: CompanyEnrichResult): boolean {
  return !!(result.industry || result.description || result.employee_count || result.estimated_revenue || result.size_tier)
}

export async function POST(request: Request) {
  const { companyIds, provider: requestedProvider } = await request.json()
  const validProviders = ["openai", "anthropic", "perplexity", "exa"] as const
  const provider = validProviders.includes(requestedProvider) ? requestedProvider : undefined

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

      // Build hints map
      const hintsMap = new Map<string, CompanyHints>()
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
        hintsMap.set(company.id, hints)
        return { id: company.id, hints }
      })

      // Track which companies got non-empty results
      const enrichedIds = new Set<string>()

      // Save enrichment result to DB, returns true if non-empty
      async function saveResult(id: string, enrichResult: CompanyEnrichResult): Promise<boolean> {
        const update: Record<string, unknown> = {}
        if (enrichResult.industry) update.industry = enrichResult.industry
        if (enrichResult.description) update.description = enrichResult.description
        if (enrichResult.website) update.website = enrichResult.website
        if (enrichResult.domain) update.domain = enrichResult.domain
        if (enrichResult.linkedin_url) update.linkedin_url = enrichResult.linkedin_url
        if (enrichResult.employee_count) update.employee_count = enrichResult.employee_count
        if (enrichResult.estimated_revenue) update.estimated_revenue = enrichResult.estimated_revenue
        if (enrichResult.size_tier) update.size_tier = enrichResult.size_tier

        if (Object.keys(update).length === 0) return false

        const { error } = await supabase
          .from("companies")
          .update(update)
          .eq("id", id)

        return !error
      }

      // First pass: batch enrichment
      await enrichProvider.enrichCompaniesBatch(batchInput, {
        onReasoning: (chunk) => sendEvent({ type: "reasoning", text: chunk }),
        onBatchItem: async (id, enrichResult) => {
          if (isNonEmpty(enrichResult)) {
            const saved = await saveResult(id, enrichResult)
            if (saved) {
              enrichedIds.add(id)
              succeeded++
              await sendEvent({ type: "batch_item", id, success: true, enriched: enrichResult })
              return
            }
          }
          // Don't count as failed yet — will retry
        },
      })

      // Second pass: retry companies that got empty or failed results individually
      for (const company of companies) {
        if (enrichedIds.has(company.id)) continue

        try {
          const hints = hintsMap.get(company.id)!
          const result = await enrichProvider.enrichCompany(hints, {
            onReasoning: (chunk) => sendEvent({ type: "reasoning", text: chunk }),
            onProgress: () => {},
          })

          if (isNonEmpty(result)) {
            const saved = await saveResult(company.id, result)
            if (saved) {
              enrichedIds.add(company.id)
              succeeded++
              await sendEvent({ type: "batch_item", id: company.id, success: true, enriched: result })
              continue
            }
          }

          // Still empty after retry
          failed++
          await sendEvent({ type: "batch_item", id: company.id, success: false, enriched: result })
        } catch {
          failed++
          await sendEvent({ type: "batch_item", id: company.id, success: false, enriched: {} })
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
