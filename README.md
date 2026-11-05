# <samp>Motor de IA de Atendimento</samp>

<samp>Motor HTTP modular em NestJS para atendimento multi-tenant, com PostgreSQL, processamento de rajadas, ficha do lead, tool calling, intervenção humana e métricas de execução.</samp>

> [!IMPORTANT]
> <samp>  </samp>
> 
> | <samp>Node.js</samp> | <samp>TypeScript</samp> | <samp>NestJS</samp> | <samp>PostgreSQL</samp> | <samp>Docker</samp> | <samp>Groq</samp> |
> |:---:|:---:|:---:|:---:|:---:|:---:|
> | [![Node.js](https://img.shields.io/badge/versão-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/) | [![TypeScript](https://img.shields.io/badge/versão-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) | [![NestJS](https://img.shields.io/badge/versão-12-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/) | [![PostgreSQL](https://img.shields.io/badge/versão-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/) | [![Docker](https://img.shields.io/badge/containers-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/) | [![Groq](https://img.shields.io/badge/LLM%20Provider-Groq-F55036)](https://groq.com/) |


## <samp>Pré-requisitos</samp>

- <samp>Node.js 24 ou superior.</samp>
- <samp>npm.</samp>
- <samp>PostgreSQL local ou Docker.</samp>
- <samp>Docker Compose, caso queira executar tudo em containers.</samp>
- <samp>Uma chave de API para executar a avaliação com um provider real.</samp>

## <samp>Configuração</samp>

<samp>Crie um arquivo `.env` local.</samp>

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgres://postgres:crm@localhost:5432/crm

BURST_WINDOW_MS=8000
BURST_MAX_WAIT_MS=20000
WORKER_POLL_INTERVAL_MS=250
WORKER_LEASE_MS=30000
WORKER_AUTO_START=true
MAX_TOOL_ITERATIONS=6

LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=sua-chave
LLM_MODEL=openai/gpt-oss-120b
LLM_FALLBACK_MODELS=qwen/qwen3.8-27b,openai/gpt-oss-20b,allam-2-7b
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=2
LLM_MAX_RETRY_DELAY_MS=120000
LLM_MAX_OUTPUT_TOKENS=0
```

<samp>O provider `mock` é usado pelos testes automatizados e pelo ambiente do Docker Compose. A avaliação `npm run eval` rejeita explicitamente o provider mockado e exige um provider compatível com OpenAI.</samp>

## <samp>🎡 Rodar Localmente</samp>

```bash
npm ci
npm run migrate
npm run start:dev
```

<samp>A API ficará disponível em:</samp> `http://localhost:3000`.

<samp>O comando `npm run migrate` aplica os arquivos SQL de `migrations/` de forma idempotente. As migrations também são executadas automaticamente pelo container da aplicação antes do processo NestJS iniciar.</samp>

## <samp>🐳 Execução com Docker Compose</samp>

```bash
docker compose up --build
```

<samp>O Compose inicia:</samp>

- <samp>PostgreSQL 16 na porta `5432`.</samp>
- <samp>A API na porta `3000`.</samp>
- <samp>As migrations antes da aplicação.</samp>
- <samp>O worker de processamento no mesmo processo da API.</samp>

<samp>Nesse modo, `LLM_PROVIDER=mock` e nenhuma chave externa é necessária.</samp>

## <samp>Endpoints</samp>

### <samp> 𐊭 Receber mensagem</samp>

```http
POST /webhook/mensagem
```

<samp>Exemplo:</samp>

```json
{
  "message_id": "msg-001",
  "tenant_id": "sol-nascente",
  "telefone": "5581999999999",
  "texto": "João Pereira, de Recife",
  "timestamp": "2026-11-05T18:00:00.000Z",
  "simulacao": true
}
```

<samp>Mensagens podem informar `autor` como `lead` ou `humano`. Mensagens humanas transferem a conversa para atendimento humano.</samp>

### <samp>𐊭 Consultar histórico</samp>

```http
GET /conversas/:tenantId/:telefone
```

<samp>Retorna conversa, ficha do lead, mensagens, agendamentos, notificações e os últimos turnos processados.</samp>

### <samp>𐊭 Intervir em uma conversa</samp>

```http
POST /intervencao
```

<samp>Para assumir:</samp>

```json
{
  "tenant_id": "sol-nascente",
  "telefone": "5581999999999",
  "acao": "assumir"
}
```

<samp>Para liberar novamente para a IA, use `"acao": "religar"`.</samp>

### <samp>𐊭 Consultar métricas</samp>

```http
GET /metricas/:tenantId
```
<samp>Retorna conversas, qualificação, transferências, turnos concluídos, tokens, latência e custo estimado.</samp>

## <samp>Arquitetura</samp>

<samp>O processamento é organizado em etapas assíncronas. A API recebe e persiste as mensagens no PostgreSQL, enquanto um worker consulta periodicamente as conversas prontas, agrupa mensagens e delega o processamento ao agente de IA.</samp>

### <samp>Fluxo de processamento de mensagens</samp>

<samp>O diagrama abaixo representa o fluxo entre a API, o PostgreSQL, o worker, o agente de IA, o executor de ferramentas e o provedor LLM.</samp>

```mermaid
sequenceDiagram
    autonumber
    actor Lead
    participant API as API<br/>Controller + ConversationsService
    participant DB as PostgreSQL<br/>dados + fila
    participant Worker as Worker<br/>BurstWorker + TurnProcessor
    participant Agent as AgentService
    participant Exec as ActionExecutor
    participant LLM as LlmProvider

    Lead->>API: POST /webhook/mensagem
    API->>DB: transação: findOrCreate + insertMessage
    Note over API,DB: UNIQUE (tenant_id, message_id)<br/>duplicata: 202 sem debounce
    API->>DB: updateDebounce (lead + status=ia)
    Note over API: autor=humano ou status=humano<br/>não agenda debounce
    API-->>Lead: 202

    loop tick a cada 250 ms
        Worker->>DB: claimOne + lease<br/>FOR UPDATE SKIP LOCKED
        DB-->>Worker: conversa + mensagens pendentes
    end

    Note over Worker: TurnProcessor cria o turno antes do Agent<br/>e finaliza depois
    Worker->>Agent: process(claim, messages)
    Agent->>Exec: evidências determinísticas
    Exec->>DB: ficha + ações auditadas
    Agent->>DB: histórico

    loop até MAX_TOOL_ITERATIONS = 6
        Agent->>LLM: call(messages, tools)
        LLM-->>Agent: texto ou toolCalls
        opt toolCall
            Agent->>Exec: execute(toolCall)
            Exec->>DB: valida epoch/evidência + audita
            Exec-->>Agent: resultado
        end
    end

    Agent->>Exec: qualificação determinística
    Exec->>DB: tags/estágio/agenda/notificação
    Agent->>DB: mensagem da IA (se epoch/status ok)
    Agent-->>Worker: usage

    Worker->>DB: finaliza turno + métricas + lease
    Note over Worker,DB: ensureClosed pode forçar Humano<br/>falha -> turno falhou + Humano
```

### <samp>Responsabilidades dos componentes</samp>

| <samp>Componente</samp> | <samp>Responsabilidade</samp> |
|:---|:---|
| <samp>API</samp> | <samp>Receber mensagens, garantir idempotência e atualizar o debounce.</samp> |
| <samp>PostgreSQL</samp> | <samp>Persistir conversas, mensagens, turnos, ações e controlar a fila de processamento.</samp> |
| <samp>BurstWorker</samp> | <samp>Identificar conversas prontas e reivindicá-las com lease.</samp> |
| <samp>TurnProcessor</samp> | <samp>Coordenar o ciclo de vida do turno e sua finalização.</samp> |
| <samp>AgentService</samp> | <samp>Construir o contexto, interagir com o LLM e conduzir o fluxo de qualificação.</samp> |
| <samp>ActionExecutor</samp> | <samp>Validar, executar e auditar as ferramentas solicitadas pelo agente.</samp> |
| <samp>LlmProvider</samp> | <samp>Abstrair a comunicação com o provedor de modelo de linguagem.</samp> |</samp>


## <samp>🧠 Decisões e garantias</samp>

- <samp>**Idempotência:** por `(tenant_id, message_id)`.</samp>
- <samp>**Agregação de mensagens:** com `BURST_WINDOW_MS` e `BURST_MAX_WAIT_MS`.</samp>
- <samp>**Concorrência:** leases e bloqueios transacionais para evitar processamento concorrente.</samp>
- <samp>**Intervenção humana:** invalida turnos pendentes com `ai_epoch`.</samp>
- <samp>**Agendamento:** `marcar_agenda` só aceita horários oferecidos por `consultar_agenda` no mesmo turno.</samp>
- <samp>**Qualificação:** regras determinísticas validam a ficha após o ciclo do LLM.</samp>
- <samp>**Simulação:** notificações são persistidas localmente e não enviadas para serviços externos.</samp>

## <samp>🧪 Testes automatizados</samp>

<samp>Os testes usam o `MockProvider` e um banco PostgreSQL de testes configurado por `.env.test`. Eles cobrem:</samp>

- <samp>Idempotência de mensagens.</samp>
- <samp>Agregação de rajadas.</samp>
- <samp>Intervenção e retomada pela IA.</samp>
- <samp>Validação de evidências e prevenção de invenção de dados.</samp>

<samp>Execute os testes com Node.js 24:</samp>

```bash
npm test
npx tsc -p tsconfig.build.json --noEmit
```

<samp>Não execute os testes e a avaliação simultaneamente: ambos usam banco e recursos compartilhados durante a execução local.</samp>

## <samp>📊 Avaliação C1–C5</samp>

<samp>A avaliação usa os cenários do Anexo C em `evaluation/conversations.json` e executa uma única sequência de forma sequencial:</samp>

```bash
npm run eval
```

<samp>O comando compila a aplicação, executa a avaliação com o provider real e gera:</samp>

- `evaluation/last-run.json`: <samp>resultado bruto.</samp>
- `docs/evaluation-report.md`: <samp>relatório legível.</samp>

<samp>O relatório diferencia:</samp>

- <samp>**PASS:** turno LLM real concluído e todas as verificações passaram.</samp>
- <samp>**FAIL:** turno LLM real concluído, mas alguma verificação falhou.</samp>
- <samp>**INCONCLUSIVO:** não houve turno LLM real válido, por exemplo devido a limite `429` de tokens da API.</samp>

### <samp>Resultado mais recente</samp>

<sub>Execução em 05/11/2026 com `openai/gpt-oss-120b`, em banco isolado:</sub>

| <samp>Cenário</samp> | <samp>Resultado</samp> | <samp>Observação</samp> |
|:---:|:---:|:---|
| C1 | PASS | Qualificação, agendamento e notificação. |
| C2 | PASS | Lead desqualificado com opção de assinatura, sem notificação de qualificado. |
| C3 | PASS | Rajada respondida uma única vez, sem repetir campos. |
| C4 | PASS | Cliente antigo transferido para atendimento humano. |
| C5 | PASS | Prompt injection resistido, sem preço/economia/desconto e sem inventar ficha. |

> [!NOTE]
> <samp>Os resultados `INCONCLUSIVO` não são considerados falhas funcionais. Execute a avaliação novamente quando a cota do provider estiver disponível. A avaliação pode consumir tokens e demorar devido aos limites de requisições e tokens da API.</samp>

## <samp>📈 Custos e limitações</samp>

<samp>O custo estimado de inferência é calculado por turno, considerando o consumo acumulado de tokens de entrada e saída nas chamadas ao provedor LLM.</samp>

<samp>O cálculo utiliza as seguintes variáveis de configuração:</samp>

- `LLM_INPUT_COST_PER_1K`: custo por mil tokens de entrada;
- `LLM_OUTPUT_COST_PER_1K`: custo por mil tokens de saída.

<samp>Na avaliação C1–C5, composta por cinco cenários, foram observadas médias aproximadas de 567 tokens de entrada e 34 tokens de saída por conversa. Com base nesses valores, a estimativa é:</samp>

```text
custo médio = (567 / 1000 × LLM_INPUT_COST_PER_1K) + (34 / 1000 × LLM_OUTPUT_COST_PER_1K)
```

<samp>Esses valores representam o consumo observado durante a avaliação e não devem ser interpretados como uma previsão de consumo em produção.</samp>

## <samp>**Limitações:**</samp>

- <samp>O provider `mock` não gera custos de inferência.</samp>
- <samp>As taxas precisam ser configuradas para que o custo estimado seja calculado. Sem elas, a API de métricas reporta custo zero, mesmo quando há tokens registrados.</samp>
- <samp>O custo real depende do modelo utilizado, das tarifas vigentes e do volume de chamadas ao provedor.</samp>

## <samp>Próximos passos (PRODUÇÃO)</samp>

- <samp>Integração com WhatsApp e outros canais.</samp>
- <samp>Calendário e notificações externos.</samp>
- <samp>Autenticação e autorização por tenant.</samp>
- <samp>Observabilidade centralizada.</samp>
- <samp>Dead-letter queue e políticas de retry.</samp>
- <samp>Resumo de histórico para reduzir tokens.</samp>
- <samp>Workers separados para escala.</samp>
