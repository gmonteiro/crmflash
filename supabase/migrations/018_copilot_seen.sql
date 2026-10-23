-- 018_copilot_seen.sql
-- Copiloto: status 'seen' em copilot_question_events.
--
-- O painel passou a mostrar a fila inteira. Para nao cobrar todo dia o que o
-- usuario ja viu e deixou passar, o painel grava 'seen' quando o card ficou na
-- tela e ele foi para outra conta. suppress_until vem de SEEN_SUPPRESS_DAYS
-- (src/lib/constants.ts), proporcional a importancia da regra.
--
-- 'seen' nunca carrega action_id, answer_text ou applied. Append-only como antes.
-- Rodar no Supabase SQL Editor.

ALTER TABLE copilot_question_events
  DROP CONSTRAINT IF EXISTS copilot_question_events_status_check;

ALTER TABLE copilot_question_events
  ADD CONSTRAINT copilot_question_events_status_check
  CHECK (status IN ('answered', 'snoozed', 'dismissed', 'seen'));

COMMENT ON COLUMN copilot_question_events.status IS
  'answered/snoozed/dismissed = resposta do usuario. seen = viu o card e passou adiante; suprime pela cadencia da regra.';
