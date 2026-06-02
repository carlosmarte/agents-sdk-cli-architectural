import { defineConfig } from "vitest/config";

// Dedicated config for the polyglot parity harness (`pnpm run parity`). The
// default workspace config excludes `parity/**` so the harness stays a separate
// cross-language gate; this config opts it back in when invoked explicitly.
export default defineConfig({
  test: {
    include: ["parity/**/*.test.ts"],
    environment: "node",
  },
});
