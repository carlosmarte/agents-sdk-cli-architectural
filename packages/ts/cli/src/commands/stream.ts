/** `llmorch stream "<prompt>"` — write each streamed text delta to stdout as it arrives. */
import type { CommandModule } from "../loader.js";
import { resolveFlags } from "../flags.js";
import { buildChatRequest } from "../request.js";

const stream: CommandModule = {
  describe: "Prompt → streamed text on stdout",
  flags: {},
  async handler(ctx) {
    const flags = resolveFlags(ctx.flags, ctx.env);
    const orchestrator = await ctx.getOrchestrator();
    const req = buildChatRequest(flags, ctx.args[0] ?? "");
    for await (const chunk of orchestrator.stream(req)) {
      ctx.stdout(chunk.delta);
    }
    return 0;
  },
};

export default stream;
