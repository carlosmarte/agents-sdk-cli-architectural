import type { FinishReason, StreamChunk, TokenUsage } from "@llmorch/core";

/**
 * The Anthropic streaming wire format is a multi-event lifecycle, not a flat
 * delta stream:
 *
 *   message_start → content_block_start → content_block_delta* →
 *   content_block_stop → message_delta → message_stop
 *
 * The actual generated text lives ONLY in `content_block_delta` events
 * (`delta.text`). This state machine consumes the full lifecycle, surfaces just
 * those text deltas as clean string chunks, filters every structural event, and
 * closes with exactly one terminal chunk carrying the merged usage + finish
 * reason. It is isolated here so the lifecycle handling is independently testable.
 */

/** A structural view of the Anthropic stream events this machine handles. */
export interface AnthropicStreamEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic stop_reason → normalized FinishReason. */
function mapStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_use";
    default:
      return "stop";
  }
}

/** Fold a usage fragment into the running total (each event carries a subset). */
function mergeUsage(
  current: TokenUsage | undefined,
  fragment: { input_tokens?: number; output_tokens?: number } | undefined,
): TokenUsage {
  return {
    promptTokens: fragment?.input_tokens ?? current?.promptTokens ?? 0,
    completionTokens: fragment?.output_tokens ?? current?.completionTokens ?? 0,
  };
}

/** Accept either a sync or async iterable of events. */
async function* asAsync<T>(
  events: AsyncIterable<T> | Iterable<T>,
): AsyncGenerator<T> {
  if (Symbol.asyncIterator in events) {
    yield* events as AsyncIterable<T>;
  } else {
    for (const ev of events as Iterable<T>) yield ev;
  }
}

/**
 * Transform an Anthropic SSE event lifecycle into the normalized
 * {@link StreamChunk} sequence: zero-or-more text deltas then one terminal chunk.
 */
export async function* anthropicSseToChunks(
  events: AsyncIterable<AnthropicStreamEvent> | Iterable<AnthropicStreamEvent>,
): AsyncGenerator<StreamChunk, void, unknown> {
  let usage: TokenUsage | undefined;
  let finishReason: FinishReason | undefined;

  for await (const ev of asAsync(events)) {
    switch (ev.type) {
      case "content_block_delta":
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          yield { delta: ev.delta.text };
        }
        break;
      case "message_start":
        usage = mergeUsage(usage, ev.message?.usage);
        break;
      case "message_delta":
        usage = mergeUsage(usage, ev.usage);
        if (ev.delta?.stop_reason) finishReason = mapStopReason(ev.delta.stop_reason);
        break;
      // Structural events carry no text and are intentionally filtered.
      case "content_block_start":
      case "content_block_stop":
      case "message_stop":
        break;
      default:
        break;
    }
  }

  yield {
    delta: "",
    usage: usage ?? { promptTokens: 0, completionTokens: 0 },
    finishReason: finishReason ?? "stop",
  };
}
