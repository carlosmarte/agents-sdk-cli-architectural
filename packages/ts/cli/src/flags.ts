/**
 * Argv parsing + global-flag resolution. Precedence for resolved values is
 * explicit flag > env var > (left to the request/config layer) default — the
 * same precedence the Python twin applies.
 */

/** The shape of `argv` after a single pass. */
export interface ParsedArgv {
  command?: string;
  args: string[];
  flags: Record<string, string | number | boolean | undefined>;
  help: boolean;
}

const NUMERIC_FLAGS = new Set(["temperature", "max-tokens"]);

/**
 * One-pass argv parser: first bare token is the command, the rest are positional
 * args; `--key value` / `--key=value` become flags; `--help`/`-h` set `help`.
 * Numeric flags (`--temperature`, `--max-tokens`) are coerced to numbers.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const parsed: ParsedArgv = { args: [], flags: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      let key: string;
      let value: string | boolean;
      if (eq >= 0) {
        key = body.slice(0, eq);
        value = body.slice(eq + 1);
      } else {
        key = body;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          i++;
        } else {
          value = true;
        }
      }
      parsed.flags[key] =
        typeof value === "string" && NUMERIC_FLAGS.has(key) ? Number(value) : value;
      continue;
    }
    if (parsed.command === undefined) parsed.command = token;
    else parsed.args.push(token);
  }
  return parsed;
}

/** The four global flags after env fallback, in a strongly-typed shape. */
export interface ResolvedFlags {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Resolve the global flags with precedence explicit flag > env. `--provider`
 * falls back to `LLMORCH_PROVIDER`; the rest have no env layer of their own.
 */
export function resolveFlags(
  flags: Record<string, string | number | boolean | undefined>,
  env: NodeJS.ProcessEnv,
): ResolvedFlags {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
  return {
    provider: (flags.provider as string | undefined) ?? env.LLMORCH_PROVIDER,
    model: flags.model as string | undefined,
    temperature: num(flags.temperature),
    maxTokens: num(flags["max-tokens"]),
  };
}
