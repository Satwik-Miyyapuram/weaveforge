import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Starts the real app and asks the page what it can see.
 *
 * `test/handlers.test.ts` covers what the handlers do; this covers the thing a
 * unit test structurally cannot — that the preload actually attaches, that it
 * exposes the bridge and nothing else, and that the guard is live in a real
 * Electron process rather than only in a module.
 *
 * Not part of `check:all`: it needs a display (Xvfb is fine) and a built
 * `dist/`, and neither belongs in the fast loop. Run it by hand after touching
 * `main.ts` or `preload.ts`:
 *
 *     npm run build --workspace @weaveforge/desktop
 *     xvfb-run -a node apps/desktop/scripts/smoke.mjs
 */

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Electron's executable, taken from the package rather than from `npx`.
 *
 * `spawn("npx", …)` is an ENOENT on Windows — `npx` there is `npx.cmd`, and
 * `spawn` without a shell does not go looking for shims. The `electron` package
 * exports the path to the binary it downloaded, which is the same answer on
 * every platform and one process shallower besides.
 */
const ELECTRON = createRequire(import.meta.url)("electron");

const page = `<!doctype html><meta charset="utf-8"><title>smoke</title><script>
(async () => {
  const out = {};
  const bridge = window.weaveforge;
  out.present = Boolean(bridge);
  out.members = bridge ? Object.keys(bridge).sort() : [];
  out.platform = bridge?.platform;
  // Nothing from the preload's world may be reachable from the page's.
  out.leaked = Object.entries({ require: window.require, process: window.process, ipcRenderer: window.ipcRenderer })
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  try { await bridge.fetchTitle("http://127.0.0.1:${PORT}/"); out.loopback = "ALLOWED"; }
  catch (error) { out.loopback = "refused"; }
  try { await bridge.fetchImage("http://169.254.169.254/latest/meta-data/"); out.metadata = "ALLOWED"; }
  catch (error) { out.metadata = "refused"; }
  // Answers null from source — the check is skipped when the app is not
  // packaged, because then the "update" is the release the source is ahead of.
  try { out.update = JSON.stringify(await bridge.checkUpdate()); }
  catch (error) { out.update = "THREW: " + error.message; }
  await fetch("/report", { method: "POST", body: JSON.stringify(out) });
})();
</script><h1>smoke</h1>`;

const EXPECTED_MEMBERS = ["checkUpdate", "fetchImage", "fetchTitle", "onSignIn", "platform", "version"];

let reported = null;
const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/report") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      reported = body;
      response.end("ok");
    });
    return;
  }
  response.setHeader("content-type", "text/html");
  response.end(page);
});

server.listen(PORT, "127.0.0.1", () => {
  // Its own process group where there are process groups, because Electron is
  // several processes and killing only the one started here leaves the rest
  // running — holding the single-instance lock, so the *next* run quits on
  // startup and reports nothing at all. That is a confusing half-hour.
  const child = spawn(ELECTRON, [root, "--no-sandbox"], {
    env: { ...process.env, WEAVEFORGE_URL: `http://127.0.0.1:${PORT}` },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));

  const started = Date.now();
  const poll = setInterval(() => {
    if (!reported && Date.now() - started < 60_000) return;
    clearInterval(poll);
    stop(child);
    server.close();
    finish(reported, log);
  }, 500);
});

/** Kills the whole tree, not just the process started here. */
function stop(child) {
  try {
    if (process.platform === "win32") {
      // Windows has no process groups to signal: `kill(-pid)` is an error, and
      // killing the parent alone orphans Electron's children. `taskkill /t`
      // is how the tree is taken down there.
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone, which is the outcome either way.
  }
}

function finish(body, log) {
  if (!body) {
    console.error("The page never reported. Electron said:\n" + log.slice(-4000));
    process.exit(1);
  }

  const result = JSON.parse(body);
  const failures = [];
  if (!result.present) failures.push("window.weaveforge is missing — the preload did not attach.");
  if (result.members.join() !== EXPECTED_MEMBERS.join()) {
    failures.push(`the bridge exposes ${result.members.join(", ") || "nothing"}, expected ${EXPECTED_MEMBERS.join(", ")}.`);
  }
  if (result.leaked.length) failures.push(`the page can reach ${result.leaked.join(", ")}.`);
  if (result.loopback !== "refused") failures.push("a loopback address was fetched.");
  if (result.metadata !== "refused") failures.push("the cloud metadata address was fetched.");
  // Not "there is no update" — this is running from source, where the check is
  // skipped outright. What it proves is that the channel is registered and
  // answers, rather than hanging until the invoke times out.
  if (result.update !== "null") failures.push(`checkUpdate answered ${result.update}, expected null from source.`);

  if (failures.length) {
    for (const failure of failures) console.error("FAIL: " + failure);
    process.exit(1);
  }
  console.log(`ok — bridge present on ${result.platform}, nothing leaked, private addresses refused.`);
}
