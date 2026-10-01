import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs electron-builder. On Windows it builds one installer per chip (x64, arm64)
 * instead of one installer holding both, then merges the two `latest.yml` feeds:
 * the updater picks the file whose name holds its own `process.arch`.
 *
 * Windows builds never publish here; the release workflow uploads them.
 * Elsewhere the arguments go to electron-builder unchanged.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const release = path.join(root, "release");
const require = createRequire(import.meta.url);
const builder = path.join(path.dirname(require.resolve("electron-builder/package.json")), "cli.js");
const args = process.argv.slice(2);

const run = (extra) => execFileSync(process.execPath, [builder, ...extra], { cwd: root, stdio: "inherit" });

if (process.platform !== "win32") {
  run(args);
  process.exit(0);
}

const yaml = require(require.resolve("js-yaml", { paths: [path.dirname(builder)] }));
const passthrough = args.filter((a, i) => a !== "--publish" && args[i - 1] !== "--publish");
const feeds = [];
for (const arch of ["x64", "arm64"]) {
  run(["--win", `--${arch}`, "--publish", "never", ...passthrough]);
  const feed = path.join(release, `latest-${arch}.yml`);
  fs.renameSync(path.join(release, "latest.yml"), feed);
  feeds.push(yaml.load(fs.readFileSync(feed, "utf8")));
  fs.rmSync(feed);
}

// x64 first: an updater older than per-arch matching falls back to the first file.
const [first, ...rest] = feeds;
const merged = { ...first, files: feeds.flatMap((f) => f.files) };
for (const f of rest) if (f.version !== first.version) throw new Error(`feed versions differ: ${first.version} vs ${f.version}`);
fs.writeFileSync(path.join(release, "latest.yml"), yaml.dump(merged, { lineWidth: -1 }));
console.log(`package: latest.yml lists ${merged.files.map((f) => f.url).join(", ")}`);
