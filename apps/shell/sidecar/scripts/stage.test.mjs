import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { noticeText, pgliteFiles, stage, stagePlan } from "./stage.mjs";

/** A fresh temp dir, removed when the test ends. */
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A fake repo, PGlite package, and node binary with licence, all inside a temp dir. */
function fakeRepo(t) {
  const root = tmp(t);
  const repo = path.join(root, "repo");
  const pglite = path.join(root, "pglite");
  write(path.join(repo, "db/migrations/0001.sql"), "-- m");
  write(path.join(repo, "db/migrations/README.md"), "doc");
  write(path.join(repo, "db/migrations-local/0001.sql"), "-- l");
  write(path.join(repo, "plugins/weaveforge-research/mcp-server/index.mjs"), "//mcp");
  write(path.join(pglite, "package.json"), JSON.stringify({ name: "@electric-sql/pglite", version: "0.0.0-test" }));
  write(path.join(pglite, "LICENSE"), "apache");
  write(path.join(pglite, "dist/index.js"), "//js");
  write(path.join(pglite, "dist/index.js.map"), "map");
  write(path.join(pglite, "dist/contrib/pgcrypto.tar.gz"));
  write(path.join(pglite, "dist/contrib/vector.tar.gz"));
  const nodeExe = path.join(root, "bin", "node");
  write(nodeExe, "bin");
  const nodeLicense = path.join(root, "node-LICENSE-src");
  write(nodeLicense, "mit");
  return { root, repo, pglite, nodeExe, nodeLicense, out: path.join(root, "out") };
}

const rel = (out, plan) => plan.map((s) => path.relative(out, s.to).split(path.sep).join("/"));

test("pgliteFiles keeps runtime files, drops maps and non-pgcrypto contrib", (t) => {
  const dist = tmp(t);
  for (const f of ["a.js", "a.js.map", "contrib/pgcrypto.tar.gz", "contrib/vector.tar.gz", "sub/b.wasm"]) {
    write(path.join(dist, f));
  }
  assert.deepEqual(pgliteFiles(dist), ["a.js", "contrib/pgcrypto.tar.gz", "sub/b.wasm"]);
});

test("stagePlan puts node.exe on win32 and node on linux", (t) => {
  const f = fakeRepo(t);
  const args = { repo: f.repo, out: f.out, nodeExe: f.nodeExe, nodeLicense: f.nodeLicense, pgliteDir: f.pglite };
  const win = rel(f.out, stagePlan({ ...args, platform: "win32" }));
  assert.ok(win.includes("sidecar/node.exe"));
  const linux = rel(f.out, stagePlan({ ...args, platform: "linux" }));
  assert.ok(linux.includes("sidecar/node"));
  assert.ok(!linux.includes("sidecar/node.exe"));
});

test("stagePlan lays out migrations, mcp, pglite and notices", (t) => {
  const f = fakeRepo(t);
  const plan = stagePlan({
    repo: f.repo, out: f.out, nodeExe: f.nodeExe, nodeLicense: f.nodeLicense,
    pgliteDir: f.pglite, platform: "linux",
  });
  const to = rel(f.out, plan);
  assert.ok(!to.some((p) => p.endsWith("README.md")));
  assert.ok(!to.includes("sidecar/main.mjs"));
  assert.ok(!to.includes("sidecar/README.txt"));
  assert.ok(to.includes("sidecar/weaveforge-mcp.mjs"));
  assert.ok(to.includes("sidecar/migrations/0001.sql"));
  assert.ok(to.includes("sidecar/migrations-local/0001.sql"));
  const pg = "sidecar/node_modules/@electric-sql/pglite/";
  assert.deepEqual(to.filter((p) => p.startsWith(pg)), [
    `${pg}dist/contrib/pgcrypto.tar.gz`,
    `${pg}dist/index.js`,
    `${pg}package.json`,
  ]);
  assert.ok(to.includes("sidecar/notices/node-LICENSE"));
  assert.ok(to.includes("sidecar/notices/pglite-LICENSE"));
  const mcp = plan.find((s) => s.to.endsWith("weaveforge-mcp.mjs"));
  assert.equal(mcp.from, path.join(f.repo, "plugins/weaveforge-research/mcp-server/index.mjs"));
  assert.deepEqual(to, [...to].sort());
});

test("stagePlan throws the node LICENSE message when none is found", (t) => {
  const f = fakeRepo(t);
  const nodeExe = path.join(tmp(t), "node");
  assert.throws(
    () => stagePlan({ repo: f.repo, out: f.out, nodeExe, pgliteDir: f.pglite, platform: "linux" }),
    /node LICENSE not found; pass --node-license/,
  );
});

test("stagePlan throws when the pglite LICENSE is missing", (t) => {
  const f = fakeRepo(t);
  const bare = path.join(f.root, "bare");
  write(path.join(bare, "package.json"), "{}");
  write(path.join(bare, "dist/index.js"));
  assert.throws(
    () => stagePlan({
      repo: f.repo, out: f.out, nodeExe: f.nodeExe, nodeLicense: f.nodeLicense,
      pgliteDir: bare, platform: "linux",
    }),
    /pglite LICENSE/,
  );
});

test("noticeText names both versions and both licence files", () => {
  const text = noticeText({ nodeVersion: "v22.1.0", pgliteVersion: "0.2.5" });
  assert.ok(text.includes("node v22.1.0 — node-LICENSE"));
  assert.ok(text.includes("@electric-sql/pglite 0.2.5 — pglite-LICENSE"));
});

test("stage refuses a non-empty existing sidecar dir", async (t) => {
  const root = tmp(t);
  write(path.join(root, "out", "sidecar", "x"), "stale");
  await assert.rejects(stage({ repo: root, out: path.join(root, "out") }), /not empty/);
});
