export interface TenantConfig {
  tenant_id: string;
  nome_empresa: string;
  tom: "formal" | "informal";
  pode_dizer_que_e_ia: boolean;
  nome_assistente: string;
  horario_atendimento_ia: string;
  telefone_notificacao: string;
  cidades_atendidas: string[];
  estagios: string[];
  tags_permitidas: string[];
  regras_gerais: string[];
}
