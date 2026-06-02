import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lazy-loading proof. `@llmorch/sdk` is the heavy module that transitively pulls
 * in every provider SDK; mocking it lets us detect *whether* it is loaded. The
 * mock factory flips `state.sdkLoaded` the moment the module is imported, so:
 *   - `providers` / `--help` must NOT trip it (no model access → no SDK), and
 *   - `chat` (no injected orchestrator) MUST trip it (the build needs the SDK).
 * `vi.resetModules()` per test gives each case a fresh module graph so the
 * dynamic `import("@llmorch/sdk")` re-runs the factory deterministically.
 */
const state = vi.hoisted(() => ({ sdkLoaded: false }));

vi.mock("@llmorch/sdk", () => {
  state.sdkLoaded = true;
  const fakeOrch = {
    chat: async () => ({
      text: "x",
      usage: { promptTokens: 0, completionTokens: 0 },
      toolCalls: [],
      finishReason: "stop" as const,
    }),
    // eslint-disable-next-line require-yield
    stream: async function* () {},
    generateStructured: async () => ({}),
    invokeTool: async () => ({
      text: "",
      usage: { promptTokens: 0, completionTokens: 0 },
      toolCalls: [],
      finishReason: "tool_use" as const,
    }),
  };
  return {
    createOrchestrator: () => fakeOrch,
    registeredProviders: () => ["anthropic", "copilot", "gemini", "openai"],
  };
});

describe("@llmorch/cli lazy loading", () => {
  beforeEach(() => {
    vi.resetModules();
    state.sdkLoaded = false;
  });

  it("`providers` loads no provider SDK", async () => {
    const { run } = await import("../src/run.js");
    await run(["providers"], { stdout: () => {}, env: {} });
    expect(state.sdkLoaded).toBe(false);
  });

  it("`--help` loads no provider SDK", async () => {
    const { run } = await import("../src/run.js");
    await run(["--help"], { stdout: () => {}, env: {} });
    expect(state.sdkLoaded).toBe(false);
  });

  it("`chat` triggers the @llmorch/sdk load when no orchestrator is injected", async () => {
    const { run } = await import("../src/run.js");
    await run(["chat", "hi"], {
      stdout: () => {},
      env: { LLMORCH_PROVIDER: "openai" },
    });
    expect(state.sdkLoaded).toBe(true);
  });

  it("`chat` with an injected orchestrator still loads no SDK", async () => {
    const { FakeProvider } = await import("@llmorch/core");
    const { run } = await import("../src/run.js");
    await run(["chat", "hi"], {
      orchestrator: new FakeProvider(),
      stdout: () => {},
      env: {},
    });
    expect(state.sdkLoaded).toBe(false);
  });
});
