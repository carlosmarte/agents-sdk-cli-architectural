/**
 * `llmorch structured "<prompt>" --schema ./schema.json` — read a JSON Schema
 * file, ask the orchestrator for schema-validated output, print it as JSON.
 */
import { readFile } from "node:fs/promises";

import type { CommandModule } from "../loader.js";
import { resolveFlags } from "../flags.js";
import { buildChatRequest } from "../request.js";
import { jsonSchemaToZod } from "../schema-bridge.js";

const structured: CommandModule = {
  describe: "Prompt + --schema JSON → validated JSON",
  flags: {
    schema: { type: "string", describe: "Path to a JSON Schema file" },
  },
  async handler(ctx) {
    const schemaPath = ctx.flags.schema;
    if (typeof schemaPath !== "string" || schemaPath.length === 0) {
      ctx.stderr("structured: --schema <file> is required\n");
      return 1;
    }
    let schemaJson: unknown;
    try {
      schemaJson = JSON.parse(await readFile(schemaPath, "utf8"));
    } catch {
      ctx.stderr(`structured: cannot read or parse schema file: ${schemaPath}\n`);
      return 1;
    }
    const flags = resolveFlags(ctx.flags, ctx.env);
    const orchestrator = await ctx.getOrchestrator();
    const req = buildChatRequest(flags, ctx.args[0] ?? "");
    let data: unknown;
    try {
      data = await orchestrator.generateStructured(req, jsonSchemaToZod(schemaJson as never));
    } catch (err) {
      ctx.stderr(`structured: output did not satisfy the schema: ${(err as Error).message}\n`);
      return 1;
    }
    ctx.stdout(`${JSON.stringify(data, null, 2)}\n`);
    return 0;
  },
};

export default structured;
