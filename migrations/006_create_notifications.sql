CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  resumo text NOT NULL,
  horario timestamptz,
  simulacao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);