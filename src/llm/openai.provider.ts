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

  async call(params: {
    messages: LlmMessage[];
    tools: LlmTool[];
  }): Promise<LlmResponse> {
    const baseUrl = this.config.getOrThrow<string>("LLM_BASE_URL");
    const apiKey = this.config.getOrThrow<string>("LLM_API_KEY");
    const model = this.config.getOrThrow<string>("LLM_MODEL");
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
      if (!res.ok) {
        throw new Error(`LLM ${res.status}: ${await res.text()}`);
      }
      const json: any = await res.json();
      const choice = json.choices[0].message;
      return {
        text: choice.content ?? undefined,
        toolCalls: (choice.tool_calls ?? []).map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
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
}
