/**
 * Build a `ChatRequest` from resolved flags + a prompt. The `ChatRequest.model`
 * field is required by the contract, so when no `--model` is given we fall back to
 * the provider's default model (or a placeholder for the `fake` provider, which
 * ignores it). The `ChatRequest` type import is type-only and erased at compile,
 * so this module pulls in no `@llmorch/core` runtime code.
 */
import type { ChatRequest } from "@llmorch/core";

import type { ResolvedFlags } from "./flags.js";
import { defaultModelFor } from "./manifest.js";

export function buildChatRequest(flags: ResolvedFlags, prompt: string): ChatRequest {
  const model = flags.model ?? defaultModelFor(flags.provider) ?? "default";
  const req: ChatRequest = {
    model,
    messages: [{ role: "user", content: prompt }],
  };
  if (flags.temperature !== undefined) req.temperature = flags.temperature;
  if (flags.maxTokens !== undefined) req.maxTokens = flags.maxTokens;
  return req;
}
