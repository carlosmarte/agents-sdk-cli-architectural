import { describe, expect, it } from "vitest";

import { createProvider, registeredProviders } from "@llmorch/core";

import { PROVIDER_ID } from "../src/index.js";

describe("standalone-adapter-local", () => {
  it("self-registers the local provider at import", () => {
    expect(registeredProviders()).toContain("local");
    expect(PROVIDER_ID).toBe("local");
  });

  it("constructs a provider implementing the full LLMProvider port", () => {
    const provider = createProvider("local", { apiKey: "test-key" });
    expect(provider.providerId).toBe("local");
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
