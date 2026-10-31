import { createInterface } from "node:readline";
import { errorMessage } from "@weaveforge/core";

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

/** Longest request line accepted, in UTF-16 code units. */
export const MAX_LINE = 32 * 1024 * 1024;

/** JSON.stringify replacer: bigint → {"$bigint":"<decimal>"}, Uint8Array → {"$bytes":"<base64>"}. */
export function encodeValue(this: unknown, key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  }
  return value;
}

/** JSON.parse reviver: the inverse of encodeValue, for objects with exactly that one key and a string value. */
export function decodeValue(this: unknown, key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return value;
  if (keys[0] === "$bigint" && typeof obj.$bigint === "string" && /^-?\d+$/.test(obj.$bigint)) {
    return BigInt(obj.$bigint);
  }
  if (keys[0] === "$bytes" && typeof obj.$bytes === "string") {
    return new Uint8Array(Buffer.from(obj.$bytes, "base64"));
  }
  return value;
}

/** Parse one line into a request, or return the error text to send back. */
export function parseRequest(line: string): WireRequest | string {
  let raw: unknown;
  try {
    raw = JSON.parse(line, decodeValue);
  } catch {
    return "bad request: not JSON";
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "bad request: needs an integer id and a method";
  }
  const obj = raw as Record<string, unknown>;
  const { id, method } = obj;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 0 ||
    typeof method !== "string" ||
    method === ""
  ) {
    return "bad request: needs an integer id and a method";
  }
  const request: WireRequest = { id, method };
  if ("params" in obj) request.params = obj.params;
  return request;
}

/** Run one line through the handlers. Never throws; returns null for blank lines. */
export async function handleLine(line: string, handlers: Handlers): Promise<WireReply | null> {
  if (line.trim() === "") return null;
  if (line.length > MAX_LINE) return { id: null, ok: false, error: "bad request: line too long" };
  const parsed = parseRequest(line);
  if (typeof parsed === "string") return { id: null, ok: false, error: parsed };
  const { id, method, params } = parsed;
  if (!Object.hasOwn(handlers, method)) {
    return { id, ok: false, error: "unknown method: " + method };
  }
  try {
    const value = await handlers[method]!(params);
    return { id, ok: true, value };
  } catch (e) {
    return { id, ok: false, error: errorMessage(e) };
  }
}

/** Asks and events the sidecar sends to the shell. */
export interface Peer {
  /** Asks the shell; resolves with its value, rejects with an Error carrying the shell's message. */
  ask(method: string, params?: unknown): Promise<unknown>;
  /** Sends a notice; nothing comes back. */
  emit(event: string, params?: unknown): void;
  /** Settles the ask an answer line names. False when the line is not a well-formed answer. */
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
      let raw: unknown;
      try {
        raw = JSON.parse(line, decodeValue);
      } catch {
        return false;
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
      const obj = raw as Record<string, unknown>;
      const { answer, ok } = obj;
      if (typeof answer !== "number" || !Number.isSafeInteger(answer) || answer < 1) return false;
      if (typeof ok !== "boolean") return false;
      if (!ok && typeof obj.error !== "string") return false;
      const w = waiting.get(answer);
      if (w === undefined) return true;
      waiting.delete(answer);
      clearTimeout(w.timer);
      if (ok) w.resolve(obj.value);
      else w.reject(new Error(obj.error as string));
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
    if (peer && line.startsWith('{"answer":')) {
      if (!peer.settleLine(line)) console.error("sidecar: bad answer line");
      return;
    }
    const job = handleLine(line, handlers).then((reply) => {
      if (reply === null) return;
      if (reply.ok && reply.value === undefined) reply.value = null;
      let text: string;
      try {
        text = JSON.stringify(reply, encodeValue);
      } catch (e) {
        // A reply must always be written, so the shell never waits forever.
        text = JSON.stringify({ id: reply.id, ok: false, error: "reply not serialisable: " + errorMessage(e) });
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
