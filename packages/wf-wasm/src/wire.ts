/**
 * Sidecar wire rules (Rust `wire`): request and answer lines, the one-key
 * tagged values, and the reply shapes. Sockets, readline, ask timers and the
 * handler table stay in `apps/shell/sidecar/src/wire.ts`.
 */
import {
  wireErrorReply as rawWireErrorReply,
  wireOkReplyHead as rawWireOkReplyHead,
  wireParseRequest as rawWireParseRequest,
  wireRoute as rawWireRoute,
  wireTag as rawWireTag,
} from "../pkg/wf_wasm.js";

/** What to do with one line read from the shell. */
export type WireRoute =
  | { kind: "skip" }
  | { kind: "reply"; reply: Record<string, unknown> }
  | { kind: "call"; id: number; method: string; params?: unknown }
  | { kind: "settle"; answer: number; ok: true; value: unknown }
  | { kind: "settle"; answer: number; ok: false; error: string }
  | { kind: "badAnswer" };

/** A request line read on its own. */
export type WireParsed =
  | { ok: true; id: number; method: string; params?: unknown }
  | { ok: false; error: string };

/** A one-key tagged value, or `null` when the value is not a tag. */
export type WireTagValue =
  | { kind: "bigint"; digits: string }
  | { kind: "bytes"; encoded: string }
  | null;

/** Decide what one shell line means. `acceptAnswers` is false when no peer listens. */
export function wireRoute(line: string, acceptAnswers: boolean): WireRoute {
  return rawWireRoute(line, acceptAnswers) as WireRoute;
}

/** Read one request line on its own. */
export function wireParseRequest(line: string): WireParsed {
  return rawWireParseRequest(line) as WireParsed;
}

/** Recognise a one-key tagged object; `null` for anything else. */
export function wireTag(value: unknown): WireTagValue {
  return rawWireTag(value) as WireTagValue;
}

/** The error reply for a call that failed, or a line that could not be read (`id` null). */
export function wireErrorReply(id: number | null, error: string): Record<string, unknown> {
  return rawWireErrorReply(id, error) as Record<string, unknown>;
}

/** The start of a successful reply: `{id, ok: true}`. The shim adds `value`. */
export function wireOkReplyHead(id: number): { id: number; ok: true } {
  return rawWireOkReplyHead(id) as { id: number; ok: true };
}
