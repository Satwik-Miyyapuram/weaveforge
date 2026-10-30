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

/** Parse one line into a request, or return the error text to send back. */
export function parseRequest(line: string): WireRequest | string {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
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
      output.write(JSON.stringify(reply) + "\n");
    });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  });
  await new Promise<void>((resolve) => rl.once("close", resolve));
  await Promise.all(pending);
}
