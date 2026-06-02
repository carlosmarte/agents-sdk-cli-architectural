import { describe, expect, it } from "vitest";

import { createProvider, registeredProviders } from "@llmorch/core";

import { PROVIDER_ID } from "../src/index.js";

describe("standalone-adapter-gemini", () => {
  it("self-registers the gemini provider at import", () => {
    expect(registeredProviders()).toContain("gemini");
    expect(PROVIDER_ID).toBe("gemini");
  });

  it("constructs a provider implementing the full LLMProvider port", () => {
    const provider = createProvider("gemini", { apiKey: "test-key" });
    expect(provider.providerId).toBe("gemini");
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
