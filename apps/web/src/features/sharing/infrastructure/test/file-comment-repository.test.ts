import { before, test } from "node:test";
import assert from "node:assert/strict";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { CommentFilePort } from "../file-comment-repository";
import { FileCommentRepository } from "../file-comment-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";
const UNMAPPED = `${ROOT}/.weaveforge/comments-unmapped.json`;

/** The sidecar path for a paper, derived the same way the repository derives it. */
function paperFile(paperId: string): string {
  const annotations = typedCore().annotationsFilePath(paperId, ROOT);
  return annotations.slice(0, -".annotations.json".length) + ".comments.json";
}

/** In-memory port: a Map of path -> text. */
class MemoryCommentPort implements CommentFilePort {
  readonly files = new Map<string, string>();

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  async listPaperIds(): Promise<string[]> {
    const sample = paperFile("p-1");
    const prefix = sample.slice(0, sample.lastIndexOf("/") + 1);
    const suffix = ".comments.json";
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && path.endsWith(suffix))
      .map((path) => path.slice(prefix.length, -suffix.length));
  }
}

function setup() {
  const port = new MemoryCommentPort();
  return { port, repo: new FileCommentRepository(port, ROOT) };
}

function unmappedRows(port: MemoryCommentPort): Array<Record<string, unknown>> {
  return (JSON.parse(port.files.get(UNMAPPED) ?? "{}") as { rows: Array<Record<string, unknown>> }).rows;
}

test("lists nothing when no file exists", async () => {
  const { repo } = setup();
  assert.deepEqual(await repo.list("paper", "p-1"), []);
  assert.deepEqual(await repo.list("vault_page", "v-1"), []);
});

test("add on a paper writes the sidecar array", async () => {
  const { port, repo } = setup();
  const made = await repo.add({ resourceType: "paper", resourceId: "p-1", body: "nice" });
  assert.equal(made.id, "p-1:0");
  assert.deepEqual(JSON.parse(port.files.get(paperFile("p-1")) ?? "[]"), [
    { body: "nice", created_at: made.createdAt },
  ]);
  assert.deepEqual(await repo.list("paper", "p-1"), [made]);
});

test("add on a vault_page writes the unmapped file with version 1", async () => {
  const { port, repo } = setup();
  const made = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "hi" });
  const file = JSON.parse(port.files.get(UNMAPPED) ?? "{}") as { version: number };
  assert.equal(file.version, 1);
  assert.deepEqual(unmappedRows(port).map((row) => row.id), [made.id]);
  assert.equal(made.resourceType, "vault_page");
});

test("a reply round-trips parent_id and anchor fields", async () => {
  const { repo } = setup();
  const root = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "root" });
  const anchor = { quote: "q", prefix: "pre", suffix: "suf" };
  const reply = await repo.add({
    resourceType: "vault_page",
    resourceId: "v-1",
    body: "reply",
    anchor,
    parentId: root.id,
  });
  const listed = await repo.list("vault_page", "v-1");
  assert.deepEqual(listed.find((c) => c.id === reply.id), { ...reply, anchor });
  assert.equal(reply.parentId, root.id);
});

test("a reply to a reply throws", async () => {
  const { repo } = setup();
  const root = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "root" });
  const reply = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "r", parentId: root.id });
  await assert.rejects(
    repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "rr", parentId: reply.id }),
    /a reply answers a comment on the same resource/,
  );
});

test("setResolved on a reply throws", async () => {
  const { repo } = setup();
  const root = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "root" });
  const reply = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "r", parentId: root.id });
  await assert.rejects(repo.setResolved(reply.id, true), /resolve the thread, not a reply/);
});

test("setResolved on a root sets and clears resolved_at", async () => {
  const { repo } = setup();
  const root = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "root" });
  const resolvedAt = await repo.setResolved(root.id, true);
  assert.equal(typeof resolvedAt, "string");
  assert.equal((await repo.list("vault_page", "v-1"))[0]!.resolvedAt, resolvedAt);
  assert.equal(await repo.setResolved(root.id, false), null);
  assert.equal((await repo.list("vault_page", "v-1"))[0]!.resolvedAt, null);
});

test("remove of a root also removes its replies", async () => {
  const { repo } = setup();
  const root = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "root" });
  await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "r", parentId: root.id });
  const other = await repo.add({ resourceType: "vault_page", resourceId: "v-1", body: "keep" });
  await repo.remove(root.id);
  await repo.remove("missing");
  assert.deepEqual((await repo.list("vault_page", "v-1")).map((c) => c.id), [other.id]);
});

test("a malformed file throws 'comments file is not valid'", async () => {
  const { port, repo } = setup();
  port.files.set(UNMAPPED, "{not json");
  await assert.rejects(repo.list("vault_page", "v-1"), /comments file is not valid/);
  port.files.set(paperFile("p-1"), JSON.stringify([{ body: 1 }]));
  await assert.rejects(repo.list("paper", "p-1"), /comments file is not valid/);
});

test("an unmapped file with version 2 throws", async () => {
  const { port, repo } = setup();
  port.files.set(UNMAPPED, JSON.stringify({ version: 2, rows: [] }));
  await assert.rejects(repo.list("vault_page", "v-1"), /version 2 is not supported/);
});

test("list returns comments oldest first", async () => {
  const { port, repo } = setup();
  port.files.set(
    UNMAPPED,
    JSON.stringify({
      version: 1,
      rows: [
        row("late", "2026-01-02T00:00:00.000Z"),
        row("early", "2026-01-01T00:00:00.000Z"),
      ],
    }),
  );
  assert.deepEqual((await repo.list("vault_page", "v-1")).map((c) => c.id), ["early", "late"]);
});

function row(id: string, createdAt: string): Record<string, unknown> {
  return {
    id,
    resource_type: "vault_page",
    resource_id: "v-1",
    author_id: "",
    body: id,
    created_at: createdAt,
    anchor_quote: null,
    anchor_prefix: null,
    anchor_suffix: null,
    parent_id: null,
    resolved_at: null,
  };
}
