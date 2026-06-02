/** @llmorch/cli — programmatic surface: the `run` entry + its context types. */
export const CLI_PACKAGE = "@llmorch/cli" as const;

export { run } from "./run.js";
export type { CommandContext, RunDeps } from "./context.js";
export type { CommandModule } from "./loader.js";
