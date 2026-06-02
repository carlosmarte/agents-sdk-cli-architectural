import { describe, expect, it } from "vitest";

import * as sdk from "../src/index.js";
import { createOrchestrator, registeredProviders } from "../src/index.js";

describe("@llmorch/sdk batteries-included wiring", () => {
  it("importing the SDK self-registers exactly the four real providers", () => {
    expect(registeredProviders().sort()).toEqual([
      "anthropic",
      "copilot",
      "gemini",
      "openai",
    ]);
  });

  it("re-exports the orchestrator constructor", () => {
    expect(typeof createOrchestrator).toBe("function");
    expect(typeof sdk.createOrchestrator).toBe("function");
  });

  it("builds an orchestrator for any of the four providers from the single import", () => {
    for (const provider of ["openai", "anthropic", "gemini", "copilot"] as const) {
      const orch = createOrchestrator({ provider, apiKey: "k" });
      expect(typeof orch.chat).toBe("function");
    }
  });
});
