import { COMMITMENT_SIGNALS } from "@/lib/constants"
import type { CopilotCompanyContext } from "./types"

function renderContext(ctx: CopilotCompanyContext): string {
  const lines: string[] = []
  lines.push(`Empresa: ${ctx.name}`)
  lines.push(`Estágio atual: ${ctx.stageTitle ?? "(fora do board)"}`)
  if (ctx.stageExitCriteria) {
    lines.push(`Critério de saída deste estágio: ${ctx.stageExitCriteria}`)
  }
  lines.push(`Estágios válidos, em ordem: ${ctx.allStageTitles.join(" > ")}`)
  lines.push(
    `Dias desde o último evento do cliente: ${
      ctx.daysSinceClientEvent === null ? "nunca houve" : ctx.daysSinceClientEvent
    }`
  )
  lines.push(`Champion: ${ctx.championName ?? "não mapeado"}`)
  lines.push(`Quem assina: ${ctx.economicBuyerName ?? "não mapeado"}`)
  lines.push(`Hipótese de dor: ${ctx.painHypothesis ?? "não registrada"}`)

  lines.push(
    ctx.capturedSignals.length > 0
      ? `Sinais de compromisso JÁ capturados (não repita nenhum destes): ${ctx.capturedSignals.join(", ")}`
      : "Sinais de compromisso já capturados: nenhum"
  )

  lines.push(
    ctx.pendingNextSteps.length > 0
      ? `Próximos passos pendentes: ${ctx.pendingNextSteps
          .map((s) => `${s.title}${s.due_date ? ` (vence ${s.due_date})` : ""}`)
          .join("; ")}`
      : "Próximos passos pendentes: nenhum"
  )

  if (ctx.recentActivities.length > 0) {
    lines.push("Atividades recentes:")
    for (const a of ctx.recentActivities) {
      lines.push(`  - ${a.date.slice(0, 10)} [${a.type}] ${a.title}`)
    }
  }

  lines.push(`Data de hoje: ${ctx.todayISO}`)
  return lines.join("\n")
}

const SIGNAL_REFERENCE = COMMITMENT_SIGNALS.map((s) => `  - ${s.value}: ${s.label}`).join("\n")

export function buildInterpretPrompt(
  ctx: CopilotCompanyContext,
  question: string,
  narration: string
): string {
  return `Você é um copiloto comercial. O vendedor acabou de narrar o que aconteceu numa conta e você vai converter essa narração em atualizações estruturadas do CRM.

Extraia SOMENTE fatos que o vendedor afirmou. Nunca invente, nunca deduza, nunca preencha lacuna com suposição.

## Contexto da conta
${renderContext(ctx)}

## Pergunta que foi feita ao vendedor
${question}

## Resposta do vendedor
${narration}

## Regras obrigatórias

1. client_event_today: só marque true se o CLIENTE fez alguma coisa — respondeu,
   mandou dado, apareceu na reunião, perguntou algo, apresentou internamente.
   Ação do VENDEDOR (mandei e-mail, cobrei, preparei proposta, liguei sem retorno)
   NÃO é evento do cliente: nesse caso use false. Esta é a regra mais importante.

2. commitment_signals: liste apenas sinais que a narração descreve explicitamente.
   Nunca inclua um sinal que já consta como capturado no contexto acima.
   Valores permitidos:
${SIGNAL_REFERENCE}

3. stage_move: só proponha movimento se a narração satisfaz o critério de saída do
   estágio atual, que está escrito no contexto. Silêncio educado, reunião marcada ou
   entusiasmo do cliente NÃO são avanço. Na dúvida use "none".
   - "advance"/"retreat": um passo no funil.
   - "won"/"lost"/"frozen": desfecho explicitamente narrado.
   - stage_target_title deve ser exatamente um dos estágios válidos listados, ou null.

4. next_step: só se a narração indica um compromisso concreto. due_date em
   formato yyyy-MM-dd, resolvido contra a data de hoje informada acima. Se não houver
   data na narração, use null.

5. fields: preencha champion_name, economic_buyer_name ou pain_hypothesis apenas se
   a narração nomear a pessoa ou descrever a dor. Caso contrário null.

6. note: um resumo de uma ou duas frases do que aconteceu, na voz do vendedor.

7. confidence: use "low" quando a narração for vaga, ambígua ou curta demais para
   sustentar as conclusões. Prefira errar para "low".

Responda APENAS com um objeto JSON, sem texto em volta, neste formato:
{
  "summary": "string curta descrevendo o que você entendeu",
  "client_event_today": false,
  "stage_move": "none",
  "stage_target_title": null,
  "commitment_signals": [],
  "next_step": null,
  "fields": { "champion_name": null, "economic_buyer_name": null, "pain_hypothesis": null },
  "note": null,
  "confidence": "medium"
}`
}
