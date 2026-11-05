import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  LlmProvider,
  LlmResponse,
  LlmMessage,
  LlmTool,
} from "./llm.interface.js";

@Injectable()
export class OpenAIProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAIProvider.name);

  constructor(private readonly config: ConfigService) {}

  async call(
    params: {
      messages: LlmMessage[];
      tools: LlmTool[];
    },
    retryCount = 0,
    modelIndex = 0,
  ): Promise<LlmResponse> {
    const baseUrl = this.config.getOrThrow<string>("LLM_BASE_URL");
    const apiKey = this.config.getOrThrow<string>("LLM_API_KEY");
    const primaryModel = this.config.getOrThrow<string>("LLM_MODEL");
    const models = [
      primaryModel,
      ...String(this.config.get("LLM_FALLBACK_MODELS", ""))
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model && model !== primaryModel),
    ];
    const model = models[Math.min(modelIndex, models.length - 1)];
    const timeoutMs = Number(this.config.get("LLM_TIMEOUT_MS", 30000));

    const body: any = {
      model,
      messages: params.messages.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            content: m.content,
            tool_call_id: m.tool_call_id,
          };
        }
        if (m.role === "assistant" && m.tool_calls) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.tool_calls,
          };
        }
        return { role: m.role, content: m.content };
      }),
    };
    if (params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = "auto";
    }
    const maxOutputTokens = Number(this.config.get("LLM_MAX_OUTPUT_TOKENS", 0));
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      body.max_tokens = maxOutputTokens;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429) {
        const responseBody = await res.text();
        if (this.isDailyTokenLimit(responseBody)) {
          const nextIndex = modelIndex + 1;
          if (nextIndex < models.length) {
            this.logger.warn(
              `Limite diário de tokens no modelo ${model}; tentando ${models[nextIndex]}...`,
            );
            return this.call(params, 0, nextIndex);
          }
          throw new Error(
            `LLM 429 limite diário de tokens: ${this.rateLimitDetails(
              res,
              responseBody,
            )}`,
          );
        }
        const maxRetries = Number(this.config.get("LLM_MAX_RETRIES", 2));
        if (retryCount >= maxRetries) {
          throw new Error(
            `LLM 429 após ${maxRetries} tentativas: ${this.rateLimitDetails(
              res,
              responseBody,
            )}`,
          );
        }
        const retryAfterSeconds = Number(res.headers.get("retry-after") ?? 5);
        const resetTokens = res.headers.get("x-ratelimit-reset-tokens");
        const resetDelayMs = resetTokens
          ? this.parseResetDuration(resetTokens)
          : 0;
        const maxRetryDelayMs = Number(
          this.config.get("LLM_MAX_RETRY_DELAY_MS", 120000),
        );
        const retryDelayMs = Math.min(
          Math.max(retryAfterSeconds * 1000, resetDelayMs, 0),
          maxRetryDelayMs,
        );
        this.logger.warn(
          `Rate limit 429. Aguardando ${retryDelayMs}ms e retentando...`,
        );
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return this.call(params, retryCount + 1, modelIndex);
      }
      if (!res.ok) {
        const responseBody = await res.text();
        if (
          res.status === 400 &&
          responseBody.includes("attempted to call tool") &&
          responseBody.includes("which was not in request.tools") &&
          params.tools.length > 0
        ) {
          this.logger.warn(
            "The model returned an invalid tool name; retrying once without tools so deterministic actions can finish the turn.",
          );
          return this.call({ ...params, tools: [] }, retryCount, modelIndex);
        }
        if (
          res.status === 400 &&
          params.tools.length === 0 &&
          responseBody.includes("Tool choice is none, but model called a tool")
        ) {
          this.logger.warn(
            "The model emitted a tool call although tools were disabled; continuing with backend deterministic actions.",
          );
          return {
            text: undefined,
            usage: {
              provider: "openai-compatible",
              model,
              inputTokens: 0,
              outputTokens: 0,
            },
          };
        }
        throw new Error(`LLM ${res.status}: ${responseBody}`);
      }
      const json: any = await res.json();
      const choice = json.choices[0].message;
      return {
        text: choice.content ?? undefined,
        toolCalls: (choice.tool_calls ?? []).map((tc: any) => ({
          id: tc.id,
          name: this.normalizeToolName(tc.function.name),
          arguments: JSON.parse(tc.function.arguments ?? "{}"),
        })),
        usage: {
          provider: "openai-compatible",
          model,
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private rateLimitDetails(res: Response, body: string) {
    const details = {
      body,
      retryAfter: res.headers.get("retry-after"),
      remainingRequests:
        res.headers.get("x-ratelimit-remaining-requests") ??
        res.headers.get("x-ratelimit-remaining-request"),
      remainingTokens: res.headers.get("x-ratelimit-remaining-tokens"),
      resetRequests: res.headers.get("x-ratelimit-reset-requests"),
      resetTokens: res.headers.get("x-ratelimit-reset-tokens"),
    };
    return JSON.stringify(details);
  }

  private isDailyTokenLimit(body: string): boolean {
    return /tokens per day|\bTPD\b/i.test(body);
  }

  private parseResetDuration(value: string): number {
    const match = value.match(
      /^\s*(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?\s*$/,
    );
    if (!match) return 0;
    return (
      Number(match[1] ?? 0) * 3600000 +
      Number(match[2] ?? 0) * 60000 +
      Number(match[3] ?? 0) * 1000 +
      250
    );
  }

  private normalizeToolName(name: unknown): string {
    if (typeof name !== "string") {
      throw new Error("LLM retornou nome de ferramenta inválido");
    }
    return name.split("<|channel|>", 1)[0].trim();
  }
}
