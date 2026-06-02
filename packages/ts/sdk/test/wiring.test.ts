import { describe, expect, it } from "vitest";

import * as sdk from "../src/index.js";
import { createOrchestrator, registeredProviders } from "../src/index.js";

describe("@llmorch/sdk batteries-included wiring", () => {
  it("importing the SDK self-registers exactly the real providers", () => {
    expect(registeredProviders().sort()).toEqual([
      "anthropic",
      "copilot",
      "gemini",
      "local",
      "openai",
    ]);
  });

  it("re-exports the orchestrator constructor", () => {
    expect(typeof createOrchestrator).toBe("function");
    expect(typeof sdk.createOrchestrator).toBe("function");
  });

  it("builds an orchestrator for any registered provider from the single import", () => {
    for (const provider of ["openai", "anthropic", "gemini", "copilot", "local"] as const) {
      const orch = createOrchestrator({ provider, apiKey: "k" });
      expect(typeof orch.chat).toBe("function");
    }
  });
});
