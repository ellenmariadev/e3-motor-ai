export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LlmResponse {
  text?: string;
  toolCalls?: LlmToolCall[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmProvider {
  call(params: {
    messages: LlmMessage[];
    tools: LlmTool[];
  }): Promise<LlmResponse>;
}
