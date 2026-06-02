/**
 * The single entry path for `@llmorch/cli` as a thin driving adapter over the
 * shared `Orchestrator` core. `run` parses argv, serves `--help`/unknown-command
 * from static metadata (no handler import), then lazily loads and dispatches the
 * matched command — building the orchestrator once and handing it to the handler
 * via `ctx.getOrchestrator`. No provider SDK is imported anywhere in this module.
 */
import type { Orchestrator } from "@llmorch/core";

import type { CommandContext, RunDeps } from "./context.js";
import { buildOrchestrator } from "./context.js";
import { parseArgv, resolveFlags } from "./flags.js";
import { resolveCommand, UnknownCommandError } from "./loader.js";
import { renderCommandList, renderHelp } from "./manifest.js";

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((s) => void process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => void process.stderr.write(s));
  const env = deps.env ?? process.env;

  const parsed = parseArgv(argv);

  if (parsed.command === undefined || (parsed.help && parsed.command === undefined)) {
    stdout(`${renderHelp()}\n`);
    return 0;
  }

  let command;
  try {
    command = await resolveCommand(parsed.command);
  } catch (err) {
    if (err instanceof UnknownCommandError) {
      stderr(`Unknown command: ${parsed.command}\n\n${renderCommandList()}\n`);
      return 1;
    }
    throw err;
  }

  if (parsed.help) {
    stdout(`${command.describe}\n`);
    return 0;
  }

  // Build the orchestrator at most once, only when a handler actually asks for it.
  let built: Orchestrator | undefined;
  const getOrchestrator = async (): Promise<Orchestrator> => {
    if (deps.orchestrator) return deps.orchestrator;
    built ??= await buildOrchestrator(resolveFlags(parsed.flags, env), env);
    return built;
  };

  const ctx: CommandContext = {
    getOrchestrator,
    flags: parsed.flags,
    args: parsed.args,
    stdout,
    stderr,
    env,
  };
  return command.handler(ctx);
}
