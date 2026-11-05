CREATE TABLE interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  acao text NOT NULL CHECK (acao IN ('assumir', 'religar')),
  created_at timestamptz NOT NULL DEFAULT now()
);