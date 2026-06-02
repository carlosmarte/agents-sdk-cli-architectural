/**
 * Scaffold the integrations/ts matrix: 3 patterns × 4 providers = 12 packages.
 *
 * Patterns:
 *   usecase-kit-adapter-<p>  (Pattern 1) — typed use-case kit over @llmorch/sdk
 *   standalone-adapter-<p>   (Pattern 2) — self-contained LLMProvider re-impl
 *   reexport-adapter-<p>     (Pattern 3) — thin re-export + convenience layer
 *
 * Source/test/readme bodies live as __TOKEN__ templates under ./templates;
 * package.json + tsconfig.json are emitted inline. Standalone sources are copied
 * verbatim from the canonical packages/ts/adapter-<p> so the two stay identical.
 *
 * Idempotent: re-running overwrites generated files. Run from anywhere:
 *   node integrations/ts/scripts/scaffold.mjs
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const INT = join(ROOT, "integrations", "ts");
const CANON = join(ROOT, "packages", "ts");
const TPL = join(SCRIPT_DIR, "templates");

/** Per-provider facts driving the whole matrix. */
const PROVIDERS = {
  openai: {
    pascal: "OpenAI",
    title: "OpenAI",
    env: "OPENAI_API_KEY",
    model: "gpt-4o-mini",
    vendorPkg: "openai",
    vendorVer: "^4.77.0",
    baseUrl: null,
  },
  anthropic: {
    pascal: "Anthropic",
    title: "Anthropic Claude",
    env: "ANTHROPIC_API_KEY",
    model: "claude-3-5-sonnet-latest",
    vendorPkg: "@anthropic-ai/sdk",
    vendorVer: "^0.39.0",
    baseUrl: null,
  },
  gemini: {
    pascal: "Gemini",
    title: "Google Gemini",
    env: "GEMINI_API_KEY",
    model: "gemini-2.0-flash",
    vendorPkg: "@google/genai",
    vendorVer: "^0.3.0",
    baseUrl: null,
  },
  copilot: {
    pascal: "Copilot",
    title: "GitHub Copilot",
    env: "GITHUB_TOKEN",
    model: "gpt-4.1",
    vendorPkg: "@github/copilot-sdk",
    vendorVer: "^0.1.0",
    baseUrl: null,
  },
  // Bring-your-own-endpoint adapter: speaks the OpenAI wire protocol against a
  // user-supplied baseUrl, so a self-hosted server (Ollama / LM Studio / vLLM /
  // llama.cpp / LocalAI) OR a private Azure OpenAI deployment flows through the
  // same pipeline. The runnable examples (src/examples/run-*-mock.ts) point this
  // at an in-process mock server so they execute offline, with no credentials.
  local: {
    pascal: "Local",
    title: "a local / self-hosted or private LLM endpoint",
    env: "LLMORCH_LOCAL_API_KEY",
    model: "llama3.2",
    vendorPkg: "openai",
    vendorVer: "^4.77.0",
    baseUrl: "http://localhost:11434/v1",
    baseUrlNote:
      "Default endpoint when none is supplied (Ollama's OpenAI-compatible path); " +
      "override via `baseUrl` / `LLMORCH_BASE_URL` for LM Studio, vLLM, or a private Azure deployment.",
  },
};

const tpl = (name) => readFileSync(join(TPL, name), "utf8");
const render = (s, tokens) =>
  Object.entries(tokens).reduce(
    (acc, [k, v]) => acc.replaceAll(`__${k}__`, v),
    s,
  );

function writeFile(pkgDir, rel, content) {
  const full = join(pkgDir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const TSCONFIG = JSON.stringify(
  {
    extends: "../tsconfig.base.json",
    compilerOptions: { outDir: "dist", rootDir: "src" },
    include: ["src"],
  },
  null,
  2,
);

function pkgJson(name, deps) {
  return (
    JSON.stringify(
      {
        name,
        version: "0.0.0",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        scripts: {
          build: "tsc -b",
          lint: "eslint src",
          test: "vitest run --passWithNoTests",
        },
        files: ["dist"],
        dependencies: deps,
        // Node globals (process/console) are used in source + examples; @types/node
        // is not auto-resolvable from integrations/ts the way it is inside packages/ts.
        devDependencies: { "@types/node": "^22.10.0" },
      },
      null,
      2,
    ) + "\n"
  );
}

/** Common token bag for a provider; baseUrl tokens are filled per pattern. */
function baseTokens(id, p) {
  return {
    ID: id,
    PASCAL: p.pascal,
    TITLE: p.title,
    MODEL: p.model,
    ENV: p.env,
    VENDOR_PKG: p.vendorPkg,
    VENDOR_VER: p.vendorVer,
  };
}

function baseUrlDecl(p) {
  if (!p.baseUrl) return "";
  const note = p.baseUrlNote ?? "Base URL this pathway targets (OpenAI-compatible).";
  return `/** ${note} */\nexport const BASE_URL = "${p.baseUrl}";\n`;
}

/** Appended to the `local` kit README — documents the offline mock examples. */
const LOCAL_MOCK_README_SECTION = `
## Offline mock examples (self-hosted + private Azure)

Two runnable demos exercise the **real** \`local\` adapter (openai client → HTTP)
against an in-process, dependency-free OpenAI-compatible mock server
(\`src/mock/openai-mock-server.ts\`) — no credentials, no network, no running model:

\`\`\`sh
pnpm --filter @llmorch-int/usecase-kit-adapter-local build
node dist/examples/run-local-mock.js   # self-hosted (Ollama / LM Studio / vLLM …)
node dist/examples/run-azure-mock.js    # private Azure OpenAI deployment
\`\`\`

- \`run-local-mock.ts\` points \`baseUrl\` at the mock; swap it for a real
  \`http://localhost:11434/v1\` and the code is unchanged.
- \`run-azure-mock.ts\` shows the Azure deltas the adapter handles via config
  (deployment URL, \`api-key\` header via \`extraHeaders\`, \`api-version\`) plus the
  401 → \`AuthenticationError\` mapping.

These files are hand-authored (not scaffold-generated). \`test/mock-server.test.ts\`
pins the mock + happy path in CI.
`;

const generated = [];

for (const [id, p] of Object.entries(PROVIDERS)) {
  const tokens = baseTokens(id, p);

  // ---- Pattern 1: usecase-kit ------------------------------------------------
  {
    const dir = join(INT, `usecase-kit-adapter-${id}`);
    const t = {
      ...tokens,
      BASEURL_DECL: baseUrlDecl(p),
      BASEURL_DEFAULT: p.baseUrl ? "options.baseUrl ?? BASE_URL" : "options.baseUrl",
    };
    writeFile(
      dir,
      "package.json",
      pkgJson(`@llmorch-int/usecase-kit-adapter-${id}`, {
        "@llmorch/core": "workspace:*",
        "@llmorch/sdk": "workspace:*",
        zod: "^3.24.0",
      }),
    );
    writeFile(dir, "tsconfig.json", TSCONFIG + "\n");
    writeFile(dir, "src/index.ts", render(tpl("kit-index.ts.tmpl"), t));
    writeFile(dir, "src/examples/run.ts", render(tpl("kit-example.ts.tmpl"), t));
    writeFile(dir, "test/kit.test.ts", render(tpl("kit-test.ts.tmpl"), t));
    let readme = render(tpl("kit-readme.md.tmpl"), t);
    // The `local` kit additionally carries hand-authored, fully-offline mock
    // examples (an in-process OpenAI-compatible server) for self-hosted and
    // private-Azure endpoints. Document them; the example/mock files themselves
    // live outside the scaffold's write set so re-running never clobbers them.
    if (id === "local") readme += LOCAL_MOCK_README_SECTION;
    writeFile(dir, "README.md", readme);
    generated.push(`usecase-kit-adapter-${id}`);
  }

  // ---- Pattern 2: standalone (verbatim copy of the canonical adapter) --------
  {
    const dir = join(INT, `standalone-adapter-${id}`);
    const srcCanon = join(CANON, `adapter-${id}`, "src");
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const file of readdirSync(srcCanon)) {
      cpSync(join(srcCanon, file), join(dir, "src", file));
    }
    // Append a stable PROVIDER_ID export so the smoke test is uniform.
    const indexPath = join(dir, "src", "index.ts");
    const banner =
      `/* Standalone copy of @llmorch/adapter-${id} (Pattern 2). Kept identical to\n` +
      `   the canonical adapter; fork/vendor this package independently. */\n`;
    const body = readFileSync(indexPath, "utf8");
    writeFileSync(
      indexPath,
      `${banner}${body}\n/** Provider id this standalone adapter registers. */\nexport const PROVIDER_ID = "${id}" as const;\n`,
    );
    writeFile(
      dir,
      "package.json",
      pkgJson(`@llmorch-int/standalone-adapter-${id}`, {
        "@llmorch/core": "workspace:*",
        [p.vendorPkg]: p.vendorVer,
        zod: "^3.24.0",
      }),
    );
    writeFile(dir, "tsconfig.json", TSCONFIG + "\n");
    writeFile(dir, "test/standalone.test.ts", render(tpl("standalone-test.ts.tmpl"), tokens));
    writeFile(dir, "README.md", render(tpl("standalone-readme.md.tmpl"), tokens));
    generated.push(`standalone-adapter-${id}`);
  }

  // ---- Pattern 3: reexport ---------------------------------------------------
  {
    const dir = join(INT, `reexport-adapter-${id}`);
    const t = {
      ...tokens,
      BASEURL_DECL: baseUrlDecl(p),
      BASEURL_DEFAULT: p.baseUrl ? "opts.baseUrl ?? BASE_URL" : "opts.baseUrl",
    };
    writeFile(
      dir,
      "package.json",
      pkgJson(`@llmorch-int/reexport-adapter-${id}`, {
        "@llmorch/core": "workspace:*",
        [`@llmorch/adapter-${id}`]: "workspace:*",
      }),
    );
    writeFile(dir, "tsconfig.json", TSCONFIG + "\n");
    writeFile(dir, "src/index.ts", render(tpl("reexport-index.ts.tmpl"), t));
    writeFile(dir, "test/reexport.test.ts", render(tpl("reexport-test.ts.tmpl"), t));
    writeFile(dir, "README.md", render(tpl("reexport-readme.md.tmpl"), t));
    generated.push(`reexport-adapter-${id}`);
  }
}

console.log(`Scaffolded ${generated.length} packages:`);
for (const g of generated.sort()) console.log(`  integrations/ts/${g}`);
