CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  telefone text NOT NULL,
  status text NOT NULL DEFAULT 'ia'
    CHECK (status IN ('ia', 'humano')),
  estagio text NOT NULL DEFAULT 'Novo',
  tags text[] NOT NULL DEFAULT '{}',
  simulacao boolean NOT NULL DEFAULT false,
  ai_epoch int NOT NULL DEFAULT 0,
  debounce_until timestamptz,
  first_pending_at timestamptz,
  processing_until timestamptz,
  processing_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, telefone)
);

CREATE INDEX idx_conversations_tenant_telefone
  ON conversations (tenant_id, telefone);

CREATE INDEX idx_conversations_ready
  ON conversations (debounce_until)
  WHERE debounce_until IS NOT NULL
    AND status = 'ia';