import { Injectable } from "@nestjs/common";
import { LlmProvider, LlmResponse, LlmToolCall } from "./llm.interface.js";

export type MockStep =
  { type: "tool"; toolCalls: LlmToolCall[] } | { type: "text"; text: string };

@Injectable()
export class MockProvider implements LlmProvider {
  private queue: MockStep[] = [];
  private readonly defaultText = "Ok, entendi.";

  enqueue(...steps: MockStep[]) {
    this.queue.push(...steps);
  }

  reset() {
    this.queue = [];
  }

  async call(): Promise<LlmResponse> {
    const step = this.queue.shift();
    if (!step) {
      return {
        text: this.defaultText,
        usage: {
          provider: "mock",
          model: "mock-1",
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    }
    if (step.type === "text") {
      return {
        text: step.text,
        usage: {
          provider: "mock",
          model: "mock-1",
          inputTokens: 10,
          outputTokens: 10,
        },
      };
    }
    return {
      toolCalls: step.toolCalls,
      usage: {
        provider: "mock",
        model: "mock-1",
        inputTokens: 10,
        outputTokens: 10,
      },
    };
  }
}
