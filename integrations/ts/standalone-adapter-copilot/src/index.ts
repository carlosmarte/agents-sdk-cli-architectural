/* Standalone copy of @llmorch/adapter-copilot (Pattern 2). Kept identical to
   the canonical adapter; fork/vendor this package independently. */
import type { ZodType } from "zod";

import {
  AuthenticationError,
  type ChatRequest,
  type LLMProvider,
  OrchestrationError,
  ProviderError,
  type ProviderConfig,
  RateLimitError,
  type StreamChunk,
  type ToolResult,
  type UnifiedResponse,
  parseOrThrow,
  registerProvider,
  zodToJsonSchema,
} from "@llmorch/core";

import {
  type CopilotClientLike,
  type CopilotReply,
  type CopilotSessionLike,
  makeCopilotClient,
} from "./copilot-client.js";

export {
  COPILOT_CLI_ARGS,
  type CopilotClientLike,
  type CopilotSessionLike,
  makeCopilotClient,
  resolveCopilotCli,
} from "./copilot-client.js";

/** Marker retained for back-compat with the original skeleton export. */
export const ADAPTER = "copilot" as const;

/** Copilot's reply carries no token accounting, so usage is always reported zero. */
const NO_USAGE = { promptTokens: 0, completionTokens: 0 } as const;

/** Pull the assistant text off a `sendAndWait` reply. */
function contentOf(reply: CopilotReply | undefined): string {
  return reply?.data?.content ?? "";
}

/**
 * Flatten a (stateless) message history into a single prompt for the Copilot
 * session. The orchestrator re-sends the full history every turn, so we render
 * each turn with a role tag and let the CLI session treat it as one prompt.
 */
function flattenPrompt(req: ChatRequest): string {
  return req.messages
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      switch (m.role) {
        case "system":
          return `[system]\n${content}`;
        case "assistant":
          return `[assistant]\n${content}`;
        case "tool":
          return `[tool result]\n${content}`;
        default:
          return content;
      }
    })
    .join("\n\n");
}

/** Best-effort extraction of a JSON object/array from free-form model text. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text) ?? "";
  const start = body.search(/[{[]/);
  if (start === -1) return body.trim();
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return end > start ? body.slice(start, end + 1) : body.slice(start);
}

/**
 * GitHub Copilot adapter over `@github/copilot-sdk` — it drives the agentic
 * Copilot CLI via a {@link CopilotClientLike} constructed with the resolved CLI
 * path and `--disable-builtin-mcps` (see {@link makeCopilotClient}), the same
 * wiring as the reference examples-github-copilot-cli-sdk integrations. Each call
 * opens a fresh session and `sendAndWait`s a flattened prompt.
 *
 * Capability notes (the SDK surface is intentionally small):
 * - Token usage is not surfaced, so {@link UnifiedResponse.usage} is always zero.
 * - There is no strict JSON-schema mode; {@link generateStructured} embeds the
 *   schema in the prompt and parses/validates the reply.
 * - The CLI dispatches its own tools internally and never surfaces host-side
 *   function tool_calls, so {@link invokeTool} answers directly (no `tool_use`
 *   halt) and {@link resumeTool} folds prior tool results into the prompt.
 *
 * Self-registers under id `copilot` at module load.
 */
export class CopilotAdapter implements LLMProvider {
  readonly providerId = "copilot";
  private readonly config: ProviderConfig;
  private cachedClient?: CopilotClientLike;
  private approveAll?: unknown;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /** Lazily construct the SDK client so registration never spawns the CLI. */
  private async getClient(): Promise<CopilotClientLike> {
    if (!this.cachedClient) {
      const rt = await makeCopilotClient(this.config);
      this.cachedClient = rt.client;
      this.approveAll = rt.approveAll;
    }
    return this.cachedClient;
  }

  /** Open a session for one call, approving any CLI permission prompts. */
  private async openSession(
    req: ChatRequest,
    opts: { streaming?: boolean } = {},
  ): Promise<CopilotSessionLike> {
    const client = await this.getClient();
    return client.createSession({
      model: req.model,
      ...(opts.streaming ? { streaming: true } : {}),
      onPermissionRequest: this.approveAll,
    });
  }

  /** Normalize a Copilot reply into a {@link UnifiedResponse}. */
  mapResponse(reply: CopilotReply | undefined): UnifiedResponse {
    return {
      text: contentOf(reply),
      usage: { ...NO_USAGE },
      toolCalls: [],
      finishReason: "stop",
    };
  }

  mapError(err: unknown): OrchestrationError {
    if (err instanceof OrchestrationError) return err;
    const opts = { providerId: this.providerId, cause: err };
    const msg = String((err as { message?: unknown })?.message ?? err ?? "");
    if (/unauthor|forbidden|\b401\b|\b403\b|auth|token|login|gh auth/i.test(msg)) {
      return new AuthenticationError("copilot: unauthorized", opts);
    }
    if (/rate.?limit|\b429\b|quota|too many requests/i.test(msg)) {
      return new RateLimitError("copilot: rate limited", opts);
    }
    return new ProviderError("copilot: request failed", opts);
  }

  async chat(req: ChatRequest): Promise<UnifiedResponse> {
    try {
      const session = await this.openSession(req);
      const reply = await session.sendAndWait({ prompt: flattenPrompt(req) });
      return this.mapResponse(reply);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    let session: CopilotSessionLike;
    try {
      session = await this.openSession(req, { streaming: true });
    } catch (err) {
      throw this.mapError(err);
    }

    // Bridge the SDK's event callbacks into a pull-based async generator.
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failure: unknown;
    const finish = (err?: unknown) => {
      if (finished) return;
      if (err !== undefined) failure = err;
      finished = true;
      wake?.();
      wake = null;
    };

    const offDelta = session.on("assistant.message_delta", (ev) => {
      const c = ev?.data?.content;
      if (c) {
        queue.push(c);
        wake?.();
        wake = null;
      }
    });
    const offIdle = session.on("session.idle", () => finish());
    session
      .sendAndWait({ prompt: flattenPrompt(req) })
      .then(() => finish())
      .catch((err) => finish(err));

    try {
      while (true) {
        while (queue.length) yield { delta: queue.shift()! };
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      offDelta();
      offIdle();
    }

    if (failure !== undefined) throw this.mapError(failure);
    yield { delta: "", usage: { ...NO_USAGE }, finishReason: "stop" };
  }

  async generateStructured<T>(req: ChatRequest, schema: ZodType<T>): Promise<T> {
    try {
      const session = await this.openSession(req);
      const prompt = [
        flattenPrompt(req),
        "",
        "Respond with ONLY a single JSON value conforming to this JSON Schema.",
        "Do not wrap it in markdown fences, comments, or any surrounding prose.",
        JSON.stringify(zodToJsonSchema(schema)),
      ].join("\n");
      const reply = await session.sendAndWait({ prompt });
      return parseOrThrow(schema, JSON.parse(extractJson(contentOf(reply)) || "{}"));
    } catch (err) {
      if (err instanceof OrchestrationError) throw err;
      throw this.mapError(err);
    }
  }

  /**
   * The Copilot CLI dispatches its own tools internally and does not surface
   * host-side function tool_calls, so there is no `tool_use` halt to return —
   * we answer directly, exactly like {@link chat}.
   */
  async invokeTool(req: ChatRequest): Promise<UnifiedResponse> {
    return this.chat(req);
  }

  /** Fold any prior tool results into the prompt as context, then answer. */
  async resumeTool(req: ChatRequest, results: ToolResult[]): Promise<UnifiedResponse> {
    try {
      const session = await this.openSession(req);
      const prompt = [
        flattenPrompt(req),
        "",
        "[tool results]",
        ...results.map((r) => `- ${r.name || r.id}: ${r.content}`),
      ].join("\n");
      const reply = await session.sendAndWait({ prompt });
      return this.mapResponse(reply);
    } catch (err) {
      throw this.mapError(err);
    }
  }
}

registerProvider("copilot", CopilotAdapter);

/** Provider id this standalone adapter registers. */
export const PROVIDER_ID = "copilot" as const;
