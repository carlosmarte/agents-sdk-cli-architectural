/**
 * A tiny, dependency-free OpenAI-compatible mock server (Node `node:http` only).
 *
 * The `local` adapter speaks the OpenAI wire protocol against a user-supplied
 * `baseUrl`, so any server that answers `POST .../chat/completions` the way
 * OpenAI does can stand in for a self-hosted model (Ollama / LM Studio / vLLM)
 * OR a private Azure OpenAI deployment. This server is exactly that stand-in: it
 * lets the example scripts exercise chat / streaming / structured output / tool
 * calling end-to-end with no credentials and no network — entirely in-process.
 *
 * It is deliberately *lenient* (it accepts the resume-after-tool message sequence
 * that the real OpenAI API rejects) so the examples can show the full happy path.
 * It is NOT a conformance fixture — see the canonical adapter unit tests for that.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

/** Minimal shape of an OpenAI chat-completions request body. */
interface ChatBody {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role: string; content?: string | null }>;
  tools?: Array<{ function?: { name?: string; parameters?: JsonSchema } }>;
  tool_choice?: unknown;
  response_format?: { type?: string };
}

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

/** Options controlling the mock's auth behavior (used by the Azure example). */
export interface MockServerOptions {
  /**
   * When set, the server emulates Azure-style auth: it requires an `api-key`
   * header equal to this value and answers 401 otherwise. When unset (the
   * self-hosted default), auth is not enforced.
   */
  requireApiKey?: string;
}

/** A running mock server: its base URL plus a close() that resolves when shut. */
export interface MockServer {
  /** e.g. `http://127.0.0.1:53124` — feed this to the adapter as `baseUrl`. */
  readonly url: string;
  /** Underlying server (port introspection / advanced use). */
  readonly server: Server;
  /** Stop listening; resolves once the socket is fully closed. */
  close(): Promise<void>;
}

/** Read and JSON-parse a request body (empty body → {}). */
async function readJson(req: IncomingMessage): Promise<ChatBody> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as ChatBody) : {};
}

/** Walk a JSON Schema and synthesize one minimal conforming value. */
function sampleFromSchema(schema: JsonSchema | undefined): unknown {
  if (!schema) return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "string":
      return "sample text";
    case "integer":
    case "number":
      return 42;
    case "boolean":
      return true;
    case "array":
      return [sampleFromSchema(schema.items)];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = sampleFromSchema(v);
      }
      return out;
    }
    default:
      return null;
  }
}

/** Fill a tool's parameters with placeholder values the example can render. */
function sampleToolArgs(parameters: JsonSchema | undefined): Record<string, unknown> {
  const args = (sampleFromSchema(parameters ?? { type: "object" }) ?? {}) as Record<
    string,
    unknown
  >;
  // Give common param names values that read naturally in the examples.
  if ("city" in args) args.city = "Paris";
  if ("name" in args) args.name = "Ada";
  return args;
}

const id = () => "chatcmpl-mock";

/** Build a non-streamed chat-completion response for the given request. */
function buildResponse(body: ChatBody): Record<string, unknown> {
  const model = body.model ?? "mock-model";
  const messages = body.messages ?? [];
  const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };

  // (1) Structured output: the adapter prepends a system message carrying the
  // JSON Schema and sets response_format=json_object. Honor it by synthesizing a
  // conforming object from that schema.
  if (body.response_format?.type === "json_object") {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const match = sys.match(/\{[\s\S]*\}$/);
    let content = "{}";
    if (match) {
      try {
        content = JSON.stringify(sampleFromSchema(JSON.parse(match[0]) as JsonSchema));
      } catch {
        content = "{}";
      }
    }
    return {
      id: id(),
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage,
    };
  }

  // (2) Resume after a tool ran: the history now contains a `tool` message —
  // fold its content into the final answer.
  const lastTool = [...messages].reverse().find((m) => m.role === "tool");
  if (lastTool) {
    return {
      id: id(),
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: `Here's what I found: ${lastTool.content}` },
          finish_reason: "stop",
        },
      ],
      usage,
    };
  }

  // (3) Tools offered and not disabled → emit a tool call for the first tool.
  if (body.tools?.length && body.tool_choice !== "none") {
    const fn = body.tools[0]?.function;
    return {
      id: id(),
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_mock_1",
                type: "function",
                function: {
                  name: fn?.name ?? "tool",
                  arguments: JSON.stringify(sampleToolArgs(fn?.parameters)),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage,
    };
  }

  // (4) Plain chat.
  return {
    id: id(),
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `Hello from the mock ${model} endpoint — your request was received.`,
        },
        finish_reason: "stop",
      },
    ],
    usage,
  };
}

/** Stream a canned reply as OpenAI-style SSE chunks. */
function writeStream(res: ServerResponse, model: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id: id(),
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  send(chunk({ role: "assistant" }));
  for (const word of ["streaming", "one", "two", "three", "four", "five"]) {
    send(chunk({ content: `${word} ` }));
  }
  res.write(
    `data: ${JSON.stringify({
      ...chunk({}, "stop"),
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Start the mock server on an ephemeral loopback port. Pass
 * `{ requireApiKey }` to emulate Azure's `api-key`-header auth.
 */
export function startMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const server = createServer((req, res) => {
    void (async () => {
      // Any path ending in /chat/completions is served — this covers both the
      // self-hosted `/v1/chat/completions` and the Azure
      // `/openai/deployments/<dep>/chat/completions` shapes.
      if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      // Azure-style auth check (only when the example asked for it).
      if (options.requireApiKey !== undefined) {
        const key = req.headers["api-key"];
        if (key !== options.requireApiKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid api-key", code: "401" } }));
          return;
        }
      }

      const body = await readJson(req);
      if (body.stream) {
        writeStream(res, body.model ?? "mock-model");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildResponse(body)));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        server,
        close: () =>
          new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
