/**
 * `llmorch providers` — list the four real providers with their resolved config
 * (default model + whether the provider's API key is present in env). Makes no
 * model call and imports no provider SDK: the data comes from the static
 * `PROVIDER_INFO` table, so this command stays lazy-loading-clean.
 */
import type { CommandModule } from "../loader.js";
import { PROVIDER_INFO } from "../manifest.js";

const providers: CommandModule = {
  describe: "List registered providers + resolved config",
  flags: {},
  async handler(ctx) {
    for (const info of PROVIDER_INFO) {
      const present = Boolean(ctx.env[info.keyEnv]);
      ctx.stdout(
        `${info.id}  default_model=${info.defaultModel}  key_present=${present ? "true" : "false"}\n`,
      );
    }
    return 0;
  },
};

export default providers;
