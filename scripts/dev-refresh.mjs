// Rebuild only the changed parts of WeaveForge Dev: web (Next export) and/or shell (Tauri exe).
// Usage: node scripts/dev-refresh.mjs --out <dev folder> [--web] [--shell] [--auto] [--dry-run]
// The exe loads its UI from <out>\web, so a web-only change needs no cargo and a shell-only change needs no Next build.
// Exit codes: 0 ok, 1 step failed, 2 usage.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node scripts/dev-refresh.mjs --out <dev folder> [--web] [--shell] [--auto] [--dry-run]";
const SHELL_PREFIXES = ["apps/shell/src/", "apps/shell/Cargo.toml", "apps/shell/tauri", "crates/", "plugins/", "Cargo.toml", "Cargo.lock"];
const WEB_PREFIXES = ["apps/web/", "packages/", "apps/shell/scripts/build-web.mjs", "package-lock.json"];
const WEB_IGNORE = ["apps/web/next-env.d.ts"];
const STAMP_NAME = ".dev-refresh.json";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function usage() {
  fail(USAGE, 2);
}

const args = process.argv.slice(2);
let out = process.env.WF_DEV_OUT;
const flags = new Set();
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--out") {
    out = args[++i];
    if (!out) usage();
  } else if (["--web", "--shell", "--auto", "--dry-run"].includes(arg)) {
    flags.add(arg);
  } else {
    usage();
  }
}
if (!out) usage();

// Never touch the installed app; only the Dev folder is refreshed.
const installedPattern = "appdata/local/weaveforge";
if ([out, resolve(out)].some((p) => p.replace(/\\/g, "/").toLowerCase().includes(installedPattern))) {
  fail(`refusing: ${out} is under AppData\\Local\\WeaveForge (the installed app); pass the Dev folder`, 2);
}

const git = (gitArgs, cwd) => execFileSync("git", gitArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = git(["rev-parse", "--show-toplevel"], scriptDir);

// Stamp = commit the Dev folder was last refreshed from; unusable stamp counts as no stamp.
const stampPath = join(out, STAMP_NAME);
let stampCommit = null;
if (existsSync(stampPath)) {
  try {
    stampCommit = JSON.parse(readFileSync(stampPath, "utf8")).commit ?? null;
  } catch {
    stampCommit = null;
  }
}
function commitExists(sha) {
  try {
    git(["cat-file", "-e", sha], root);
    return true;
  } catch {
    return false;
  }
}
const usableStamp = stampCommit && commitExists(stampCommit) ? stampCommit : null;

let changed = [];
if (usableStamp) changed.push(...lines(git(["diff", "--name-only", usableStamp], root)));
changed.push(...lines(git(["diff", "--name-only", "HEAD"], root)));
changed.push(...lines(git(["ls-files", "--others", "--exclude-standard"], root)));
changed = [...new Set(changed)];

const matches = (prefixes, ignore = []) =>
  changed.filter((p) => !ignore.includes(p) && prefixes.some((prefix) => p.startsWith(prefix)));
const show = (label, list) => {
  const more = list.length > 10 ? ` (+${list.length - 10} more)` : "";
  console.log(`  ${label}: ${list.slice(0, 10).join(", ")}${more}`);
};

const explicit = flags.has("--web") || flags.has("--shell");
let wantWeb;
let wantShell;
if (explicit) {
  wantWeb = flags.has("--web");
  wantShell = flags.has("--shell");
} else if (!usableStamp) {
  console.log(`no refresh stamp at ${stampPath}: both parts`);
  wantWeb = true;
  wantShell = true;
} else {
  const shellHits = matches(SHELL_PREFIXES);
  const webHits = matches(WEB_PREFIXES, WEB_IGNORE);
  wantShell = shellHits.length > 0;
  wantWeb = webHits.length > 0;
  if (wantShell) show("shell triggers", shellHits);
  if (wantWeb) show("web triggers", webHits);
}

if (!wantWeb && !wantShell) {
  console.log("Dev is current");
  process.exit(0);
}
console.log(`parts: ${[wantShell && "shell", wantWeb && "web"].filter(Boolean).join(" + ")}`);

const shellCwd = join(root, "apps", "shell");
const exeSource = join(root, "target", "release", "weaveforge-shell.exe");
const webSource = join(root, "apps", "shell", "dist", "web");

if (flags.has("--dry-run")) {
  if (wantShell) {
    console.log("shell: npm run tauri -- build --no-bundle --config tauri.dev.json (cwd apps/shell, CARGO_PROFILE_RELEASE_INCREMENTAL=true)");
    console.log(`shell: copy ${exeSource} -> ${join(out, "weaveforge-shell.exe")}`);
  }
  if (wantWeb) {
    console.log("web: node scripts/build-web.mjs (cwd apps/shell)");
    console.log(`web: copy ${webSource} -> ${join(out, "web")}`);
  }
  console.log("dry-run: nothing run, no stamp written");
  process.exit(0);
}

function refreshShell() {
  console.log("== shell: tauri build (tauri.dev.json) ==");
  // --config tauri.dev.json is required: without the overlay the build migrates from the installed app's data.
  execFileSync("npm", ["run", "tauri", "--", "build", "--no-bundle", "--config", "tauri.dev.json"], {
    cwd: shellCwd,
    // Incremental reuses work inside the shell crate; Dev only, never CI release.
    env: { ...process.env, CARGO_PROFILE_RELEASE_INCREMENTAL: "true" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  try {
    copyFileSync(exeSource, join(out, "weaveforge-shell.exe"));
  } catch (error) {
    if (error.code === "EBUSY" || error.code === "EPERM") {
      fail("close WeaveForge Dev first, then rerun with --shell");
    }
    throw error;
  }
}

function refreshWeb() {
  console.log("== web: next export ==");
  // build-web keeps the Next cache in apps/web/.next-desktop, so rebuilds compile only what changed.
  execFileSync(process.execPath, ["scripts/build-web.mjs"], { cwd: shellCwd, stdio: "inherit" });
  // Old hashed chunks left in <out>\web are harmless, so nothing is deleted.
  cpSync(webSource, join(out, "web"), { recursive: true, force: true });
}

try {
  if (wantShell) refreshShell();
  if (wantWeb) refreshWeb();
} catch (error) {
  fail(`step failed: ${error.message}`, 1);
}

const head = git(["rev-parse", "HEAD"], root);
writeFileSync(stampPath, `${JSON.stringify({ commit: head }, null, 2)}\n`);
console.log(`stamp: ${head}`);

// Best-effort reload of Dev; never fails the run.
async function reloadDev() {
  const port = process.env.CDP_PORT ?? "9223";
  const manual = "reload WeaveForge Dev yourself (Ctrl+R)";
  let ws;
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json());
    const page = list.find((p) => p.type === "page" && p.url.startsWith("https://app.localhost"));
    if (!page) {
      console.log(manual);
      return;
    }
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveDone, rejectDone) => {
      const timer = setTimeout(resolveDone, 2000);
      ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Page.reload", params: { ignoreCache: true } })));
      ws.addEventListener("message", (ev) => {
        if (JSON.parse(ev.data).id === 1) {
          clearTimeout(timer);
          resolveDone();
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        rejectDone(new Error("socket error"));
      });
    });
    console.log("reloaded WeaveForge Dev");
  } catch {
    console.log(manual);
  } finally {
    ws?.close();
  }
}

if (wantWeb) await reloadDev();
