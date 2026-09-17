#!/usr/bin/env node
/**
 * Build the Windows Ink recogniser helper for both architectures.
 *
 * `electron-builder`'s Windows target ships `arm64` and `x64` (§10), so the helper
 * is built for both and placed where `inkRecogniserPath()` looks for them:
 *
 *   apps/desktop/native/ink-recogniser/win-arm64/ink-recogniser.exe
 *   apps/desktop/native/ink-recogniser/win-x64/ink-recogniser.exe
 *
 * **Both are built from this machine, which is arm64.** That is fine — the .NET
 * SDK cross-publishes `win-x64` from an arm64 host — and it is why this script
 * exists rather than a build step in `electron-builder`: the helper has to be
 * published per runtime identifier, which the packaging config cannot express.
 *
 * A missing .NET SDK is not an error. The desktop app degrades to the web
 * recogniser (§5.3), so a contributor without the SDK gets a working app and a
 * line saying what was skipped — the same rule `probeTex()` follows for TeX.
 *
 *   node scripts/build-ink-recogniser.mjs            both
 *   node scripts/build-ink-recogniser.mjs --arch=arm64
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(desktopRoot, "native", "ink-recogniser", "InkRecogniser.csproj");
const outputRoot = join(desktopRoot, "native", "ink-recogniser");

const archArg = process.argv.find((argument) => argument.startsWith("--arch="));
const wanted = archArg
  ? [archArg.slice("--arch=".length)]
  : ["arm64", "x64"];

/** `arm64` → `win-arm64`, the runtime identifier the .NET SDK wants. */
const runtimeId = (arch) => `win-${arch}`;

function haveDotnet() {
  const probe = spawnSync("dotnet", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return probe.status === 0;
}

if (!haveDotnet()) {
  console.log("build-ink-recogniser: no .NET SDK on this machine; skipping the Windows Ink helper.");
  console.log("  The app falls back to the web recogniser, which is a supported configuration.");
  process.exit(0);
}

let failed = false;
for (const arch of wanted) {
  const rid = runtimeId(arch);
  const out = join(outputRoot, rid);
  mkdirSync(out, { recursive: true });
  const started = Date.now();
  const result = spawnSync(
    "dotnet",
    [
      "publish",
      project,
      "-c",
      "Release",
      "-r",
      rid,
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:PublishTrimmed=true",
      "-o",
      out,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    // A failed publish is a real failure: shipping an app whose recogniser is
    // silently missing is worse than failing the build that would have made it.
    console.error(`build-ink-recogniser: publish failed for ${rid}`);
    failed = true;
    continue;
  }
  const executable = join(out, "ink-recogniser.exe");
  const size = existsSync(executable) ? statSync(executable).size : 0;
  console.log(
    `build-ink-recogniser: ${rid} → ${executable} ` +
      `(${(size / 1024 / 1024).toFixed(1)} MB, ${Date.now() - started} ms)`,
  );
  if (size === 0) failed = true;
}

process.exit(failed ? 1 : 0);
