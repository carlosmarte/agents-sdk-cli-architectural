/**
 * The Hexagonal seam for the CLI. `CommandContext` is what every command handler
 * receives; `buildOrchestrator` is the single place the CLI constructs an
 * `Orchestrator` from resolved config. Nothing here imports a provider SDK or a
 * concrete adapter package directly — the heavy `@llmorch/sdk` is pulled in
 * via a dynamic `import()` inside {@link buildOrchestrator} so it never loads for
 * `--help` or for a command (like `providers`) that makes no model call.
 */
import type { Orchestrator } from "@llmorch/core";

import type { ResolvedFlags } from "./flags.js";
import { defaultModelFor } from "./manifest.js";

/** Test/embedding seam injected into {@link run}. */
export interface RunDeps {
  /** Inject a prebuilt orchestrator (e.g. a `FakeProvider`) — skips the SDK build. */
  orchestrator?: Orchestrator;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
}

/** Everything a command handler is handed. Handlers parse/validate/render only. */
export interface CommandContext {
  /**
   * Resolve the shared orchestrator, built once and memoized. Commands that make
   * no model call (e.g. `providers`) never invoke this, so the SDK stays unloaded.
   */
  getOrchestrator: () => Promise<Orchestrator>;
  flags: Record<string, string | number | boolean | undefined>;
  args: string[];
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
}

/**
 * Construct an `Orchestrator` from resolved flags. The heavy `@llmorch/sdk`
 * (which transitively loads every provider SDK) is imported lazily here, so it
 * is only paid for when a command actually needs to talk to a model. The special
 * `fake` provider builds the in-`core` `FakeProvider` for offline, key-free
 * end-to-end verification — it is never registered globally, so `providers`
 * still lists exactly the four real providers.
 */
export async function buildOrchestrator(
  flags: ResolvedFlags,
  env: NodeJS.ProcessEnv,
): Promise<Orchestrator> {
  if (flags.provider === "fake") {
    const { FakeProvider } = await import("@llmorch/core");
    // Offline affordances so the binary can demo each modality with no live key:
    // LLMORCH_FAKE_TEXT seeds chat/stream output, LLMORCH_FAKE_STRUCTURED the
    // `structured` payload (must validate against the supplied schema).
    const text = env.LLMORCH_FAKE_TEXT;
    const structured = env.LLMORCH_FAKE_STRUCTURED
      ? JSON.parse(env.LLMORCH_FAKE_STRUCTURED)
      : undefined;
    return new FakeProvider({
      ...(text !== undefined ? { text } : {}),
      ...(structured !== undefined ? { structured } : {}),
    });
  }
  const { createOrchestrator } = await import("@llmorch/sdk");
  const config: Record<string, unknown> = { provider: flags.provider };
  const model = flags.model ?? defaultModelFor(flags.provider);
  if (model !== undefined) config.defaultModel = model;
  return createOrchestrator(config as never);
}
