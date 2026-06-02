import { describe, expect, it } from "vitest";

import { createProvider, registeredProviders } from "@llmorch/core";

import { PROVIDER_ID } from "../src/index.js";

describe("standalone-adapter-openai", () => {
  it("self-registers the openai provider at import", () => {
    expect(registeredProviders()).toContain("openai");
    expect(PROVIDER_ID).toBe("openai");
  });

  it("constructs a provider implementing the full LLMProvider port", () => {
    const provider = createProvider("openai", { apiKey: "test-key" });
    expect(provider.providerId).toBe("openai");
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
