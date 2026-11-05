import { readFileSync, writeFileSync } from 'node:fs';

const conversations = JSON.parse(
  readFileSync(new URL('./conversations.json', import.meta.url), 'utf8'),
) as any[];
const raw = JSON.parse(
  readFileSync(new URL('./last-run.json', import.meta.url), 'utf8'),
) as any[];

const lines: string[] = ['# Relatório de avaliação C1–C5\n'];
for (const c of conversations as any[]) {
  const r = (raw as any[]).find((x) => x.id === c.id);
  const history = r?.hist;
  const conversation = history?.conversa;
  const messages = history?.mensagens ?? [];
  const appointments = history?.agendamentos ?? [];
  const notifications = history?.notificacoes ?? [];
  const text = messages
    .filter((message: any) => message.autor === "ia")
    .map((message: any) => message.texto)
    .join(" ")
    .toLowerCase();
  const expected = c.esperado ?? {};
  const checks = [
    expected.tags_contem?.every((tag: string) =>
      conversation?.tags?.includes(tag),
    ),
    expected.estagio ? conversation?.estagio === expected.estagio : true,
    expected.status_final ? conversation?.status === expected.status_final : true,
    expected.tem_agendamento ? appointments.length > 0 : true,
    expected.tem_notificacao ? notifications.length > 0 : true,
    expected.tem_notificacao_qualificado
      ? notifications.some((notification: any) =>
          notification.resumo.toLowerCase().includes("qualific"),
        )
      : true,
    expected.tem_notificacao_qualificado === false
      ? !notifications.some((notification: any) =>
          notification.resumo.toLowerCase().includes("qualific"),
        )
      : true,
    expected.uma_resposta_para_burst
      ? messages.filter((message: any) => message.autor === "ia").length === 1
      : true,
    expected.menciona_assinatura
      ? text.includes("assinatura") || text.includes("outra opção")
      : true,
    expected.sem_preco
      ? !text.includes("r$") && !text.includes("preço") && !text.includes("custo")
      : true,
    expected.sem_promessa_economia
      ? !text.includes("50%") && !text.includes("zerar")
      : true,
    expected.sem_desconto ? !text.includes("desconto") : true,
    expected.ficha_sem_invencao ? Object.keys(history?.ficha ?? {}).length === 0 : true,
  ];
  const passed = Boolean(r) && checks.every(Boolean);
  lines.push(`## ${c.id} — ${passed ? "PASS" : "FAIL"}`);
  lines.push(`- Resultado esperado: ${JSON.stringify(expected)}`);
  lines.push(`- Verificações: ${checks.map((check) => (check ? "OK" : "FALHOU")).join(", ")}`);
}
writeFileSync('docs/evaluation-report.md', lines.join('\n'));