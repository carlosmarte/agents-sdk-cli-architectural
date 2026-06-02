/** `llmorch chat "<prompt>"` — one-shot prompt → text answer via the orchestrator. */
import type { CommandModule } from "../loader.js";
import { resolveFlags } from "../flags.js";
import { buildChatRequest } from "../request.js";

const chat: CommandModule = {
  describe: "One-shot prompt → text answer",
  flags: {},
  async handler(ctx) {
    const flags = resolveFlags(ctx.flags, ctx.env);
    const orchestrator = await ctx.getOrchestrator();
    const res = await orchestrator.chat(buildChatRequest(flags, ctx.args[0] ?? ""));
    ctx.stdout(`${res.text}\n`);
    return 0;
  },
};

export default chat;
