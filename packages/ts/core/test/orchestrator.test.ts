import { describe, expect, it, vi } from "vitest";

import { ProviderError, RateLimitError } from "../src/errors.js";
import { registerProvider } from "../src/factory.js";
import type { ChatRequest, UnifiedResponse } from "../src/models/index.js";
import { createOrchestrator } from "../src/orchestrator.js";
import { FakeProvider } from "./fixtures/fake-provider.js";

const req: ChatRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };

class RateLimited extends FakeProvider {
  async chat(): Promise<UnifiedResponse> {
    throw new RateLimitError("rate limited", { providerId: this.providerId });
  }
}

class Fatal extends FakeProvider {
  async chat(): Promise<UnifiedResponse> {
    throw new ProviderError("fatal", { providerId: this.providerId });
  }
}

const chain = [
  { provider: "openai", apiKey: "k" },
  { provider: "anthropic", apiKey: "k" },
] as const;

describe("createOrchestrator", () => {
  it("delegates chat to the resolved provider", async () => {
    registerProvider("openai", FakeProvider);
    const orch = createOrchestrator({ provider: "openai", apiKey: "k" });
    const res = await orch.chat(req);
    expect(res.text).toBe("chat:openai");
  });

  it("exposes resumeTool on the facade, delegating to the resolved provider", async () => {
    registerProvider("openai", FakeProvider);
    const orch = createOrchestrator({ provider: "openai", apiKey: "k" });
    const res = await orch.resumeTool(req, [
      { id: "call_1", name: "get_weather", content: "20C" },
    ]);
    expect(res.text).toBe("resume:openai");
    expect(res.finishReason).toBe("stop");
  });

  it("fails over to the next provider on a retriable error", async () => {
    registerProvider("openai", RateLimited);
    registerProvider("anthropic", FakeProvider);
    const orch = createOrchestrator([...chain]);
    const res = await orch.chat(req);
    expect(res.text).toBe("chat:anthropic");
  });

  it("propagates a non-retriable error without trying the next provider", async () => {
    let secondCalled = false;
    class Tracking extends FakeProvider {
      async chat(): Promise<UnifiedResponse> {
        secondCalled = true;
        return super.chat(req);
      }
    }
    registerProvider("openai", Fatal);
    registerProvider("anthropic", Tracking);
    const orch = createOrchestrator([...chain]);
    await expect(orch.chat(req)).rejects.toBeInstanceOf(ProviderError);
    expect(secondCalled).toBe(false);
  });

  it("drives the telemetry hook with start/error/end around the fallback chain", async () => {
    const telemetry = {
      onRequestStart: vi.fn(),
      onRequestEnd: vi.fn(),
      onError: vi.fn(),
    };
    registerProvider("openai", RateLimited);
    registerProvider("anthropic", FakeProvider);
    const orch = createOrchestrator([...chain], { telemetry });
    await orch.chat(req);
    // Resilience exhausts retries on openai (each surfacing onError), then the
    // orchestrator fails over and onRequestEnd fires for the anthropic success.
    expect(telemetry.onRequestStart).toHaveBeenCalledWith(
      expect.objectContaining({ method: "chat", providerId: "openai" }),
    );
    expect(telemetry.onError).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "openai" }),
      expect.anything(),
    );
    expect(telemetry.onRequestEnd).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "anthropic" }),
      expect.objectContaining({ promptTokens: expect.any(Number) }),
    );
  });
});
