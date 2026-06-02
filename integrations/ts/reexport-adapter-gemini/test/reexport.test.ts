import { describe, expect, it } from "vitest";

import { registeredProviders } from "@llmorch/core";

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  PROVIDER_ID,
  createGeminiOrchestrator,
  createGeminiProvider,
} from "../src/index.js";

describe("reexport-adapter-gemini", () => {
  it("importing the package self-registers the gemini provider", () => {
    expect(registeredProviders()).toContain(PROVIDER_ID);
  });

  it("exposes provider-specific convenience constants", () => {
    expect(PROVIDER_ID).toBe("gemini");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
    expect(API_KEY_ENV.length).toBeGreaterThan(0);
  });

  it("builds a provider and a single-provider orchestrator", () => {
    const provider = createGeminiProvider({ apiKey: "test-key" });
    expect(provider.providerId).toBe(PROVIDER_ID);

    const orch = createGeminiOrchestrator({ apiKey: "test-key" });
    expect(typeof orch.chat).toBe("function");
    expect(typeof orch.stream).toBe("function");
  });
});
