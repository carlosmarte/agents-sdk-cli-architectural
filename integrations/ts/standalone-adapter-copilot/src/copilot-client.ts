import { createRequire } from "node:module";

import type { ProviderConfig } from "@llmorch/core";

/**
 * CLI args passed to every Copilot client. `--disable-builtin-mcps` keeps the
 * session on the bare SDK surface (no built-in MCP tool servers), matching the
 * reference integration in carlosmarte/examples-github-copilot-cli-sdk.
 */
export const COPILOT_CLI_ARGS: readonly string[] = ["--disable-builtin-mcps"];

/**
 * Resolve the `@github/copilot` CLI binary the SDK shells out to. Tries package
 * resolution relative to this module first, then the `COPILOT_CLI_PATH` env var
 * — mirroring the reference `resolveCopilotCli()` so every llmorch Copilot
 * integration locates the CLI the same way.
 */
export function resolveCopilotCli(): string {
  try {
    return createRequire(import.meta.url).resolve("@github/copilot");
  } catch {
    if (process.env.COPILOT_CLI_PATH) return process.env.COPILOT_CLI_PATH;
    throw new Error(
      "Copilot CLI not found. Run `npm install @github/copilot` or set COPILOT_CLI_PATH.",
    );
  }
}

/** A streamed assistant event payload (`assistant.message_delta`). */
export interface CopilotEvent {
  data?: { content?: string | null };
}

/** The session-scoped reply returned by `session.sendAndWait`. */
export interface CopilotReply {
  data?: { content?: string | null };
}

/** Options accepted by `client.createSession`. */
export interface CopilotSessionOptions {
  model?: string;
  streaming?: boolean;
  onPermissionRequest?: unknown;
}

/** Structural view of the `@github/copilot-sdk` Session surface we depend on. */
export interface CopilotSessionLike {
  sendAndWait(input: { prompt: string }): Promise<CopilotReply | undefined>;
  on(event: string, handler: (event: CopilotEvent) => void): () => void;
}

/** Structural view of the `@github/copilot-sdk` CopilotClient surface we depend on. */
export interface CopilotClientLike {
  createSession(opts: CopilotSessionOptions): Promise<CopilotSessionLike>;
  stop(): Promise<void>;
}

/** A constructed client plus the SDK's `approveAll` permission handler. */
export interface CopilotRuntime {
  client: CopilotClientLike;
  approveAll: unknown;
}

/**
 * Build a `@github/copilot-sdk` {@link CopilotClientLike} pinned to the resolved
 * CLI path and {@link COPILOT_CLI_ARGS}, matching the reference integration:
 *
 * ```ts
 * new CopilotClient({ cliPath: resolveCopilotCli(), cliArgs: ["--disable-builtin-mcps"] })
 * ```
 *
 * The SDK is loaded via a runtime `import()` of a non-literal specifier so this
 * package builds and self-registers without `@github/copilot-sdk` installed; it
 * is only required when a Copilot call is actually made. Auth is handled by the
 * CLI itself (`gh auth` / `COPILOT_GITHUB_TOKEN`), so `config` is unused.
 */
export async function makeCopilotClient(_config: ProviderConfig): Promise<CopilotRuntime> {
  // Non-literal specifier: tsc types this as `any` and does not resolve the
  // module at build time, keeping the SDK an optional runtime dependency.
  const specifier: string = "@github/copilot-sdk";
  const mod = (await import(specifier)) as {
    CopilotClient: new (opts: { cliPath: string; cliArgs: string[] }) => CopilotClientLike;
    approveAll: unknown;
  };
  const client = new mod.CopilotClient({
    cliPath: resolveCopilotCli(),
    cliArgs: [...COPILOT_CLI_ARGS],
  });
  return { client, approveAll: mod.approveAll };
}
