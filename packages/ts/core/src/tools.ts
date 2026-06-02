/**
 * Provider-neutral → provider-specific tool-definition translators, shared by
 * every adapter's `invokeTool`. The application defines tools once as
 * {@link ToolDefinition}; each adapter translates them into the proprietary shape
 * the SDK expects. The manual halt→resume loop itself lives in the adapters; this
 * module only owns the (pure, testable) translation.
 */
import type { ToolDefinition } from "./models/index.js";

/** OpenAI / Copilot function-tool array. */
export function toOpenAITools(defs: ToolDefinition[]): Array<Record<string, unknown>> {
  return defs.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));
}

/** Anthropic tools: a flat array with `input_schema`. */
export function toAnthropicTools(defs: ToolDefinition[]): Array<Record<string, unknown>> {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
  }));
}

/** Gemini tools: a single entry holding `functionDeclarations`. */
export function toGeminiTools(defs: ToolDefinition[]): Array<Record<string, unknown>> {
  return [
    {
      functionDeclarations: defs.map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      })),
    },
  ];
}
