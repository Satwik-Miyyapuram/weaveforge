// Chrome DevTools Protocol client for the perf scripts; CDP_PORT defaults to WeaveForge Dev (9223).
import { writeFileSync } from "node:fs";
const port = process.env.CDP_PORT ?? "9223";
const target = `http://127.0.0.1:${port}`;
const list = await fetch(`${target}/json`).then(
  (res) => res.json(),
  (error) => {
    throw new Error(`no DevTools endpoint at ${target} (is WeaveForge Dev running with CDP_PORT=${port}?): ${error.message}`);
  },
);
const page = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
if (!page) throw new Error(`no page target at ${target}/json`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
// Without the error/close handlers a refused socket left this await pending forever.
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error(`could not connect to ${page.webSocketDebuggerUrl}`)));
});
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
ws.addEventListener("close", () => {
  for (const settle of pending.values()) settle({ error: { message: "DevTools connection closed" } });
  pending.clear();
});
export const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
export const run = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.result.value;
};
export const shot = async (file, clip) => {
  const r = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip: { scale: 1, ...clip } }) });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
};
export const close = () => ws.close();
