-- Shortlists: named sub-lists for people and companies

CREATE TABLE shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'company')),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shortlists_user_id ON shortlists(user_id);
CREATE INDEX idx_shortlists_entity_type ON shortlists(user_id, entity_type);

CREATE TRIGGER shortlists_updated_at
  BEFORE UPDATE ON shortlists
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE shortlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY shortlists_select ON shortlists FOR SELECT USING (user_id = auth.uid());
CREATE POLICY shortlists_insert ON shortlists FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY shortlists_update ON shortlists FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY shortlists_delete ON shortlists FOR DELETE USING (user_id = auth.uid());

CREATE TABLE shortlist_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortlist_id UUID NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT exactly_one_entity CHECK (
    (person_id IS NOT NULL AND company_id IS NULL) OR
    (person_id IS NULL AND company_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_shortlist_members_person ON shortlist_members(shortlist_id, person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX idx_shortlist_members_company ON shortlist_members(shortlist_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_shortlist_members_shortlist ON shortlist_members(shortlist_id);

ALTER TABLE shortlist_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY shortlist_members_select ON shortlist_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM shortlists WHERE id = shortlist_id AND user_id = auth.uid()));
CREATE POLICY shortlist_members_insert ON shortlist_members FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM shortlists WHERE id = shortlist_id AND user_id = auth.uid()));
CREATE POLICY shortlist_members_update ON shortlist_members FOR UPDATE
  USING (EXISTS (SELECT 1 FROM shortlists WHERE id = shortlist_id AND user_id = auth.uid()));
CREATE POLICY shortlist_members_delete ON shortlist_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM shortlists WHERE id = shortlist_id AND user_id = auth.uid()));
