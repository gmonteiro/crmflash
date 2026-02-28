-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Updated at trigger function
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Companies
-- ============================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  linkedin_url TEXT,
  industry TEXT,
  size_tier TEXT CHECK (size_tier IN ('Micro', 'Small', 'Medium', 'Large', 'Enterprise')),
  estimated_revenue NUMERIC,
  employee_count INTEGER,
  description TEXT,
  logo_url TEXT,
  website TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_user_id ON companies(user_id);
CREATE INDEX idx_companies_name_trgm ON companies USING gin (name gin_trgm_ops);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select ON companies FOR SELECT USING (user_id = auth.uid());
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY companies_update ON companies FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY companies_delete ON companies FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- Kanban Columns
-- ============================================
CREATE TABLE kanban_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  position FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kanban_columns_user_id ON kanban_columns(user_id);

CREATE TRIGGER kanban_columns_updated_at
  BEFORE UPDATE ON kanban_columns
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- RLS
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY kanban_columns_select ON kanban_columns FOR SELECT USING (user_id = auth.uid());
CREATE POLICY kanban_columns_insert ON kanban_columns FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY kanban_columns_update ON kanban_columns FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY kanban_columns_delete ON kanban_columns FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- People
-- ============================================
CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  current_title TEXT,
  current_company TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  category TEXT,
  notes TEXT,
  avatar_url TEXT,
  linkedin_enriched_at TIMESTAMPTZ,
  linkedin_raw_data JSONB,
  kanban_column_id UUID REFERENCES kanban_columns(id) ON DELETE SET NULL,
  kanban_position FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_people_user_id ON people(user_id);
CREATE INDEX idx_people_company_id ON people(company_id);
CREATE INDEX idx_people_kanban ON people(kanban_column_id, kanban_position);
CREATE INDEX idx_people_full_name_trgm ON people USING gin (full_name gin_trgm_ops);

CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- RLS
ALTER TABLE people ENABLE ROW LEVEL SECURITY;

CREATE POLICY people_select ON people FOR SELECT USING (user_id = auth.uid());
CREATE POLICY people_insert ON people FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY people_update ON people FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY people_delete ON people FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- Tags
-- ============================================
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tags_user_id ON tags(user_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select ON tags FOR SELECT USING (user_id = auth.uid());
CREATE POLICY tags_insert ON tags FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY tags_update ON tags FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY tags_delete ON tags FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- People Tags (N:N)
-- ============================================
CREATE TABLE people_tags (
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, tag_id)
);

ALTER TABLE people_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY people_tags_select ON people_tags FOR SELECT
  USING (EXISTS (SELECT 1 FROM people WHERE people.id = person_id AND people.user_id = auth.uid()));
CREATE POLICY people_tags_insert ON people_tags FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM people WHERE people.id = person_id AND people.user_id = auth.uid()));
CREATE POLICY people_tags_delete ON people_tags FOR DELETE
  USING (EXISTS (SELECT 1 FROM people WHERE people.id = person_id AND people.user_id = auth.uid()));

-- ============================================
-- Import History
-- ============================================
CREATE TABLE import_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'xlsx')),
  row_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  column_mapping JSONB,
  errors JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_import_history_user_id ON import_history(user_id);

ALTER TABLE import_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_history_select ON import_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY import_history_insert ON import_history FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY import_history_update ON import_history FOR UPDATE USING (user_id = auth.uid());

-- ============================================
-- Default Kanban Columns Function
-- ============================================
CREATE OR REPLACE FUNCTION create_default_kanban_columns(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO kanban_columns (user_id, title, color, position)
  VALUES
    (p_user_id, 'New Contact', '#6366f1', 1),
    (p_user_id, 'Reached Out', '#f59e0b', 2),
    (p_user_id, 'In Conversation', '#3b82f6', 3),
    (p_user_id, 'Opportunity', '#10b981', 4),
    (p_user_id, 'Closed', '#ef4444', 5);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
