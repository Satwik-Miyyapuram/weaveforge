import assert from "node:assert/strict";
import fsp, { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

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

test("a big .git folder does not use up the walk before the projects", async () => {
  const { session, root } = await workspace();
  const objects = path.join(root, ".git", "objects");
  await mkdir(objects, { recursive: true });
  await Promise.all(Array.from({ length: 2_100 }, (_, i) => writeFile(path.join(objects, `obj${i}`), "")));
  assert.match((await call(session, "list_workspace", { kind: "paper" })).text, /BERT/);
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

const PROJECTS = [{ id: "aaaaaa-1", name: "Proj A" }, { id: "bbbbbb-2", name: "Proj B" }, { id: "cccccc-3", name: "Empty" }];

async function twoProjects(): Promise<{ session: VaultSession; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "weaveforge-mcp-projects-"));
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  };
  await put("proj-a--aaaaaa/notes/alpha.md", md({ "weaveforge-id": "a-1", "weaveforge-type": "vault_page", title: "Alpha" }, "See [[Beta]] and [[Paper A]] and [[Nowhere]]."));
  await put("proj-a--aaaaaa/notes/beta.md", md({ "weaveforge-id": "a-2", "weaveforge-type": "vault_page", title: "Beta" }, "Back to [[alpha]]."));
  await put("proj-a--aaaaaa/papers/paper-a.md", md({ "weaveforge-id": "pa-1", "weaveforge-type": "paper", title: "Paper A" }));
  await put("proj-a--aaaaaa/papers/paper-a2.md", md({ "weaveforge-id": "pa-2", "weaveforge-type": "paper", title: "Paper A2" }));
  await put("proj-a--aaaaaa/.weaveforge/relations.json", JSON.stringify([{ id: "r1", fromPaper: "pa-2", toPaper: "pa-1", relation: "builds_on" }]));
  await put("proj-a--aaaaaa/.weaveforge/tags.json", JSON.stringify([{ id: "t1", name: "vae" }]));
  await put("proj-b--bbbbbb/notes/beta.md", md({ "weaveforge-id": "b-1", "weaveforge-type": "vault_page", title: "Beta" }, "Project B's beta"));
  await put("proj-b--bbbbbb/papers/paper-b.md", md({ "weaveforge-id": "pb-1", "weaveforge-type": "paper", title: "Paper B" }));
  await put("thesis--e88ade/notes/old.md", md({ "weaveforge-id": "old-1", "weaveforge-type": "vault_page", title: "Stale note" }));
  await put("assets/notes/x.md", md({ "weaveforge-id": "x-1", "weaveforge-type": "vault_page", title: "Asset note" }));
  await mkdir(path.join(root, ".weaveforge"), { recursive: true });
  const session = newVaultSession();
  await adoptRoot(session, root);
  return { session, root };
}

async function callIn(session: VaultSession, name: string, args: Record<string, unknown> = {}) {
  const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const response = await routeMcpRequest(session, request, undefined, true, undefined, async () => PROJECTS);
  const result = response?.result as { isError?: boolean; content: { text: string }[] };
  return { error: !!result.isError, text: result.content.map((c) => c.text).join("\n") };
}

test("list_projects names the app's projects, with folders the app does not know left out", async () => {
  const { session } = await twoProjects();
  const out = await callIn(session, "list_projects");
  assert.match(out.text, /Proj A \| aaaaaa-1 \| proj-a--aaaaaa \| notes 2, papers 2/);
  assert.match(out.text, /Proj B \| bbbbbb-2/);
  assert.match(out.text, /Empty \| cccccc-3/);
  assert.doesNotMatch(out.text, /thesis--e88ade|assets/);
});

test("listing is grouped per project, scoped by project, and skips unknown folders", async () => {
  const { session } = await twoProjects();
  const all = await callIn(session, "list_workspace", { kind: "vault_page" });
  assert.match(all.text, /Proj A/);
  assert.match(all.text, /Proj B/);
  assert.doesNotMatch(all.text, /Stale note|Asset note/);
  const onlyB = await callIn(session, "list_workspace", { kind: "vault_page", project: "Proj B" });
  assert.match(onlyB.text, /b-1/);
  assert.doesNotMatch(onlyB.text, /a-2/);
  assert.equal((await callIn(session, "read_entry", { path: "thesis--e88ade/notes/old.md" })).error, true);
  assert.equal((await callIn(session, "search_workspace", { query: "Stale" })).text.includes("old.md"), false);
});

test("a name used in two projects is settled by naming the project", async () => {
  const { session } = await twoProjects();
  assert.equal((await callIn(session, "get_note", { note: "Beta" })).error, true);
  assert.match((await callIn(session, "get_note", { note: "Beta", project: "proj b" })).text, /Project B's beta/);
});

test("relations and tags are read from each project's own folder", async () => {
  const { session } = await twoProjects();
  assert.match((await callIn(session, "get_relations", { paper: "Paper A2" })).text, /Paper A2 —builds_on→ Paper A/);
  assert.match((await callIn(session, "list_tags", { project: "Proj A" })).text, /vae/);
});

test("a new note is drafted for the project named, even one with no notes yet", async () => {
  const { session, root } = await twoProjects();
  const unnamed = await callIn(session, "suggest_note_create", { title: "T", body: "B" });
  assert.equal(unnamed.error, true);
  assert.match(unnamed.text, /Proj A/);
  assert.equal((await callIn(session, "suggest_note_create", { title: "T", body: "B", project: "Proj B", parent: "Alpha" })).error, true);
  assert.equal((await callIn(session, "suggest_note_create", { title: "T", body: "B", project: "Empty" })).error, false);
  assert.equal((await callIn(session, "suggest_note_edit", { note: "a-2", body: "x" })).error, false);
  const found = await drafts(root);
  assert.equal(found.find((d) => d?.kind === "create_vault_note")?.projectId, "cccccc-3");
  assert.equal(found.find((d) => d?.kind === "edit_vault_note")?.projectId, "aaaaaa-1");
});

test("get_backlinks lists a note's links out and the notes that link to it", async () => {
  const { session } = await twoProjects();
  const alpha = await callIn(session, "get_backlinks", { entry: "Alpha" });
  assert.match(alpha.text, /Beta \(note\)/);
  assert.match(alpha.text, /Paper A \(paper\)/);
  assert.match(alpha.text, /Nowhere \(no such note\)/);
  assert.match(alpha.text, /Links here[\s\S]*Beta \(note\)/);
  assert.doesNotMatch(alpha.text, /a-2|pa-1|Project B/);
  assert.match((await callIn(session, "get_backlinks", { entry: "Paper A" })).text, /Alpha \(note\)[\s\S]*Paper A2 —builds_on→ Paper A/);
});

test("a draft names its project and shows titles, not ids", async () => {
  const { session, root } = await twoProjects();
  const left = await callIn(session, "suggest_relation", { from: "Paper A2", to: "Paper A", relation: "builds_on" });
  assert.match(left.text, /Left in Proj A at/);
  await callIn(session, "suggest_note_create", { title: "T", body: "B", project: "Proj A", parent: "Alpha" });
  const found = await drafts(root);
  const link = found.find((d) => d?.kind === "relation")?.content ?? "";
  assert.match(link, /Paper A2 builds on Paper A[\s\S]*Project: Proj A/);
  assert.doesNotMatch(link, /pa-1|pa-2/);
  const note = found.find((d) => d?.kind === "create_vault_note")?.content ?? "";
  assert.match(note, /Project: Proj A[\s\S]*Parent: Alpha/);
  assert.doesNotMatch(note, /a-1/);
});

test("reads name the project each entry is in", async () => {
  const { session } = await twoProjects();
  assert.match((await callIn(session, "get_note", { note: "Beta", project: "proj b" })).text, /Proj B: /);
  assert.match((await callIn(session, "get_paper", { paper: "Paper A" })).text, /Proj A: /);
  assert.match((await callIn(session, "search_workspace", { query: "beta" })).text, /Proj B: /);
});

test("search with a kind looks in each project's own folder and names each hit", async () => {
  const { session } = await twoProjects();
  const hit = await callIn(session, "search_workspace", { query: "project b's beta", kind: "vault_page" });
  assert.match(hit.text, /Proj B: proj-b--bbbbbb\/notes\/beta\.md \| vault_page \| Beta \| b-1/);
  const papersOnly = await callIn(session, "search_workspace", { query: "paper a", exclude: ["vault_page"] });
  assert.match(papersOnly.text, /paper-a\.md \| paper \| Paper A \| pa-1/);
  assert.doesNotMatch(papersOnly.text, /alpha\.md/);
});

test("get_paper_text past the last page says how many there are", async () => {
  const { session } = await workspace();
  const out = await call(session, "get_paper_text", { ref: "paper-1", fromPage: 40 });
  assert.equal(out.error, true);
  assert.match(out.text, /has 15 pages; fromPage 40 is past the end/);
});

test("every get takes ref, and the older names still work", async () => {
  const { session } = await twoProjects();
  assert.match((await callIn(session, "get_note", { ref: "a-2" })).text, /Back to/);
  assert.match((await callIn(session, "get_note", { note: "a-2" })).text, /Back to/);
  assert.match((await callIn(session, "get_paper", { ref: "Paper B" })).text, /pb-1/);
  assert.match((await callIn(session, "get_backlinks", { ref: "Alpha", project: "Proj A" })).text, /Beta \(note\)/);
});

test("lists and long reads page instead of cutting off", async () => {
  const { session, root } = await twoProjects();
  const first = await callIn(session, "list_workspace", { kind: "paper", limit: 2 });
  assert.match(first.text, /1-2 of 3; pass offset=2 for more/);
  const rest = await callIn(session, "list_workspace", { kind: "paper", offset: 2 });
  assert.match(rest.text, /Paper B/);
  assert.doesNotMatch(rest.text, /Paper A2/);
  const long = `# Top\n${"x".repeat(9_000)}\n## Method\nthe method\n## Results\nnumbers\n`;
  await writeFile(path.join(root, "proj-a--aaaaaa/notes/beta.md"), md({ "weaveforge-id": "a-2", "weaveforge-type": "vault_page", title: "Beta" }, long));
  const head = await callIn(session, "read_entry", { path: "proj-a--aaaaaa/notes/beta.md" });
  assert.match(head.text, /pass offset=7500 for more/);
  assert.match((await callIn(session, "read_entry", { path: "proj-a--aaaaaa/notes/beta.md", offset: 7500 })).text, /the method/);
  const method = await callIn(session, "get_note", { ref: "a-2", heading: "method" });
  assert.match(method.text, /the method/);
  assert.doesNotMatch(method.text, /numbers|xxxx/);
});

test("one tool call walks each folder once; the next call sees edits (37-17)", async () => {
  const { session, root } = await workspace();
  const walked: string[] = [];
  const real = fsp.readdir;
  const spy = mock.method(fsp, "readdir", ((dir: string, ...rest: unknown[]) => {
    walked.push(path.relative(root, String(dir)));
    return (real as (...a: unknown[]) => unknown)(dir, ...rest);
  }) as typeof fsp.readdir);
  try {
    // get_backlinks loads the notes for the lookup and again for the neighbours.
    await call(session, "get_backlinks", { entry: "Ideas" });
    assert.equal(walked.filter((d) => d === "notes").length, 1, walked.join(", "));
  } finally {
    spy.mock.restore();
  }
  await writeFile(path.join(root, "notes/ideas.note.md"), md({ "weaveforge-id": "note-1", "weaveforge-type": "vault_page", title: "Ideas renamed" }));
  assert.match((await call(session, "get_note", { ref: "note-1" })).text, /Ideas renamed/);
});
