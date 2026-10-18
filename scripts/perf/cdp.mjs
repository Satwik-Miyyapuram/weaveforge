// Chrome DevTools Protocol client for the perf scripts; CDP_PORT defaults to WeaveForge Dev (9223).
import { writeFileSync } from "node:fs";
const port = process.env.CDP_PORT ?? "9223";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
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
