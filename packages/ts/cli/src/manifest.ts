/**
 * Static command + provider metadata. `--help` is served entirely from this
 * module so no command handler (and therefore no `@llmorch/sdk`) is imported to
 * print usage. The `PROVIDER_INFO` table also feeds the `providers` command and
 * the per-provider default model used when no `--model` is given — kept in lockstep
 * with the Python `providers_info.py` twin.
 */

/** One row per command, in display order. */
export const COMMANDS: ReadonlyArray<{ name: string; describe: string }> = [
  { name: "chat", describe: "One-shot prompt → text answer" },
  { name: "stream", describe: "Prompt → streamed text on stdout" },
  { name: "structured", describe: "Prompt + --schema JSON → validated JSON" },
  { name: "providers", describe: "List registered providers + resolved config" },
];

/** The global flags shared by every command. */
export const GLOBAL_FLAGS: ReadonlyArray<{ flag: string; describe: string }> = [
  { flag: "--provider <id>", describe: "Provider id (env: LLMORCH_PROVIDER)" },
  { flag: "--model <name>", describe: "Model name (defaults per provider)" },
  { flag: "--temperature <n>", describe: "Sampling temperature" },
  { flag: "--max-tokens <n>", describe: "Max output tokens" },
];

/** Resolved-config metadata for each of the four real providers, sorted by id. */
export interface ProviderInfo {
  id: string;
  defaultModel: string;
  keyEnv: string;
}

export const PROVIDER_INFO: ReadonlyArray<ProviderInfo> = [
  { id: "anthropic", defaultModel: "claude-3-5-sonnet-latest", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "copilot", defaultModel: "gpt-4.1", keyEnv: "GITHUB_TOKEN" },
  { id: "gemini", defaultModel: "gemini-1.5-flash", keyEnv: "GEMINI_API_KEY" },
  { id: "openai", defaultModel: "gpt-4o", keyEnv: "OPENAI_API_KEY" },
];

const BY_ID = new Map(PROVIDER_INFO.map((p) => [p.id, p]));

/** The default model for a provider id, or undefined for unknown ids (e.g. `fake`). */
export function defaultModelFor(provider: string | undefined): string | undefined {
  return provider ? BY_ID.get(provider)?.defaultModel : undefined;
}

/** Render the top-level `--help` text from static metadata (no handler import). */
export function renderHelp(): string {
  const lines = ["llmorch — multi-provider LLM orchestration CLI", "", "Usage: llmorch <command> [args] [flags]", "", "Commands:"];
  for (const c of COMMANDS) lines.push(`  ${c.name.padEnd(12)}${c.describe}`);
  lines.push("", "Global flags:");
  for (const f of GLOBAL_FLAGS) lines.push(`  ${f.flag.padEnd(20)}${f.describe}`);
  return lines.join("\n");
}

/** Render the bare command list (used on an unknown-command error). */
export function renderCommandList(): string {
  return ["Commands:", ...COMMANDS.map((c) => `  ${c.name}`)].join("\n");
}
