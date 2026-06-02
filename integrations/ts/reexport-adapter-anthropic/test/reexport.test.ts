import { describe, expect, it } from "vitest";

import { registeredProviders } from "@llmorch/core";

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  PROVIDER_ID,
  createAnthropicOrchestrator,
  createAnthropicProvider,
} from "../src/index.js";

describe("reexport-adapter-anthropic", () => {
  it("importing the package self-registers the anthropic provider", () => {
    expect(registeredProviders()).toContain(PROVIDER_ID);
  });

  it("exposes provider-specific convenience constants", () => {
    expect(PROVIDER_ID).toBe("anthropic");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
    expect(API_KEY_ENV.length).toBeGreaterThan(0);
  });

  it("builds a provider and a single-provider orchestrator", () => {
    const provider = createAnthropicProvider({ apiKey: "test-key" });
    expect(provider.providerId).toBe(PROVIDER_ID);

    const orch = createAnthropicOrchestrator({ apiKey: "test-key" });
    expect(typeof orch.chat).toBe("function");
    expect(typeof orch.stream).toBe("function");
  });
});
