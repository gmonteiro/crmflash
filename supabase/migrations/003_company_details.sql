-- Company documents metadata (files stored in Supabase Storage)
CREATE TABLE company_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  doc_type TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('contract', 'proposal', 'invoice', 'report', 'other')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_documents_company ON company_documents(company_id);
CREATE INDEX idx_company_documents_user ON company_documents(user_id);

CREATE TRIGGER set_company_documents_updated_at
  BEFORE UPDATE ON company_documents
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company documents"
  ON company_documents FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own company documents"
  ON company_documents FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own company documents"
  ON company_documents FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own company documents"
  ON company_documents FOR DELETE USING (user_id = auth.uid());

-- Company activities / timeline events
CREATE TABLE company_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note'
    CHECK (type IN ('meeting', 'call', 'email', 'note', 'document_uploaded', 'next_step_created')),
  title TEXT NOT NULL,
  description TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_activities_company ON company_activities(company_id);
CREATE INDEX idx_company_activities_user ON company_activities(user_id);
CREATE INDEX idx_company_activities_date ON company_activities(date DESC);

ALTER TABLE company_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company activities"
  ON company_activities FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own company activities"
  ON company_activities FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own company activities"
  ON company_activities FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own company activities"
  ON company_activities FOR DELETE USING (user_id = auth.uid());

-- Company next steps (tasks with due dates)
CREATE TABLE company_next_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_next_steps_company ON company_next_steps(company_id);
CREATE INDEX idx_company_next_steps_user ON company_next_steps(user_id);
CREATE INDEX idx_company_next_steps_due ON company_next_steps(due_date);
CREATE INDEX idx_company_next_steps_user_status_due ON company_next_steps(user_id, status, due_date);

CREATE TRIGGER set_company_next_steps_updated_at
  BEFORE UPDATE ON company_next_steps
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE company_next_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company next steps"
  ON company_next_steps FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own company next steps"
  ON company_next_steps FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own company next steps"
  ON company_next_steps FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own company next steps"
  ON company_next_steps FOR DELETE USING (user_id = auth.uid());

-- Supabase Storage bucket for company documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-documents', 'company-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: user can only access their own folder
CREATE POLICY "Users can view own company document files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can upload own company document files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own company document files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'company-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
