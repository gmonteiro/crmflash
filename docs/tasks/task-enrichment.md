# Tasks: AI Enrichment

## Modulo: Enriquecimento via Claude API

### Task 6.1: Instalar SDK
- **Status:** DONE
- **Descricao:** `npm install @anthropic-ai/sdk`
- **Criterio:** Pacote no package.json

### Task 6.2: Modulo claude-enrich
- **Status:** DONE
- **Arquivo:** `src/lib/enrich/claude-enrich.ts`
- **Descricao:**
  - `enrichPersonWithAI(hints)` — recebe nome, email, titulo, empresa, linkedin. Usa Claude Haiku 4.5 + web_search_20250305 para buscar info profissional. Retorna JSON com current_title, current_company, linkedin_url, notes
  - `enrichCompanyWithAI(hints)` — recebe nome, domain, website. Busca industry, description, website, domain, linkedin_url, employee_count, estimated_revenue, size_tier
  - `extractJson<T>(text)` — parse robusto que tenta code blocks e depois regex
  - `getTextFromResponse(response)` — extrai texto do response do Claude
- **Criterio:** Funcoes retornam dados estruturados a partir de web search

### Task 6.3: API Route /api/enrich
- **Status:** DONE
- **Arquivo:** `src/app/api/enrich/route.ts`
- **Descricao:** POST unificado. Aceita `{ type, personId }` ou `{ type, companyId }`.
  - Valida auth + ownership (user_id)
  - Chama enrichPerson/enrichCompany
  - So sobrescreve campos vazios no banco
  - Para person: auto-cria/associa company se encontrada e person nao tem company_id
  - Retorna `{ success, enriched }`
- **Criterio:** Auth funciona, dados atualizados no banco

### Task 6.4: Hook useEnrich
- **Status:** DONE
- **Arquivo:** `src/hooks/use-enrich.ts`
- **Descricao:** Hook client-side com `enrichPerson(id)` e `enrichCompany(id)`. Loading state compartilhado. Chama fetch para /api/enrich
- **Criterio:** Loading aparece, retorna true/false

### Task 6.5: EnrichButton
- **Status:** DONE
- **Arquivo:** `src/components/shared/enrich-button.tsx`
- **Descricao:** Botao generico com props: type ("person"|"company"), id, onEnriched callback. Icone Sparkles, loading spinner, toast success/error
- **Criterio:** Funciona para ambos os tipos

### Task 6.6: Integrar em PersonDetailCard
- **Status:** DONE
- **Arquivo:** `src/components/people/person-detail-card.tsx`
- **Descricao:** Substituiu LinkedInEnrichButton por EnrichButton. Adicionou prop onRefetch para recarregar dados apos enrich
- **Criterio:** Botao Enrich aparece, refetch atualiza UI

### Task 6.7: Integrar em CompanyDetailCard
- **Status:** DONE
- **Arquivo:** `src/components/companies/company-detail-card.tsx`
- **Descricao:** Adicionou EnrichButton no header. Extraiu `load` como useCallback para usar como refetch
- **Criterio:** Botao Enrich aparece, refetch atualiza UI

### Task 6.8: Atualizar Settings
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/settings/page.tsx`
- **Descricao:** Trocou icone Linkedin → Sparkles, titulo "LinkedIn Enrichment" → "AI Enrichment", "Proxycurl" → "Anthropic/Claude", env var PROXYCURL_API_KEY → ANTHROPIC_API_KEY
- **Criterio:** Settings reflete nova integracao

### Task 6.9: Cleanup Proxycurl
- **Status:** DONE
- **Descricao:** Deletados:
  - `src/lib/linkedin/proxycurl.ts`
  - `src/lib/linkedin/transform.ts`
  - `src/app/api/linkedin/enrich/route.ts`
  - `src/hooks/use-linkedin-enrich.ts`
  - `src/components/people/linkedin-enrich-button.tsx`
  - Diretorios vazios `lib/linkedin/`, `api/linkedin/`
- **Criterio:** Nenhuma referencia a Proxycurl no codigo

### Task 6.10: Env Var
- **Status:** DONE
- **Arquivo:** `.env.local`
- **Descricao:** Trocou `PROXYCURL_API_KEY=` por `ANTHROPIC_API_KEY=`
- **Criterio:** .env.local tem a key correta

### Task 6.11: Bulk Enrich Companies
- **Status:** DONE
- **Arquivos:** `src/hooks/use-enrich.ts`, `src/app/(dashboard)/companies/page.tsx`
- **Descricao:** Hook `useBulkEnrich` + botao "Enrich All" + dialog com progress
- **Criterio:** Enriquece todas empresas unenriched sequencialmente com UI de progresso

### Task 6.12: Streaming Response
- **Status:** DONE
- **Arquivos:** `src/lib/enrich/claude-enrich.ts`, `src/app/api/enrich/route.ts`, `src/hooks/use-enrich.ts`
- **Descricao:** API usa TransformStream com keepalive bytes para evitar timeout do Vercel
- **Criterio:** Enrichments nao dão timeout no Vercel free tier

### Task 6.13: Disambiguacao com People Context
- **Status:** DONE
- **Arquivos:** `src/lib/enrich/claude-enrich.ts`, `src/app/api/enrich/route.ts`
- **Descricao:** Passa dados dos people vinculados no prompt para resolver nomes ambiguos
- **Criterio:** "Flash" resolve para flashapp.com.br (brasileiro) e nao flashparking.com

### Task 6.14: Reducao de Custo
- **Status:** PENDING
- **Descricao:** Custo atual ~$0.06/enrichment e inviavel. Avaliar: batching, modelo mais barato (OpenAI GPT-4o-mini), limitar web searches, ou APIs gratuitas
- **Criterio:** Custo por enrichment < $0.01

### Task 6.15: Reasoning Window
- **Status:** PENDING
- **Descricao:** Mostrar log/trace do que o AI esta fazendo durante enrichment (queries de busca, resultados)
- **Criterio:** UI mostra progresso detalhado durante enrich
