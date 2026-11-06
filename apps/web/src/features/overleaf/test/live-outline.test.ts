import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkshopClientDeps } from "../infrastructure/workshop-session-client";
import { loadLiveOutline } from "../application/live-outline";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tree = [{ docs: [{ _id: "d1", name: "main.tex" }], folders: [{ name: "ch", docs: [{ _id: "d2", name: "intro.tex" }] }] }];
const TEXT: Record<string, string[]> = {
  d1: ["\\documentclass{article}", "\\begin{document}", "\\input{ch/intro}", "\\section{Method}", "We did it.", "\\end{document}"],
  d2: ["\\section{Introduction}", "Some words here."],
};

function deps(route: (path: string, body: Record<string, string>) => Response) {
  const calls: string[] = [];
  const client: WorkshopClientDeps = {
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      calls.push(url.split("/").pop()!);
      return route(url, body);
    },
    authHeaders: async (extra) => ({ ...(extra as Record<string, string>) }),
  };
  return { client, calls };
}

const ok = (rootDocId: string | null = "d1") => (url: string, body: Record<string, string>) => {
  if (url.endsWith("/open")) return json({ liveId: "L1", name: "Thesis", rootDocId, rootFolder: tree, permissionsLevel: "owner" });
  if (url.endsWith("/doc")) return json({ lines: TEXT[body.docId!], version: 3 });
  return json({});
};

test("reads every doc, starts at the root doc, and closes the connection", async () => {
  const { client, calls } = deps(ok());
  const res = await loadLiveOutline(client, "s1", "p1");
  assert.ok(res.ok);
  assert.equal(res.content.entryFile, "main.tex");
  assert.deepEqual(res.content.files.map((f) => f.path), ["ch/intro.tex", "main.tex"]);
  assert.deepEqual(res.content.sectionTree.roots.map((n) => n.title), ["Introduction", "Method"]);
  assert.equal(calls.filter((c) => c === "close").length, 1);
  assert.equal(calls.at(-1), "close");
});

test("with no root doc, main.tex is the entry", async () => {
  const { client } = deps(ok(null));
  const res = await loadLiveOutline(client, "s1", "p1");
  assert.ok(res.ok);
  assert.equal(res.content.entryFile, "main.tex");
});

test("a failed open is passed on (expired too) and nothing is closed", async () => {
  const { client, calls } = deps(() => json({ error: "Sign in again.", expired: true }, 401));
  const res = await loadLiveOutline(client, "s1", "p1");
  assert.deepEqual(res, { ok: false, expired: true, message: "Sign in again." });
  assert.deepEqual(calls, ["open"]);
});

test("a doc that fails to load fails the outline, and the connection is still closed", async () => {
  const { client, calls } = deps((url, body) =>
    url.endsWith("/doc") && body.docId === "d2" ? json({ error: "Gone." }, 502) : ok()(url, body));
  const res = await loadLiveOutline(client, "s1", "p1");
  assert.deepEqual(res, { ok: false, expired: false, message: "Gone." });
  assert.equal(calls.at(-1), "close");
});
