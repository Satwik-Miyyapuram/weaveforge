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

/** Read requests from `input` and write replies to `output`, one JSON line each. */
export async function serve(
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown },
  handlers: Handlers,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
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
  await Promise.all(pending);
}
