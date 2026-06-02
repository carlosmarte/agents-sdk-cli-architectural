/**
 * oclif-style directory routing: the filesystem path under `src/commands/` is the
 * command path (`commands/chat.ts` ↔ `llmorch chat`). {@link resolveCommand}
 * dynamically `import()`s the command module only when that command is invoked,
 * so a command's heavy dependencies (anything it reaches through `ctx.getOrchestrator`)
 * never load for `--help` or for a different command.
 */
import type { CommandContext } from "./context.js";
import { COMMANDS } from "./manifest.js";

/** The default export every `commands/<name>.ts` module provides. */
export interface CommandModule {
  describe: string;
  flags: Record<string, { type: "string" | "number" | "boolean"; describe: string }>;
  handler: (ctx: CommandContext) => Promise<number>;
}

/** Thrown when an unknown command name is requested. */
export class UnknownCommandError extends Error {
  constructor(public readonly name: string) {
    super(`Unknown command: ${name}`);
    this.name = "UnknownCommandError";
  }
}

/**
 * One lazy `import()` per command, keyed by command name. Each entry mirrors the
 * `src/commands/<name>.ts` file and only executes when that command is invoked —
 * so the module (and anything it reaches via `ctx.getOrchestrator`) stays
 * unloaded otherwise. Literal specifiers (rather than a computed
 * `./commands/${name}.js`) keep the lazy import statically analyzable by bundlers
 * and the vitest/Vite transform.
 */
const LOADERS: Record<string, () => Promise<{ default: CommandModule }>> = {
  chat: () => import("./commands/chat.js"),
  stream: () => import("./commands/stream.js"),
  structured: () => import("./commands/structured.js"),
  providers: () => import("./commands/providers.js"),
};

// Fail fast if the manifest and the loader map ever drift apart.
for (const { name } of COMMANDS) {
  if (!(name in LOADERS)) throw new Error(`Command "${name}" has no loader entry`);
}

/** Resolve `name` → its command module, importing it lazily. */
export async function resolveCommand(name: string): Promise<CommandModule> {
  const load = LOADERS[name];
  if (!load) throw new UnknownCommandError(name);
  return (await load()).default;
}
