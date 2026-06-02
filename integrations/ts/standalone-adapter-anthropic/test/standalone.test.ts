import { describe, expect, it } from "vitest";

import { createProvider, registeredProviders } from "@llmorch/core";

import { PROVIDER_ID } from "../src/index.js";

describe("standalone-adapter-anthropic", () => {
  it("self-registers the anthropic provider at import", () => {
    expect(registeredProviders()).toContain("anthropic");
    expect(PROVIDER_ID).toBe("anthropic");
  });

  it("constructs a provider implementing the full LLMProvider port", () => {
    const provider = createProvider("anthropic", { apiKey: "test-key" });
    expect(provider.providerId).toBe("anthropic");
    const methods = [
      "chat",
      "stream",
      "generateStructured",
      "invokeTool",
      "resumeTool",
    ] as const;
    for (const method of methods) {
      expect(typeof provider[method]).toBe("function");
    }
  });
});
