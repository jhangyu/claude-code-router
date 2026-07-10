import { UnifiedChatRequest } from "../types/llm";
import { Transformer, TransformerOptions } from "../types/transformer";

/**
 * Default mapping from named effort levels to Anthropic-style budget_tokens.
 * Override with the `max_tokens` option in transformer config.
 *
 * - "high"   → 16000  (Anthropic: thinks deeply, OpenAI/Gemini: high)
 * - "medium" → 4096   (moderate reasoning)
 * - "low"    → 1024   (minimal reasoning)
 * - "none"   → disabled entirely
 */
const EFFORT_TO_MAX_TOKENS: Record<string, number> = {
  high: 16000,
  medium: 4096,
  low: 1024,
};

/**
 * Override the reasoning effort level for specific models.
 *
 * Supported effort values: "none" | "low" | "medium" | "high"
 *
 * Config example:
 * ```json
 * {
 *   "transformers": [
 *     {
 *       "name": "effort",
 *       "options": { "effort": "high" },
 *       "models": ["deepseek,deepseek-reasoner"]
 *     },
 *     {
 *       "name": "effort",
 *       "options": { "effort": "low", "max_tokens": 512 },
 *       "models": ["groq,llama-3.3-70b"]
 *     }
 *   ]
 * }
 * ```
 *
 * Protocol mapping:
 * - OpenAI / OpenAI Responses: `reasoning.effort` → request body
 * - Gemini 3: `reasoning.effort` → `thinkingConfig.thinkingLevel`
 * - Gemini <3: `reasoning.max_tokens` → `thinkingConfig.thinkingBudget`
 * - Anthropic-style (via `reasoning` transformer): `reasoning.max_tokens` → `thinking.budget_tokens`
 */
export class EffortTransformer implements Transformer {
  static TransformerName = "effort";

  private effort?: string;
  private max_tokens?: number;

  constructor(private readonly options?: TransformerOptions) {
    this.effort = this.options?.effort;
    this.max_tokens = this.options?.max_tokens;
  }

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    if (!this.effort) return request;

    if (!request.reasoning) {
      request.reasoning = {};
    }

    if (this.effort === "none") {
      request.reasoning.enabled = false;
      request.reasoning.effort = "none";
      request.reasoning.max_tokens = 0;
    } else {
      request.reasoning.enabled = true;
      request.reasoning.effort = this.effort;

      if (this.max_tokens !== undefined) {
        request.reasoning.max_tokens = this.max_tokens;
      } else if (this.effort in EFFORT_TO_MAX_TOKENS) {
        request.reasoning.max_tokens = EFFORT_TO_MAX_TOKENS[this.effort];
      }
    }

    return request;
  }
}
