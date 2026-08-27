import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { routeLocalRequest, tokenMatches, type LocalApiRequest } from "../src/local-api";
import { adoptRoot, newVaultSession, readVaultFile, type VaultSession } from "../src/vault-handlers";

const TOKEN = "a".repeat(64);

async function vault(): Promise<VaultSession> {
  const root = await mkdtemp(path.join(tmpdir(), "weaveforge-api-"));
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(path.join(root, "notes", "a.note.md"), "# Kettle\nboiling water\n");
  await writeFile(path.join(root, "notes", "b.note.md"), "nothing about tea\n");
  const session = newVaultSession();
  // Written into before it is adopted, so the folder is "existing" and passes.
  await mkdir(path.join(root, ".weaveforge"), { recursive: true });
  await adoptRoot(session, root);
  return session;
}

function ask(request: Partial<LocalApiRequest>): LocalApiRequest {
  return { method: "GET", url: "/vault/notes/a.note.md", authorization: `Bearer ${TOKEN}`, ...request };
}

test("a request with no token is refused before anything is read", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ authorization: undefined }), TOKEN);
  assert.equal(answer.status, 401);
});

test("a wrong token of the right length is refused", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ authorization: `Bearer ${"b".repeat(64)}` }), TOKEN);
  assert.equal(answer.status, 401);
});

test("no token has been generated, so nothing authenticates", () => {
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, ""), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});

test("a file is served as markdown", async () => {
  const answer = await routeLocalRequest(await vault(), ask({}), TOKEN);
  assert.equal(answer.status, 200);
  assert.equal(answer.contentType, "text/markdown");
  assert.match(answer.body, /boiling water/);
});

test("a missing file is a 404, not a failure", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ url: "/vault/notes/none.md" }), TOKEN);
  assert.equal(answer.status, 404);
});

test("a path that leaves the folder never reaches disk", async () => {
  const answer = await routeLocalRequest(
    await vault(),
    ask({ url: "/vault/..%2F..%2Fsecrets.txt" }),
    TOKEN,
  );
  assert.equal(answer.status, 400);
});

test("a write lands in the folder", async () => {
  const session = await vault();
  const answer = await routeLocalRequest(
    session,
    ask({ method: "PUT", url: "/vault/notes/c.note.md", body: "written from outside" }),
    TOKEN,
  );
  assert.equal(answer.status, 204);
  const read = await readVaultFile(session, "notes/c.note.md");
  assert.equal(read.ok && read.value, "written from outside");
});

test("a delete removes one file", async () => {
  const session = await vault();
  const answer = await routeLocalRequest(session, ask({ method: "DELETE" }), TOKEN);
  assert.equal(answer.status, 204);
  const read = await readVaultFile(session, "notes/a.note.md");
  assert.equal(read.ok && read.value, null);
});

test("a directory lists what is in it, marking the directories", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ url: "/vault/" }), TOKEN);
  assert.equal(answer.status, 200);
  const files = (JSON.parse(answer.body) as { files: string[] }).files;
  assert.ok(files.includes("notes/"), files.join(","));
});

test("a directory is not written to", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ method: "PUT", url: "/vault/notes/" }), TOKEN);
  assert.equal(answer.status, 405);
});

test("search reports the files that match and the lines that did", async () => {
  const answer = await routeLocalRequest(
    await vault(),
    ask({ method: "POST", url: "/search/simple/?query=kettle" }),
    TOKEN,
  );
  assert.equal(answer.status, 200);
  const results = JSON.parse(answer.body) as { filename: string; matches: { context: string }[] }[];
  assert.deepEqual(
    results.map((r) => r.filename),
    ["notes/a.note.md"],
  );
  assert.match(results[0]!.matches[0]!.context, /Kettle/);
});

test("an unserved route says so rather than guessing", async () => {
  const answer = await routeLocalRequest(await vault(), ask({ url: "/active/" }), TOKEN);
  assert.equal(answer.status, 404);
});

// ------------------------------------------------------------------------ MCP

async function mcp(session: VaultSession, method: string, params?: unknown) {
  const answer = await routeLocalRequest(
    session,
    ask({ method: "POST", url: "/mcp", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
    TOKEN,
  );
  return { status: answer.status, body: answer.body ? JSON.parse(answer.body) : null };
}

test("MCP is behind the same token as everything else", async () => {
  const answer = await routeLocalRequest(
    await vault(),
    ask({ method: "POST", url: "/mcp", authorization: undefined, body: "{}" }),
    TOKEN,
  );
  assert.equal(answer.status, 401);
});

test("initialize answers with the workspace server", async () => {
  const { body } = await mcp(await vault(), "initialize");
  assert.equal(body.result.serverInfo.name, "weaveforge-workspace");
});

test("the tool list names what the folder can be asked", async () => {
  const { body } = await mcp(await vault(), "tools/list");
  assert.deepEqual(
    (body.result.tools as { name: string }[]).map((tool) => tool.name),
    ["search_workspace", "list_workspace", "read_entry"],
  );
});

test("a search comes back fenced and told to be treated as data", async () => {
  const { body } = await mcp(await vault(), "tools/call", {
    name: "search_workspace",
    arguments: { query: "kettle" },
  });
  const text = body.result.content[0].text as string;
  assert.match(text, /quoted material/);
  assert.match(text, /# Kettle/);
  assert.equal(typeof body.result._meta.nonce, "string");
});

test("a kind that keeps nothing yet searches nothing, rather than everything", async () => {
  const { body } = await mcp(await vault(), "tools/call", {
    name: "search_workspace",
    arguments: { query: "kettle", kind: "paper" },
  });
  assert.doesNotMatch(body.result.content[0].text as string, /# Kettle/);
});

test("reading a path that leaves the folder is a tool error, not a file", async () => {
  const { body } = await mcp(await vault(), "tools/call", {
    name: "read_entry",
    arguments: { path: "../../secrets.txt" },
  });
  assert.equal(body.result.isError, true);
});

test("an unknown tool is refused by name", async () => {
  const { body } = await mcp(await vault(), "tools/call", { name: "delete_everything" });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text as string, /delete_everything/);
});

test("a notification is answered with nothing to answer", async () => {
  const answer = await routeLocalRequest(
    await vault(),
    ask({
      method: "POST",
      url: "/mcp",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }),
    TOKEN,
  );
  assert.equal(answer.status, 202);
  assert.equal(answer.body, "");
});
