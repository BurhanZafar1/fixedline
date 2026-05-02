-- Atomic JSONB array append for conversation messages
-- Prevents race conditions under concurrent message writes

CREATE OR REPLACE FUNCTION append_conversation_message(
  p_conversation_id UUID,
  p_message JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE conversations
  SET
    messages = messages || p_message::jsonb,
    updated_at = NOW()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation % not found', p_conversation_id;
  END IF;
END;
$$;
