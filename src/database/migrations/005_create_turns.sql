CREATE TABLE turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_ids uuid[] NOT NULL,
  status text NOT NULL CHECK (status IN ('iniciado', 'concluido', 'falhou', 'descartado')),
  modelo text,
  provedor text,
  tokens_input int DEFAULT 0,
  tokens_output int DEFAULT 0,
  custo numeric(12, 6) DEFAULT 0,
  custo_referencia numeric(12, 6) DEFAULT 0,
  latencia_ms int,
  acoes text[] DEFAULT '{}',
  erro text,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz
);

CREATE INDEX idx_turns_conversation ON turns (conversation_id, iniciado_em);