// Prints sync-leaf.json: git remote URL checks, pull/push lines, sync-path
// decisions and blob content types, from the TypeScript the Rust replaces.
// Run from the repo root: node crates/wf-core/tests/goldens/sync-leaf.mjs
import { writeFileSync } from "node:fs";
import {
  checkGitRemoteUrl,
  describePull,
  describePush,
  redactSecret,
} from "../../../../packages/core/src/workspace/git-remote.ts";
import { decideGitSyncPath, isUnderIgnoredFolder } from "../../../../packages/core/src/workspace/git-sync-policy.ts";
import { guessBlobContentType } from "../../../../packages/core/src/storage/blob-content-type.ts";

const urls = [
  "https://github.com/you/notes.git",
  "  https://github.com/you/notes.git  ",
  "HTTPS://GitHub.com/You/Notes.git",
  "https://github.com",
  "https://github.com/",
  "https://user@github.com/a/b.git",
  "https://user:tok@github.com/a/b.git",
  "https://:tok@github.com/a/b.git",
  "http://github.com/a/b.git",
  "ssh://git@github.com/a/b.git",
  "git@github.com:a/b.git",
  "github.com/a/b",
  "",
  "   ",
  "https://exa mple.com/a",
  "https://example.com:443/a",
  "https://example.com:8443/a/../b",
  "https://example.com/a b",
  "https://例え.jp/repo",
  "https://example.com/a?x=1#frag",
  "https://[::1]/a",
  "https://example.com/%7Euser/r",
  "https:/example.com/a",
  "https:example.com/a",
  "https://example.com\\a\\b",
];
const nonStrings = [null, 42, { url: "https://x/y" }];

const pulls = [
  { kind: "up-to-date" },
  { kind: "fast-forward" },
  { kind: "merged" },
  { kind: "conflict", files: ["a.md"] },
  { kind: "conflict", files: ["a.md", "b.md"] },
  { kind: "conflict", files: ["1", "2", "3", "4", "5"] },
  { kind: "conflict", files: ["1", "2", "3", "4", "5", "6"] },
];
const pushes = [{ kind: "pushed" }, { kind: "up-to-date" }, { kind: "rejected", reason: "non-fast-forward" }];

const redacts = [
  ["token abc in abc", "abc"],
  ["nothing", undefined],
  ["nothing", ""],
  ["aaaa", "aa"],
];

const paths = [
  "notes/a.md",
  ".weaveforge/state.json",
  "node_modules/x/y.js",
  ".git/config",
  "a/.trash/b.md",
  "paper/main.aux",
  "paper/main.synctex.gz",
  "desktop.ini",
  "sub/Desktop.ini",
  "big.bin",
  "",
  "./.",
  "notes/.weaveforge/x.md",
  "notes\\dist\\x.md",
  "notes/dist",
  "a/.git",
  "A/NODE_MODULES/b",
  "./notes//a.md",
];
const sizes = [0, 1024, 25 * 1024 * 1024, 25 * 1024 * 1024 + 1, -1, Number.NaN, Number.POSITIVE_INFINITY];

const types = ["a.png", "A.PNG", "x.jpeg", "x.jpg", "x.gif", "x.webp", "x.svg", "x.pdf", "x.md", "x.txt", "x.json", "noext", "dir.v/file", "x.tar.gz", ".png", "x."];

const out = {
  urls: [...urls, ...nonStrings].map((raw) => ({ raw, out: checkGitRemoteUrl(raw) })),
  pulls: pulls.map((r) => ({ in: r, out: describePull(r) })),
  pushes: pushes.map((r) => ({ in: r, out: describePush(r) })),
  redacts: redacts.map(([text, secret]) => ({ text, secret: secret ?? null, out: redactSecret(text, secret) })),
  ignored: paths.map((p) => ({ path: p, out: isUnderIgnoredFolder(p) })),
  decide: paths.flatMap((p) => sizes.map((size) => ({ path: p, size, out: decideGitSyncPath(p, size) }))),
  types: types.map((p) => ({ path: p, out: guessBlobContentType(p) })),
};
writeFileSync(new URL("./sync-leaf.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("wrote sync-leaf.json");
