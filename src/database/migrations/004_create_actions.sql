CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id uuid,
  tool_call_id text,
  ferramenta text NOT NULL,
  argumentos jsonb NOT NULL,
  resultado jsonb,
  status text NOT NULL CHECK (status IN ('executada', 'rejeitada', 'erro')),
  simulacao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_actions_dedup
  ON actions (turn_id, tool_call_id)
  WHERE tool_call_id IS NOT NULL;

CREATE INDEX idx_actions_conversation ON actions (conversation_id, created_at);