import Exa from "exa-js"
import type {
  EnrichProvider,
  PersonHints,
  PersonEnrichResult,
  CompanyHints,
  CompanyEnrichResult,
  StreamCallbacks,
} from "../types"
import { extractJson } from "../parse"

function getClient() {
  return new Exa(process.env.EXA_API_KEY)
}

function buildExaCompanyQuery(hints: CompanyHints): string {
  const parts = [hints.name]
  if (hints.domain) parts.push(hints.domain)
  if (hints.website) parts.push(hints.website)

  let peopleContext = ""
  if (hints.people && hints.people.length > 0) {
    const names = hints.people.slice(0, 3).map((p) => p.name).join(", ")
    peopleContext = ` Known employees: ${names}.`
  }

  return `Company profile for ${parts.join(", ")}.${peopleContext} What is their industry, employee count, annual revenue, company size, website, LinkedIn page, and a brief description?`
}

function buildExaPersonQuery(hints: PersonHints): string {
  const parts = [hints.full_name]
  if (hints.current_company) parts.push(hints.current_company)
  if (hints.current_title) parts.push(hints.current_title)
  return `Professional profile for ${parts.join(", ")}. What is their current job title, company, LinkedIn URL, and a brief professional summary?`
}

function parseCompanyFromText(text: string): CompanyEnrichResult {
  // First try direct JSON extraction
  const json = extractJson<CompanyEnrichResult>(text)
  if (json && Object.keys(json).length > 0) return json

  // Fallback: extract fields from natural language
  const result: CompanyEnrichResult = {}

  // Industry
  const industryMatch = text.match(/(?:industry|sector|operates in|field)[:\s]+([^.,\n]+)/i)
  if (industryMatch) result.industry = industryMatch[1].trim()

  // Employee count
  const empMatch = text.match(/(?:approximately|about|around|roughly|over|~)?\s*(\d[\d,]+)\s*(?:employees|workers|staff|people)/i)
  if (empMatch) result.employee_count = parseInt(empMatch[1].replace(/,/g, ""), 10)

  // Revenue
  const revMatch = text.match(/\$\s*([\d.]+)\s*(billion|million|B|M)/i)
  if (revMatch) {
    const num = parseFloat(revMatch[1])
    const unit = revMatch[2].toLowerCase()
    if (unit === "billion" || unit === "b") result.estimated_revenue = num * 1_000_000_000
    else if (unit === "million" || unit === "m") result.estimated_revenue = num * 1_000_000
  }

  // Size tier
  const sizeTiers = ["Micro", "Small", "Medium", "Large", "Enterprise"] as const
  for (const tier of sizeTiers) {
    if (text.toLowerCase().includes(tier.toLowerCase() + " ") || text.toLowerCase().includes(tier.toLowerCase() + "-size")) {
      result.size_tier = tier
      break
    }
  }
  // Infer from employee count if not found
  if (!result.size_tier && result.employee_count) {
    const count = result.employee_count
    if (count < 10) result.size_tier = "Micro"
    else if (count < 50) result.size_tier = "Small"
    else if (count < 250) result.size_tier = "Medium"
    else if (count < 1000) result.size_tier = "Large"
    else result.size_tier = "Enterprise"
  }

  // Website
  const webMatch = text.match(/(?:website|site|homepage)[:\s]+(?:is\s+)?(https?:\/\/[^\s,)]+)/i)
    ?? text.match(/(https?:\/\/(?:www\.)?[a-z0-9][\w.-]*\.[a-z]{2,}(?:\/[^\s,)]*)?)/i)
  if (webMatch) result.website = webMatch[1].trim()

  // Domain
  if (result.website) {
    try {
      result.domain = new URL(result.website).hostname.replace(/^www\./, "")
    } catch { /* ignore */ }
  }

  // LinkedIn
  const liMatch = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s,)]+)/i)
  if (liMatch) result.linkedin_url = liMatch[1].trim()

  // Description — take the first sentence that mentions the company
  const sentences = text.split(/[.!]\s+/)
  const descSentence = sentences.find((s) => s.length > 20 && s.length < 300)
  if (descSentence) result.description = descSentence.trim() + "."

  return result
}

function parsePersonFromText(text: string): PersonEnrichResult {
  const json = extractJson<PersonEnrichResult>(text)
  if (json && Object.keys(json).length > 0) return json

  const result: PersonEnrichResult = {}

  const titleMatch = text.match(/(?:title|role|position)[:\s]+([^.,\n]+)/i)
  if (titleMatch) result.current_title = titleMatch[1].trim()

  const companyMatch = text.match(/(?:works at|employed at|company|employer)[:\s]+([^.,\n]+)/i)
  if (companyMatch) result.current_company = companyMatch[1].trim()

  const liMatch = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s,)]+)/i)
  if (liMatch) result.linkedin_url = liMatch[1].trim()

  const sentences = text.split(/[.!]\s+/)
  const noteSentence = sentences.find((s) => s.length > 20 && s.length < 300)
  if (noteSentence) result.notes = noteSentence.trim() + "."

  return result
}

export class ExaEnrichProvider implements EnrichProvider {
  async enrichPerson(
    hints: PersonHints,
    callbacks?: StreamCallbacks,
  ): Promise<PersonEnrichResult> {
    const query = buildExaPersonQuery(hints)
    const client = getClient()
    const response = await client.answer(query, {})
    const text = String(response.answer)
    callbacks?.onReasoning?.(text)
    callbacks?.onProgress?.()
    return parsePersonFromText(text)
  }

  async enrichCompany(
    hints: CompanyHints,
    callbacks?: StreamCallbacks,
  ): Promise<CompanyEnrichResult> {
    const query = buildExaCompanyQuery(hints)
    const client = getClient()
    const response = await client.answer(query, {})
    const text = String(response.answer)
    callbacks?.onReasoning?.(text)
    callbacks?.onProgress?.()
    return parseCompanyFromText(text)
  }

  async enrichCompaniesBatch(
    companies: { hints: CompanyHints; id: string }[],
    callbacks?: StreamCallbacks & { onBatchItem?: (id: string, result: CompanyEnrichResult) => void },
  ): Promise<Map<string, CompanyEnrichResult>> {
    const results = new Map<string, CompanyEnrichResult>()
    for (const company of companies) {
      try {
        const result = await this.enrichCompany(company.hints, callbacks)
        results.set(company.id, result)
        callbacks?.onBatchItem?.(company.id, result)
      } catch {
        results.set(company.id, {})
        callbacks?.onBatchItem?.(company.id, {})
      }
    }
    return results
  }
}
