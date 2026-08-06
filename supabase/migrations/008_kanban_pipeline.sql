-- 008_kanban_pipeline.sql
-- Pipeline de vendas com ciclo longo: estágios cujo critério de saída é o que o
-- CLIENTE fez (não a atividade do vendedor). Adiciona campos de pipeline em
-- companies, tabela de sinais de compromisso e log de movimentos entre estágios.
-- Rodar no Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Novos estágios padrão (para usuários NOVOS). Usuários já existentes não são
--    afetados retroativamente — ver bloco no fim do arquivo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_default_kanban_columns(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Cannot create kanban columns for another user';
  END IF;

  INSERT INTO kanban_columns (user_id, title, color, position)
  VALUES
    (p_user_id, 'Alvos',             '#64748b', 1),
    (p_user_id, 'Contato',           '#6366f1', 2),
    (p_user_id, 'Diagnóstico',       '#3b82f6', 3),
    (p_user_id, 'Dor validada',      '#0ea5e9', 4),
    (p_user_id, 'Solução desenhada', '#8b5cf6', 5),
    (p_user_id, 'Prova',             '#f59e0b', 6),
    (p_user_id, 'Aprovação',         '#ec4899', 7),
    (p_user_id, 'Ganho',             '#10b981', 8),
    (p_user_id, 'Perdido',           '#ef4444', 9),
    (p_user_id, 'Gelado',            '#94a3b8', 10);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 2. Campos de pipeline em companies
-- ---------------------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS champion_name        TEXT,
  ADD COLUMN IF NOT EXISTS economic_buyer_name  TEXT,        -- quem assina
  ADD COLUMN IF NOT EXISTS pain_hypothesis      TEXT,        -- hipótese de dor (estágio Alvos)
  ADD COLUMN IF NOT EXISTS last_client_event_at TIMESTAMPTZ; -- data do último evento DO CLIENTE

COMMENT ON COLUMN companies.last_client_event_at IS
  'Data do último evento gerado pelo cliente (não pelo vendedor). Base para detectar cards parados/gelados.';

-- ---------------------------------------------------------------------------
-- 3. Sinais de compromisso (o cliente fez algo que custa a ele)
--    Presença da linha = sinal capturado. captured_at alimenta a métrica semanal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_commitment_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'second_interlocutor',   -- trouxe um 2º interlocutor
    'presented_internally',  -- apresentou internamente sem você na sala
    'shared_real_data',      -- liberou dado real / print de ERP / acesso
    'allocated_team_member', -- alocou alguém do time dele
    'asked_price',           -- perguntou preço / pediu proposta
    'security_process'       -- puxou segurança / compliance
  )),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_commitment_signals_company ON company_commitment_signals(company_id);
CREATE INDEX IF NOT EXISTS idx_commitment_signals_captured ON company_commitment_signals(user_id, captured_at DESC);

ALTER TABLE company_commitment_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commitment_signals_select" ON company_commitment_signals
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "commitment_signals_insert" ON company_commitment_signals
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "commitment_signals_update" ON company_commitment_signals
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "commitment_signals_delete" ON company_commitment_signals
  FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Log de movimentos entre estágios (base para métricas: movimentos líquidos,
--    tempo em estágio, conversão acumulada). Títulos denormalizados para
--    sobreviver a rename/delete de colunas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_stage_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_column_id UUID REFERENCES kanban_columns(id) ON DELETE SET NULL,
  to_column_id   UUID REFERENCES kanban_columns(id) ON DELETE SET NULL,
  from_title     TEXT,
  to_title       TEXT,
  from_position  FLOAT,
  to_position    FLOAT,
  direction      TEXT NOT NULL CHECK (direction IN ('enter', 'advance', 'retreat', 'frozen')),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_events_company ON company_stage_events(company_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_stage_events_user_time ON company_stage_events(user_id, occurred_at DESC);

ALTER TABLE company_stage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_events_select" ON company_stage_events
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "stage_events_insert" ON company_stage_events
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "stage_events_delete" ON company_stage_events
  FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. (OPCIONAL) Aplicar os novos estágios à SUA conta já existente.
--    A função acima só cria colunas para usuários novos. Para migrar sua conta,
--    descomente e troque <SEU_USER_ID> pelo seu id (auth.users). Isso:
--      (a) apaga suas colunas atuais e cria as 10 novas;
--      (b) tira todos os cards do board (kanban_column_id = NULL) para você
--          reclassificá-los manualmente nos novos estágios.
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE v_user UUID := '<SEU_USER_ID>';
-- BEGIN
--   UPDATE companies SET kanban_column_id = NULL WHERE user_id = v_user;
--   DELETE FROM kanban_columns WHERE user_id = v_user;
--   INSERT INTO kanban_columns (user_id, title, color, position) VALUES
--     (v_user, 'Alvos',             '#64748b', 1),
--     (v_user, 'Contato',           '#6366f1', 2),
--     (v_user, 'Diagnóstico',       '#3b82f6', 3),
--     (v_user, 'Dor validada',      '#0ea5e9', 4),
--     (v_user, 'Solução desenhada', '#8b5cf6', 5),
--     (v_user, 'Prova',             '#f59e0b', 6),
--     (v_user, 'Aprovação',         '#ec4899', 7),
--     (v_user, 'Ganho',             '#10b981', 8),
--     (v_user, 'Perdido',           '#ef4444', 9),
--     (v_user, 'Gelado',            '#94a3b8', 10);
-- END $$;
