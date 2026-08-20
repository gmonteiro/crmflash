-- 009_copilot.sql
-- Copiloto comercial: fila de perguntas diárias sobre o pipeline.
--
-- As PERGUNTAS não são persistidas — são derivadas do estado atual do board por
-- src/lib/pipeline/rules.ts. Uma pergunta depende de estado mutável ("14 dias sem
-- evento", "próximo passo vencido"), então uma linha persistida ficaria obsoleta
-- no instante em que o card se move.
--
-- O que persiste aqui é a RESPOSTA do usuário:
--   (a) evita repetir a mesma pergunta (dedup por question_key),
--   (b) permite adiar (snooze) e descartar,
--   (c) audita o que a narração em texto livre alterou no CRM (coluna applied).
--
-- Supressão, snooze, dismiss e dedup do mesmo dia colapsam num mecanismo único:
-- a pergunta fica escondida enquanto existir linha com suppress_until >= hoje.
--
-- Append-only, como company_stage_events: sem policy de UPDATE, sem updated_at.
-- Rodar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS copilot_question_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question_key   TEXT NOT NULL,  -- determinístico: rule_id:company_id[:entity_id]
  rule_id        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('answered', 'snoozed', 'dismissed')),
  action_id      TEXT,           -- id da quick action; NULL quando veio de texto livre
  answer_text    TEXT,           -- narração do usuário
  applied        JSONB,          -- proposta estruturada efetivamente aplicada
  suppress_until DATE NOT NULL,  -- pergunta escondida até esta data (inclusive)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN copilot_question_events.question_key IS
  'Chave determinística da pergunta (rule_id:company_id[:entity_id]). Base do dedup e da supressão.';
COMMENT ON COLUMN copilot_question_events.suppress_until IS
  'Enquanto >= CURRENT_DATE, a pergunta não reaparece. Dismiss = hoje + 365 dias.';

-- Consulta quente: todas as chaves ainda suprimidas do usuário.
CREATE INDEX IF NOT EXISTS idx_copilot_events_active
  ON copilot_question_events(user_id, suppress_until DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_events_key
  ON copilot_question_events(user_id, question_key, suppress_until DESC);
-- Histórico de respostas por empresa (auditoria).
CREATE INDEX IF NOT EXISTS idx_copilot_events_company
  ON copilot_question_events(company_id, created_at DESC);

ALTER TABLE copilot_question_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own copilot events"
  ON copilot_question_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own copilot events"
  ON copilot_question_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own copilot events"
  ON copilot_question_events FOR DELETE
  USING (user_id = auth.uid());
