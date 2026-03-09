-- Prevent duplicate people: same user + name + title + company
-- First, remove exact duplicates keeping the oldest record
DELETE FROM people a
  USING people b
  WHERE a.user_id = b.user_id
    AND lower(trim(a.first_name)) = lower(trim(b.first_name))
    AND lower(trim(a.last_name)) = lower(trim(b.last_name))
    AND lower(trim(coalesce(a.current_title, ''))) = lower(trim(coalesce(b.current_title, '')))
    AND lower(trim(coalesce(a.current_company, ''))) = lower(trim(coalesce(b.current_company, '')))
    AND a.created_at > b.created_at;

-- Add unique index to prevent future duplicates
CREATE UNIQUE INDEX idx_people_dedup ON people (
  user_id,
  lower(trim(first_name)),
  lower(trim(last_name)),
  lower(trim(coalesce(current_title, ''))),
  lower(trim(coalesce(current_company, '')))
);
