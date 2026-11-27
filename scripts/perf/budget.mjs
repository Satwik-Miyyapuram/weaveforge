// UI budget check for WeaveForge Dev (CDP 9223), read-only. Usage: node scripts/perf/budget.mjs [--idle]
// Counts the page's composited layers, takes memory.mjs --json --dump, and exits 1 when any budget in
// .agents/ui-layers.md is broken (scripts/lib/ui-budget.mjs). --idle also checks total private bytes.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkUiBudget } from "../lib/ui-budget.mjs";
import { close, on, run, send } from "./cdp.mjs";

let layers = [];
on((d) => {
  if (d.method === "LayerTree.layerTreeDidChange" && d.params?.layers) layers = d.params.layers;
});
await send("LayerTree.enable");
// Force one commit so the layer tree is sent, then give it time to arrive.
await run(`document.body.style.outline = "1px solid transparent"; new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
await new Promise((r) => setTimeout(r, 1500));
await run(`document.body.style.outline = ""`);
const path = await run("location.pathname");
await send("LayerTree.disable");
close();

const memory = fileURLToPath(new URL("./memory.mjs", import.meta.url));
const report = JSON.parse(execFileSync(process.execPath, [memory, "--json", "--dump"], { encoding: "utf8", env: process.env }));
const failures = checkUiBudget({ path, layerCount: layers.length, report, idle: process.argv.includes("--idle") });
console.log(`${path}: ${layers.length} layers`);
for (const f of failures) console.log(`OVER ${f}`);
console.log(failures.length ? `${failures.length} budget(s) broken` : "all budgets hold");
process.exitCode = failures.length ? 1 : 0;
