/**
 * Runnable demo: drive a *private Azure OpenAI* deployment through the use-case
 * kit — entirely offline, against an in-process mock shaped like Azure.
 *
 *   pnpm --filter @llmorch-int/usecase-kit-adapter-local build
 *   node dist/examples/run-azure-mock.js
 *
 * Azure OpenAI is OpenAI-wire-compatible but differs in three ways the `local`
 * (bring-your-own-endpoint) adapter handles via plain config:
 *   1. Deployment-scoped URL:  https://<resource>.openai.azure.com/openai/deployments/<deployment>
 *   2. Auth via an `api-key` header (not `Authorization: Bearer`) → `extraHeaders`.
 *   3. An `api-version` query param (omitted here; add it to baseUrl in prod).
 *
 * Because the kit's typed options don't surface `extraHeaders`, we build the
 * orchestrator directly (the documented `orchestrator` escape hatch) and inject
 * it — then use the exact same `ask`/`stream`/`extract`/`runTools` surface.
 */
import { AuthenticationError, type ProviderConfig } from "@llmorch/core";
import { createOrchestrator } from "@llmorch/sdk";
import { z } from "zod";

import { createLocalKit } from "../index.js";
import { startMockServer } from "../mock/openai-mock-server.js";

const AZURE_API_KEY = "azure-secret-key";
const DEPLOYMENT = "gpt-4o";

/** Build a ProviderConfig that points the `local` adapter at an Azure deployment. */
function azureConfig(baseUrl: string, apiKey: string): ProviderConfig {
  return {
    provider: "local",
    apiKey,
    // Real Azure: `https://<resource>.openai.azure.com/openai/deployments/${DEPLOYMENT}`
    // (append `?api-version=2024-08-01-preview` in production).
    baseUrl: `${baseUrl}/openai/deployments/${DEPLOYMENT}`,
    defaultModel: DEPLOYMENT,
    extraHeaders: { "api-key": apiKey },
  };
}

async function main(): Promise<void> {
  // The mock emulates Azure auth: it demands the api-key header.
  const mock = await startMockServer({ requireApiKey: AZURE_API_KEY });
  console.log(`mock Azure deployment listening at ${mock.url}/openai/deployments/${DEPLOYMENT}\n`);

  try {
    const kit = createLocalKit({
      orchestrator: createOrchestrator([azureConfig(mock.url, AZURE_API_KEY)]),
      model: DEPLOYMENT,
    });

    // 1) one-shot chat
    console.log("ask     :", await kit.ask("Summarize our Q3 roadmap in one line."));

    // 2) streaming
    process.stdout.write("stream  : ");
    for await (const delta of kit.stream("List three onboarding steps.")) {
      process.stdout.write(delta);
    }
    process.stdout.write("\n");

    // 3) structured output
    const Ticket = z.object({ title: z.string(), priority: z.number().int() });
    console.log("extract :", await kit.extract("Draft a support ticket as JSON.", Ticket));

    // 4) tool calling
    const tools = [
      {
        name: "lookup_employee",
        description: "Look up an employee by name.",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ];
    const answer = await kit.runTools("Who is Ada?", tools, {
      lookup_employee: (args) => `${String(args.name)} works in Platform Engineering.`,
    });
    console.log("runTools:", answer.text);

    // 5) auth mapping: a wrong api-key surfaces a typed AuthenticationError
    //    (the adapter maps Azure's 401 → AuthenticationError, which is non-retriable).
    const badKit = createLocalKit({
      orchestrator: createOrchestrator([azureConfig(mock.url, "wrong-key")]),
    });
    try {
      await badKit.ask("This should fail.");
      console.log("authfail: (unexpected) request succeeded");
    } catch (err) {
      const kind = err instanceof AuthenticationError ? "AuthenticationError" : "error";
      console.log(`authfail: rejected as ${kind} —`, err instanceof Error ? err.message : err);
    }
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
