import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MockProvider } from "./mock.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { LlmProvider } from "./llm.interface.js";

@Global()
@Module({
  providers: [
    MockProvider,
    OpenAIProvider,
    {
      provide: "LLM_PROVIDER",
      inject: [ConfigService, MockProvider, OpenAIProvider],
      useFactory: (
        config: ConfigService,
        mock: MockProvider,
        real: OpenAIProvider,
      ): LlmProvider => {
        return config.get("LLM_PROVIDER") === "mock" ? mock : real;
      },
    },
  ],
  exports: [MockProvider, OpenAIProvider, "LLM_PROVIDER"],
})
export class LlmModule {}
