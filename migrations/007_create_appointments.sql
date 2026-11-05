CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  horario timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado', 'cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, horario)
);