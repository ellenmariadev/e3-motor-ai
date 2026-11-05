CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  autor text NOT NULL CHECK (autor IN ('lead', 'humano', 'ia')),
  texto text NOT NULL,
  timestamp timestamptz NOT NULL,
  processada boolean NOT NULL DEFAULT false,
  turn_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);

CREATE INDEX idx_messages_pending
  ON messages (conversation_id, timestamp)
  WHERE processada = false;

CREATE INDEX idx_messages_conversation
  ON messages (conversation_id, timestamp);