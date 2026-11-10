/**
 * Chat system-prompt split (Rust `ai::chat_split`), re-exported from feature-wrappers.ts.
 * Joins the system messages with a blank line and keeps the other messages in order, extra fields included.
 */
import { splitAiSystemMessages as rawSplitAiSystemMessages } from "../pkg/wf_wasm.js";

export interface AiSplitSystem<M> {
  /** Every system message's text, joined by a blank line. */
  system: string;
  /** The messages that are not system messages, in their original order. */
  rest: M[];
}

/** Splits chat messages into the joined system prompt and the other messages. */
export function splitAiSystemMessages<M extends { role: string }>(messages: readonly M[]): AiSplitSystem<M> {
  return rawSplitAiSystemMessages(messages) as AiSplitSystem<M>;
}
