-- Activities table: rich activity records linked to people and/or companies
-- Supports data from external integrations (e.g. TranscriptionApp)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'note'
    CHECK (type IN ('meeting', 'call', 'email', 'note')),
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'transcription_app')),
  source_meeting_id TEXT,
  source_app_url TEXT,
  transcript TEXT,
  summary JSONB,
  speakers JSONB,
  audio_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- At least one of person_id or company_id must be set
  CONSTRAINT activity_target CHECK (person_id IS NOT NULL OR company_id IS NOT NULL)
);

CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_person ON activities(person_id);
CREATE INDEX idx_activities_company ON activities(company_id);
CREATE INDEX idx_activities_date ON activities(date DESC);
CREATE UNIQUE INDEX idx_activities_source_dedup ON activities(user_id, source, source_meeting_id)
  WHERE source_meeting_id IS NOT NULL;

CREATE TRIGGER set_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activities"
  ON activities FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own activities"
  ON activities FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own activities"
  ON activities FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own activities"
  ON activities FOR DELETE USING (user_id = auth.uid());
