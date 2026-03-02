-- Fix: add auth.uid() check to prevent calling with arbitrary user_id
CREATE OR REPLACE FUNCTION create_default_kanban_columns(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Only allow creating columns for the authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Cannot create kanban columns for another user';
  END IF;

  INSERT INTO kanban_columns (user_id, title, color, position)
  VALUES
    (p_user_id, 'New Contact', '#6366f1', 1),
    (p_user_id, 'Reached Out', '#f59e0b', 2),
    (p_user_id, 'In Conversation', '#3b82f6', 3),
    (p_user_id, 'Opportunity', '#10b981', 4),
    (p_user_id, 'Closed', '#ef4444', 5);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
