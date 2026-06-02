import { describe, expect, it, vi } from "vitest";

import { currentTraceId, runWithTrace } from "../src/context.js";
import { AuthenticationError } from "../src/errors.js";
import { registerProvider } from "../src/factory.js";
import type { StreamChunk } from "../src/interface.js";
import type { ChatRequest, TokenUsage, UnifiedResponse } from "../src/models/index.js";
import { createOrchestrator } from "../src/orchestrator.js";
import { NoopTelemetryHook, StructuredLogTelemetryHook } from "../src/telemetry.js";
import { FakeProvider } from "./fixtures/fake-provider.js";

const req: ChatRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };
const cfg = { provider: "openai", apiKey: "k" } as const;

/** A spy hook that records call order plus what each callback observed. */
function spyHook() {
  const events: string[] = [];
  return {
    events,
    endUsage: undefined as TokenUsage | undefined,
    startTraceId: undefined as string | undefined,
    onRequestStart(ctx: { traceId: string }) {
      events.push("start");
      this.startTraceId = ctx.traceId;
    },
    onRequestEnd(_ctx: unknown, usage: TokenUsage) {
      events.push("end");
      this.endUsage = usage;
    },
    onError() {
      events.push("error");
    },
    onToken() {
      events.push("token");
    },
  };
}

describe("orchestrator telemetry + trace context", () => {
  it("fires onRequestStart then onRequestEnd (with usage) on success", async () => {
    registerProvider("openai", FakeProvider);
    const hook = spyHook();
    const orch = createOrchestrator(cfg, { telemetry: hook });
    await orch.chat(req);
    expect(hook.events).toEqual(["start", "end"]);
    expect(hook.endUsage).toMatchObject({ promptTokens: 1, completionTokens: 1 });
  });

  it("fires onRequestStart then onError (not onRequestEnd) on failure", async () => {
    class Failing extends FakeProvider {
      async chat(): Promise<UnifiedResponse> {
        throw new AuthenticationError("nope", { providerId: this.providerId });
      }
    }
    registerProvider("openai", Failing);
    const hook = spyHook();
    const orch = createOrchestrator(cfg, { telemetry: hook });
    await expect(orch.chat(req)).rejects.toBeInstanceOf(AuthenticationError);
    expect(hook.events).toEqual(["start", "error"]);
  });

  it("fires onToken per chunk between start and end for stream", async () => {
    class Streaming extends FakeProvider {
      async *stream(): AsyncGenerator<StreamChunk, void, unknown> {
        yield { delta: "a" };
        yield { delta: "b", usage: { promptTokens: 2, completionTokens: 3 }, finishReason: "stop" };
      }
    }
    registerProvider("openai", Streaming);
    const hook = spyHook();
    const orch = createOrchestrator(cfg, { telemetry: hook });
    for await (const _chunk of orch.stream(req)) {
      // drain
    }
    expect(hook.events).toEqual(["start", "token", "token", "end"]);
    expect(hook.endUsage).toEqual({ promptTokens: 2, completionTokens: 3 });
  });

  it("exposes the traceId to a nested provider call and to the hook (no threading)", async () => {
    class TraceReading extends FakeProvider {
      async chat(): Promise<UnifiedResponse> {
        // No traceId parameter — read it from the ambient context.
        return {
          text: currentTraceId() ?? "<none>",
          usage: { promptTokens: 1, completionTokens: 1 },
          toolCalls: [],
          finishReason: "stop",
        };
      }
    }
    registerProvider("openai", TraceReading);
    const hook = spyHook();
    const orch = createOrchestrator(cfg, { telemetry: hook });
    const res = await orch.chat(req);
    expect(res.text).toBe(hook.startTraceId);
    expect(res.text).not.toBe("<none>");
  });

  it("isolates traceIds across concurrent calls (no global state)", async () => {
    class TraceReading extends FakeProvider {
      async chat(): Promise<UnifiedResponse> {
        return {
          text: currentTraceId() ?? "<none>",
          usage: { promptTokens: 1, completionTokens: 1 },
          toolCalls: [],
          finishReason: "stop",
        };
      }
    }
    registerProvider("openai", TraceReading);
    const hookA = spyHook();
    const hookB = spyHook();
    const orchA = createOrchestrator(cfg, { telemetry: hookA });
    const orchB = createOrchestrator(cfg, { telemetry: hookB });
    const [a, b] = await Promise.all([
      runWithTrace("trace-A", () => orchA.chat(req)),
      runWithTrace("trace-B", () => orchB.chat(req)),
    ]);
    expect(a.text).toBe("trace-A");
    expect(b.text).toBe("trace-B");
    expect(hookA.startTraceId).toBe("trace-A");
    expect(hookB.startTraceId).toBe("trace-B");
  });

  it("uses the no-op default when no hook is supplied (no output, no throw)", async () => {
    registerProvider("openai", FakeProvider);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const orch = createOrchestrator(cfg);
    await expect(orch.chat(req)).resolves.toBeDefined();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("StructuredLogTelemetryHook emits a record per event and never throws", () => {
    const recs: object[] = [];
    const hook = new StructuredLogTelemetryHook((r) => recs.push(r));
    const ctx = { traceId: "t", providerId: "openai", method: "chat" };
    hook.onRequestStart(ctx);
    hook.onRequestEnd(ctx, { promptTokens: 1, completionTokens: 2 });
    hook.onError(ctx, new Error("boom"));
    hook.onToken(ctx, "x");
    expect(recs).toHaveLength(4);
    expect(recs[0]).toMatchObject({ event: "request.start", traceId: "t" });

    // A throwing sink is swallowed.
    const throwing = new StructuredLogTelemetryHook(() => {
      throw new Error("sink down");
    });
    expect(() => throwing.onRequestStart(ctx)).not.toThrow();
    expect(NoopTelemetryHook.onRequestStart).toBeUndefined();
  });
});
