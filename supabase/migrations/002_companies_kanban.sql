-- Add kanban fields to companies table (run via Supabase SQL Editor)
ALTER TABLE companies
  ADD COLUMN kanban_column_id UUID REFERENCES kanban_columns(id) ON DELETE SET NULL,
  ADD COLUMN kanban_position FLOAT DEFAULT 0;

CREATE INDEX idx_companies_kanban ON companies(kanban_column_id, kanban_position);
