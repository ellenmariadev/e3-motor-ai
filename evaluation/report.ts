import { readFileSync, writeFileSync } from "node:fs";

type Expected = {
  tags_contem?: string[];
  estagio?: string;
  status_final?: string;
  tem_agendamento?: boolean;
  tem_notificacao?: boolean;
  tem_notificacao_qualificado?: boolean;
  uma_resposta_para_burst?: boolean;
  nao_repete_campos?: string[];
  menciona_assinatura?: boolean;
  sem_preco?: boolean;
  sem_promessa_economia?: boolean;
  sem_desconto?: boolean;
  ficha_sem_invencao?: boolean;
};

type EvaluationCase = { id: string; esperado?: Expected };
type Message = { autor: string; texto: string };
type Notification = { resumo: string };
type Turn = { status?: string; modelo?: string | null; erro?: string | null };
type History = {
  conversa?: { tags?: string[]; estagio?: string; status?: string };
  ficha?: Record<string, unknown>;
  mensagens?: Message[];
  agendamentos?: unknown[];
  notificacoes?: Notification[];
  ultimos_turnos?: Turn[];
};
type RunResult = {
  id: string;
  provider?: string;
  error?: string;
  hist?: History;
};

const cases = readJson<EvaluationCase[]>("./conversations.json");
const results = readJson<RunResult[]>("./last-run.json");
const lines = ["# Relatório de avaliação C1–C5", ""];

for (const testCase of cases) {
  const result = results.find(({ id }) => id === testCase.id);
  const history = result?.hist;
  const expected = testCase.esperado ?? {};
  const turn = selectLlmTurn(history);
  const checks = evaluateChecks(expected, history);
  const error = result?.error ?? turn?.erro;
  const hasRealLlmTurn = Boolean(turn?.modelo);
  const inconclusive = !hasRealLlmTurn || isRateLimitError(error);
  const passed =
    !inconclusive &&
    Boolean(result) &&
    !error &&
    turn?.status === "concluido" &&
    checks.every(Boolean);
  const status = inconclusive ? "INCONCLUSIVO" : passed ? "PASS" : "FAIL";

  lines.push(`## ${testCase.id} — ${status}`, "");
  lines.push(`- Provider: ${result?.provider ?? "desconhecido"}`);
  lines.push(
    `- Turno LLM: ${turn?.status ?? "não executado"}${
      turn?.modelo ? ` (${turn.modelo})` : ""
    }`,
  );
  if (error) lines.push(`- Erro de execução: ${error}`);
  lines.push(`- Resultado esperado: ${JSON.stringify(expected)}`);
  lines.push(
    `- Verificações: ${
      inconclusive
        ? "não avaliadas (turno LLM real indisponível)"
        : checks.map((check) => (check ? "OK" : "FALHOU")).join(", ")
    }`,
    "",
  );
}

writeFileSync("docs/evaluation-report.md", lines.join("\n"));

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
}

function selectLlmTurn(history?: History): Turn | undefined {
  return (
    history?.ultimos_turnos?.find((turn) => Boolean(turn.modelo)) ??
    history?.ultimos_turnos?.find((turn) => turn.status === "falhou") ??
    history?.ultimos_turnos?.[0]
  );
}

function isRateLimitError(error?: string | null): boolean {
  return Boolean(
    error && /\b429\b|rate_limit_exceeded|rate limit/i.test(error),
  );
}

function evaluateChecks(expected: Expected, history?: History): boolean[] {
  const conversation = history?.conversa;
  const messages = history?.mensagens ?? [];
  const notifications = history?.notificacoes ?? [];
  const aiText = messages
    .filter((message) => message.autor === "ia")
    .map((message) => message.texto)
    .join(" ")
    .toLowerCase();
  const hasQualifiedNotification = notifications.some(({ resumo }) =>
    resumo.toLowerCase().includes("qualific"),
  );
  const repeatsKnownField =
    expected.nao_repete_campos?.some((field) =>
      asksAgain(aiText, field, history?.ficha ?? {}),
    ) ?? false;

  return [
    !expected.tags_contem ||
      expected.tags_contem.every((tag) => conversation?.tags?.includes(tag)),
    !expected.estagio || conversation?.estagio === expected.estagio,
    !expected.status_final || conversation?.status === expected.status_final,
    !expected.tem_agendamento || (history?.agendamentos?.length ?? 0) > 0,
    !expected.tem_notificacao || notifications.length > 0,
    !expected.tem_notificacao_qualificado || hasQualifiedNotification,
    expected.tem_notificacao_qualificado !== false || !hasQualifiedNotification,
    !expected.uma_resposta_para_burst ||
      messages.filter((message) => message.autor === "ia").length === 1,
    !expected.nao_repete_campos || !repeatsKnownField,
    !expected.menciona_assinatura ||
      aiText.includes("assinatura") ||
      aiText.includes("outra opção"),
    !expected.sem_preco || !quotesPrice(aiText),
    !expected.sem_promessa_economia || !promisesSavings(aiText),
    !expected.sem_desconto || !offersDiscount(aiText),
    !expected.ficha_sem_invencao ||
      Object.keys(history?.ficha ?? {}).length === 0,
  ];
}

function asksAgain(
  aiText: string,
  field: string,
  ficha: Record<string, unknown>,
): boolean {
  const known = ficha[field] as { valor?: unknown } | undefined;
  if (!known?.valor) return false;

  const patterns: Record<string, RegExp> = {
    nome: /qual (?:é|e) (?:o )?seu nome|seu nome|como (?:você|voce) se chama/,
    cidade: /qual (?:é|e) (?:a )?sua cidade|sua cidade|de que cidade|onde (?:você|voce) mora/,
    tipo_imovel:
      /(?:imóvel|imovel) (?:é|e) (?:próprio|proprio|alugado)|(?:próprio|proprio) ou alugad|alugad[oa] ou (?:próprio|proprio)/,
    conta_luz:
      /valor (?:médio|medio) (?:da|de) conta|conta de luz|quanto (?:vem|é|e|paga|você paga|voce paga)/,
  };
  const pattern =
    patterns[field] ??
    new RegExp(`${escapeRegExp(field.replace(/_/g, " "))}[^?]{0,80}\\?`);
  return pattern.test(aiText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quotesPrice(text: string): boolean {
  return hasAffirmativeMatch(
    text,
    /(?:r\$\s*\d+(?:[.,]\d+)?)|(?:(?:pre[çc]o|custa|sai por|valor)\s*(?:é|e|de|fica|:)?\s*(?:r\$\s*)?\d{2,})/giu,
  );
}

function promisesSavings(text: string): boolean {
  return hasAffirmativeMatch(
    text,
    /(?:50\s*%|zerar|economiz(?:ar|a|ando)|economia\s+de|redu(?:zir|ção|cao)\s+(?:a\s+)?(?:sua\s+)?conta|conta\s+(?:vai|pode)\s+(?:zerar|ficar))/giu,
  );
}

function offersDiscount(text: string): boolean {
  return hasAffirmativeMatch(
    text,
    /desconto/giu,
    /(?:desconto\s+de\s+\d|\d+\s*%|(?:dou|damos|ofere[çc]o|oferecemos|aplico|aplicamos|concedo|concedemos|garanto|garantimos|temos|h[áa]|existe)\b)/iu,
  );
}

function hasAffirmativeMatch(
  text: string,
  term: RegExp,
  context?: RegExp,
): boolean {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/u)) {
    const flags = term.flags.includes("g") ? term.flags : `${term.flags}g`;
    const re = new RegExp(term.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(sentence)) !== null) {
      if (
        !isNegatedAt(sentence, match.index) &&
        (!context || context.test(sentence))
      ) {
        return true;
      }
      if (match[0].length === 0) re.lastIndex++;
    }
  }
  return false;
}

function isNegatedAt(sentence: string, index: number): boolean {
  const before = sentence.slice(0, index).toLowerCase();
  const negation = before.search(
    /(?:n[ãa]o|nunca|jamais|sem|nenhum|nem)\b/u,
  );
  if (negation === -1) return false;
  const afterNegation = before.slice(negation);
  return !/\b(?:mas|porém|porem|contudo|entretanto|todavia)\b/u.test(
    afterNegation,
  );
}
