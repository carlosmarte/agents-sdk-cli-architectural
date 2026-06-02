import { describe, expect, it } from "vitest";

import { createProvider, registeredProviders } from "@llmorch/core";

import { PROVIDER_ID } from "../src/index.js";

describe("standalone-adapter-copilot", () => {
  it("self-registers the copilot provider at import", () => {
    expect(registeredProviders()).toContain("copilot");
    expect(PROVIDER_ID).toBe("copilot");
  });

  it("constructs a provider implementing the full LLMProvider port", () => {
    const provider = createProvider("copilot", { apiKey: "test-key" });
    expect(provider.providerId).toBe("copilot");
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
