import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { resolveConfig } from "../src/config.js";

const env = (e: Record<string, string>): NodeJS.ProcessEnv =>
  e as NodeJS.ProcessEnv;

describe("resolveConfig precedence", () => {
  it("(a) explicit apiKey beats OPENAI_API_KEY", () => {
    const cfg = resolveConfig(
      { provider: "openai", apiKey: "explicit" },
      env({ OPENAI_API_KEY: "fromenv" }),
    );
    expect(cfg.apiKey).toBe("explicit");
  });

  it("(b) provider-specific key resolves when only it is set", () => {
    const cfg = resolveConfig({ provider: "openai" }, env({ OPENAI_API_KEY: "oai" }));
    expect(cfg.apiKey).toBe("oai");
  });

  it("(c) LLMORCH_PROVIDER selects the provider", () => {
    const cfg = resolveConfig(
      {},
      env({ LLMORCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "ak" }),
    );
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBe("ak");
  });

  it("(d) GITHUB_TOKEN resolves for copilot", () => {
    const cfg = resolveConfig({ provider: "copilot" }, env({ GITHUB_TOKEN: "ght" }));
    expect(cfg.apiKey).toBe("ght");
  });

  it("(e) LLMORCH_API_KEY is the generic fallback", () => {
    const cfg = resolveConfig({ provider: "gemini" }, env({ LLMORCH_API_KEY: "gen" }));
    expect(cfg.apiKey).toBe("gen");
  });

  it("(f) no resolvable provider throws a ZodError", () => {
    expect(() => resolveConfig({}, env({}))).toThrow(ZodError);
  });

  it("applies defaults for timeoutMs and maxRetries", () => {
    const cfg = resolveConfig({ provider: "openai", apiKey: "k" }, env({}));
    expect(cfg.timeoutMs).toBe(30_000);
    expect(cfg.maxRetries).toBe(2);
  });
});
