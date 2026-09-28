import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { FOLDER_DRAFTS_DIR, parseFolderDraft } from "@weaveforge/core";

import { routeMcpRequest } from "../src/local-mcp";
import { adoptRoot, newVaultSession, type VaultSession } from "../src/vault-handlers";

const md = (fields: Record<string, string>, body = "") =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${body}\n`;

async function workspace(): Promise<{ session: VaultSession; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "weaveforge-mcp-"));
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  };
  await put("notes/ideas.note.md", md({ "weaveforge-id": "note-1", "weaveforge-type": "vault_page", title: "Ideas", "updated-at": "rev-1" }, "First idea"));
  await put("notes/ideas-two.note.md", md({ "weaveforge-id": "note-2", "weaveforge-type": "vault_page", title: "Ideas two" }, "Second"));
  await put("notes/desktop.ini", "[.ShellClassInfo]");
  await put("papers/attention.md", md({ "weaveforge-id": "paper-1", "weaveforge-type": "paper", title: "Attention is all you need", "updated-at": "p-rev" }));
  await put("papers/bert.md", md({ "weaveforge-id": "paper-2", "weaveforge-type": "paper", title: "BERT" }));
  await put("report/background.md", md({ "weaveforge-id": "sec-1", "weaveforge-type": "report_section", title: "Background" }, "Old notes"));
  await put("plan/ship.md", md({ "weaveforge-id": "ms-1", "weaveforge-type": "milestone", title: "Ship it", status: "planned" }));
  await put(".weaveforge/relations.json", JSON.stringify([{ id: "r1", fromPaper: "paper-2", toPaper: "paper-1", relation: "builds_on" }]));
  await put(
    ".weaveforge/cache/pdf-text/proj/paper-1.json",
    JSON.stringify({ paperId: "paper-1", pages: Array.from({ length: 15 }, (_, i) => ({ pageIndex: i, text: `text of page ${i + 1}` })) }),
  );
  const session = newVaultSession();
  await adoptRoot(session, root);
  return { session, root };
}

async function call(session: VaultSession, name: string, args: Record<string, unknown> = {}) {
  const response = await routeMcpRequest(session, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const result = response?.result as { isError?: boolean; content: { text: string }[] };
  return { error: !!result.isError, text: result.content[0]?.text ?? "" };
}

async function drafts(root: string) {
  const dir = path.join(root, ...FOLDER_DRAFTS_DIR.split("/"));
  const names = await readdir(dir).catch(() => [] as string[]);
  return Promise.all(names.map(async (name) => parseFolderDraft(await readFile(path.join(dir, name), "utf8"))));
}

test("tools/list names every read and suggest tool", async () => {
  const { session } = await workspace();
  const response = await routeMcpRequest(session, { id: 1, method: "tools/list" });
  const names = (response?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  for (const name of ["get_note", "get_paper_text", "suggest_note_edit", "suggest_annotation", "suggest_report_edit"]) {
    assert.ok(names.includes(name), name);
  }
});

test("entries are found by id, exact title, or a unique partial title", async () => {
  const { session } = await workspace();
  assert.match((await call(session, "get_note", { note: "note-2" })).text, /Second/);
  assert.match((await call(session, "get_note", { note: "ideas" })).text, /First idea/);
  assert.match((await call(session, "get_paper", { paper: "attention" })).text, /No PDF on disk/);
});

test("an ambiguous name asks back with the candidates", async () => {
  const { session } = await workspace();
  const out = await call(session, "get_note", { note: "idea" });
  assert.equal(out.error, true);
  assert.match(out.text, /note-1/);
  assert.match(out.text, /note-2/);
});

test("listing skips junk files and read_entry refuses WeaveForge's own files", async () => {
  const { session } = await workspace();
  const listed = await call(session, "list_workspace", { kind: "vault_page" });
  assert.doesNotMatch(listed.text, /desktop\.ini/);
  assert.match(listed.text, /Ideas two/);
  assert.equal((await call(session, "read_entry", { path: ".weaveforge/relations.json" })).error, true);
});

test("get_paper_text pages are 1-based and default to ten", async () => {
  const { session } = await workspace();
  const out = await call(session, "get_paper_text", { paper: "paper-1", fromPage: 3 });
  assert.match(out.text, /pages 3-12 of 15/);
  assert.match(out.text, /text of page 3\b/);
  assert.doesNotMatch(out.text, /text of page 13\b/);
});

test("relations resolve paper titles", async () => {
  const { session } = await workspace();
  assert.match((await call(session, "get_relations", { paper: "BERT" })).text, /BERT —builds_on→ Attention/);
});

test("suggest tools leave drafts the app can import, and change nothing else", async () => {
  const { session, root } = await workspace();
  assert.equal((await call(session, "suggest_note_edit", { note: "Ideas", body: "New body", rationale: "Tighter" })).error, false);
  assert.equal((await call(session, "suggest_annotation", { paper: "BERT", quote: "masked", page: 2 })).error, false);
  const found = await drafts(root);
  const edit = found.find((d) => d?.kind === "edit_vault_note");
  assert.deepEqual(edit?.payload, { body: "New body" });
  assert.equal(edit?.expectedRevision, "rev-1");
  assert.match(edit?.content ?? "", /Edit note: Ideas/);
  assert.match(edit?.content ?? "", /Why: Tighter/);
  assert.match(edit?.content ?? "", /\n\nNew body$/);
  assert.match(found.find((d) => d?.kind === "paper_annotation")?.content ?? "", /Quote: masked\n\nPage: 2/);
  assert.deepEqual(found.find((d) => d?.kind === "paper_annotation")?.payload, { quote: "masked", pageIndex: 1 });
  assert.match(await readFile(path.join(root, "notes", "ideas.note.md"), "utf8"), /First idea/);
});

test("a draft's preview lists tags as words, not JSON", async () => {
  const { session, root } = await workspace();
  assert.equal((await call(session, "suggest_paper_update", { paper: "BERT", rating: 4, tags: ["vae", "nlp"] })).error, false);
  const [draft] = await drafts(root);
  assert.match(draft?.content ?? "", /Rating: 4\n\nTags: vae, nlp/);
});

test("propose_report_edit still works as an alias with the old argument", async () => {
  const { session, root } = await workspace();
  assert.equal((await call(session, "propose_report_edit", { section: "Background", proposal: "Better notes" })).error, false);
  const [draft] = await drafts(root);
  assert.equal(draft?.kind, "report_edit");
  assert.equal(draft?.tool, "suggest_report_edit");
  assert.deepEqual(draft?.payload, { notes: "Better notes" });
});

test("bad values are refused before any draft is written", async () => {
  const { session, root } = await workspace();
  assert.equal((await call(session, "suggest_milestone_status", { milestone: "Ship it", status: "someday" })).error, true);
  assert.equal((await call(session, "suggest_relation", { from: "BERT", to: "BERT", relation: "cites" })).error, true);
  assert.equal((await call(session, "suggest_paper_update", { paper: "BERT", rating: 9 })).error, true);
  assert.deepEqual(await drafts(root), []);
});
