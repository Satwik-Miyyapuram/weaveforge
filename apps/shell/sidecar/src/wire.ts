import { createInterface } from "node:readline";
import { errorMessage, rust } from "@weaveforge/core";

/**
 * Sidecar wire shim. The rules (line routing, request and answer parsing, the
 * one-key tags, reply shapes) live in Rust `wire`, reached through `rust()`.
 * This file keeps what only JS can do: the readline socket, the handler table,
 * the ask timers, and turning tags into BigInt and Uint8Array.
 */

/** One call from the shell. */
export interface WireRequest {
  id: number;
  method: string;
  params?: unknown;
}

/** The answer to one call, matched to it by `id` (`null` when the line could not be read). */
export type WireReply =
  | { id: number; ok: true; value: unknown }
  | { id: number | null; ok: false; error: string };

/** What the sidecar can be asked to do. */
export type Handlers = Readonly<Record<string, (params: unknown) => Promise<unknown>>>;

/** Longest request line accepted, in UTF-16 code units. Rust enforces the same limit. */
export const MAX_LINE = 32 * 1024 * 1024;

/** What Rust decided about one line (`wireRoute`). */
type Route =
  | { kind: "skip" }
  | { kind: "reply"; reply: Record<string, unknown> }
  | { kind: "call"; id: number; method: string; params?: unknown }
  | { kind: "settle"; answer: number; ok: true; value: unknown }
  | { kind: "settle"; answer: number; ok: false; error: string }
  | { kind: "badAnswer" };

/** A request line read on its own (`wireParseRequest`). */
type Parsed = { ok: true; id: number; method: string; params?: unknown } | { ok: false; error: string };

/** A one-key tag Rust recognised (`wireTag`). */
type Tag = { kind: "bigint"; digits: string } | { kind: "bytes"; encoded: string } | null;

/** JSON.stringify replacer: bigint → {"$bigint":"<decimal>"}, Uint8Array → {"$bytes":"<base64>"}. */
export function encodeValue(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  }
  return value;
}

/**
 * Turns one one-key object into its JS value when Rust says it is a tag. Only
 * one-key objects are sent to Rust, so the wasm call is skipped for the rest.
 */
function reviveTag(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  if (Object.keys(value).length !== 1) return value;
  const tag = rust().wireTag(value) as Tag;
  if (tag === null) return value;
  return tag.kind === "bigint" ? BigInt(tag.digits) : new Uint8Array(Buffer.from(tag.encoded, "base64"));
}

/**
 * Turns every tag inside a value Rust handed back. Rust keeps tags as plain
 * objects, because a JS bigint or Uint8Array cannot cross into it.
 */
function reviveTags(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveTags);
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) obj[key] = reviveTags(obj[key]);
  return reviveTag(obj);
}

/** JSON.parse reviver: the inverse of encodeValue. Children are revived before their parent. */
export function decodeValue(this: unknown, _key: string, value: unknown): unknown {
  return reviveTag(value);
}

/** Parse one line into a request, or return the error text to send back. */
export function parseRequest(line: string): WireRequest | string {
  const parsed = rust().wireParseRequest(line) as Parsed;
  if (!parsed.ok) return parsed.error;
  const request: WireRequest = { id: parsed.id, method: parsed.method };
  if ("params" in parsed) request.params = reviveTags(parsed.params);
  return request;
}

/** Run a routed call through its handler. Never throws. */
async function callHandler(call: Extract<Route, { kind: "call" }>, handlers: Handlers): Promise<WireReply> {
  const { id, method } = call;
  if (!Object.hasOwn(handlers, method)) {
    return rust().wireErrorReply(id, "unknown method: " + method) as WireReply;
  }
  try {
    const value = await handlers[method]!(reviveTags(call.params));
    return { ...rust().wireOkReplyHead(id), value };
  } catch (e) {
    return rust().wireErrorReply(id, errorMessage(e)) as WireReply;
  }
}

/** Act on a routed line that is a reply or a call. Null for everything else. */
async function respond(route: Route, handlers: Handlers): Promise<WireReply | null> {
  if (route.kind === "reply") return route.reply as WireReply;
  if (route.kind !== "call") return null;
  return callHandler(route, handlers);
}

/** Run one line through the handlers. Never throws; returns null for blank lines and answers (no peer listens). */
export async function handleLine(line: string, handlers: Handlers): Promise<WireReply | null> {
  return respond(rust().wireRoute(line, false) as Route, handlers);
}

/** Asks and events the sidecar sends to the shell. */
export interface Peer {
  /** Asks the shell; resolves with its value, rejects with an Error carrying the shell's message. */
  ask(method: string, params?: unknown): Promise<unknown>;
  /** Sends a notice; nothing comes back. */
  emit(event: string, params?: unknown): void;
  /** Settles the ask an answer line names. False when the line is over `MAX_LINE` or not a well-formed answer. */
  settleLine(line: string): boolean;
  /** Fails every waiting ask, and every later one, with `reason`. */
  closeAll(reason: string): void;
}

/** Limits for one peer. */
export interface PeerOptions {
  timeoutMs?: number; // default 10_000
  maxInFlight?: number; // default 64
}

/** Default wait for one answer. */
export const ASK_TIMEOUT_MS = 10_000;
/** Default cap on asks waiting at once. */
export const MAX_ASKS = 64;

/** Makes a peer that asks the shell and sends it events over `output`. */
export function createPeer(output: { write(chunk: string): unknown }, options: PeerOptions = {}): Peer {
  const timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS;
  const maxInFlight = options.maxInFlight ?? MAX_ASKS;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  let next = 1;
  let closed: string | null = null;
  return {
    ask(method, params) {
      if (closed !== null) return Promise.reject(new Error(closed));
      if (waiting.size >= maxInFlight) return Promise.reject(new Error("too many asks"));
      const n = next++;
      return new Promise((resolve, reject) => {
        output.write(JSON.stringify({ ask: n, method, params }, encodeValue) + "\n");
        const timer = setTimeout(() => {
          waiting.delete(n);
          reject(new Error(`ask timed out: ${method}`));
        }, timeoutMs);
        // A waiting ask must not keep the process alive.
        timer.unref?.();
        waiting.set(n, { resolve, reject, timer });
      });
    },
    emit(event, params) {
      if (closed !== null) return;
      output.write(JSON.stringify({ event, params }, encodeValue) + "\n");
    },
    settleLine(line) {
      if (line.length > MAX_LINE) return false;
      const route = rust().wireRoute(line, true) as Route;
      if (route.kind !== "settle") return false;
      const w = waiting.get(route.answer);
      if (w === undefined) return true;
      waiting.delete(route.answer);
      clearTimeout(w.timer);
      if (route.ok) w.resolve(reviveTags(route.value));
      else w.reject(new Error(route.error));
      return true;
    },
    closeAll(reason) {
      closed ??= reason;
      for (const [n, w] of waiting) {
        waiting.delete(n);
        clearTimeout(w.timer);
        w.reject(new Error(closed));
      }
    },
  };
}

/** Read requests from `input` and write replies to `output`, one JSON line each. Answer lines go to `peer`. */
export async function serve(
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown },
  handlers: Handlers,
  peer?: Peer,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const route = rust().wireRoute(line, peer !== undefined) as Route;
    if (route.kind === "skip") return;
    if (route.kind === "settle" || route.kind === "badAnswer") {
      if (!peer?.settleLine(line)) console.error("sidecar: bad answer line");
      return;
    }
    const job = respond(route, handlers).then((reply) => {
      if (reply === null) return;
      const sent = reply.ok && reply.value === undefined ? { ...reply, value: null } : reply;
      let text: string;
      try {
        text = JSON.stringify(sent, encodeValue);
      } catch (e) {
        // A reply must always be written, so the shell never waits forever.
        text = JSON.stringify(rust().wireErrorReply(reply.id, "reply not serialisable: " + errorMessage(e)));
      }
      output.write(text + "\n");
    });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  });
  await new Promise<void>((resolve) => rl.once("close", resolve));
  peer?.closeAll("shell closed");
  await Promise.all(pending);
}
