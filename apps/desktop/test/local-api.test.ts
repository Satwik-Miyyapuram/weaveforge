import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { routeLocalRequest, tokenMatches, type LocalApiGrant, type LocalApiRequest } from "../src/local-api";
import { hashLocalApiToken, makeLocalApiToken, parseLocalApiTokens } from "../src/local-api-server";
import {
  adoptRoot,
  newVaultSession,
  readVaultFile,
  writeVaultFile,
  type VaultSession,
} from "../src/vault-handlers";

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
  const names = (body.result.tools as { name: string }[]).map((tool) => tool.name);
  for (const name of ["search_workspace", "list_workspace", "read_entry", "get_note", "get_paper_text", "suggest_note_edit", "suggest_report_edit"]) {
    assert.ok(names.includes(name), name);
  }
  // Every write is a suggestion; the old propose_ names stay callable but unlisted.
  assert.deepEqual(names.filter((name) => !/^(search|list|read|get)_/.test(name) && !name.startsWith("suggest_")), []);
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

/** A vault with a report, for the tools that name a section rather than a path. */
async function vaultWithReport(sections: readonly string[]): Promise<VaultSession> {
  const session = await vault();
  for (const name of sections) {
    const written = await writeVaultFile(session, `report/${name}.md`, `# ${name}\nsome prose\n`);
    assert.equal(written.ok, true);
  }
  return session;
}

test("a section is read by a word from its name", async () => {
  const { body } = await mcp(await vaultWithReport(["01-methods", "02-results"]), "tools/call", {
    name: "get_report_section",
    arguments: { section: "results" },
  });
  assert.notEqual(body.result.isError, true);
  assert.match(body.result.content[0].text as string, /02-results/);
});

test("a name that matches two sections is a question, not a coin flip", async () => {
  const { body } = await mcp(await vaultWithReport(["01-methods", "02-methods-appendix"]), "tools/call", {
    name: "get_report_section",
    arguments: { section: "methods" },
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text as string, /matches 2 of them/);
});

test("a proposal lands beside the report, never in it", async () => {
  const session = await vault();
  const methods = "---\nweaveforge-id: sec-1\nweaveforge-type: report_section\ntitle: 01-methods\n---\n# 01-methods\nsome prose\n";
  assert.equal((await writeVaultFile(session, "report/01-methods.md", methods)).ok, true);
  const { body } = await mcp(session, "tools/call", {
    name: "propose_report_edit",
    arguments: { section: "methods", proposal: "A shorter method.", rationale: "It repeats itself." },
  });
  assert.notEqual(body.result.isError, true);

  // The section itself is untouched; the suggestion waits in its own folder.
  const section = await readVaultFile(session, "report/01-methods.md");
  assert.equal(section.ok && section.value, methods);

  const at = /Left at (\S+)\./.exec(body.result.content[0].text as string)?.[1] ?? "";
  assert.match(at, /^\.weaveforge\/proposals\//);
  const proposal = await readVaultFile(session, at);
  assert.match(String(proposal.ok && proposal.value), /A shorter method\./);
});

test("a proposal with nothing to propose is refused", async () => {
  const { body } = await mcp(await vaultWithReport(["01-methods"]), "tools/call", {
    name: "propose_report_edit",
    arguments: { section: "methods", proposal: "   " },
  });
  assert.equal(body.result.isError, true);
});

test("a ranker reorders what the word search found", async () => {
  const session = await vault();
  const ranked = await routeLocalRequest(
    session,
    ask({
      method: "POST",
      url: "/mcp",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_workspace", arguments: { query: "e" } },
      }),
    }),
    TOKEN,
    undefined,
    async () => ["notes/b.note.md", "notes/a.note.md"],
  );
  const text = JSON.parse(ranked.body).result.content[0].text as string;
  assert.ok(text.indexOf("notes/b.note.md") < text.indexOf("notes/a.note.md"));
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

function grant(permissions: LocalApiGrant["permissions"], expiresAt: string | null = null): LocalApiGrant[] {
  return [{ hash: hashLocalApiToken(TOKEN), permissions, expiresAt }];
}

test("experiment_tracking_setup is offered only to a token that may log runs, and never shows the token", async () => {
  const home = { apiUrl: "http://127.0.0.1:27123", tokenFile: "/home/me/.weaveforge/mcp.json" };
  const query = async (sql: string) =>
    ({ ok: true as const, value: sql.includes("from projects") ? [{ name: "Thesis" }, { name: 'Lab "B"' }] : [] });
  const rpc = (body: unknown, grants: LocalApiGrant[]) =>
    routeLocalRequest(vault0, ask({ method: "POST", url: "/mcp", body: JSON.stringify(body) }), grants, query, undefined, undefined, home);
  const vault0 = await vault();
  const names = async (grants: LocalApiGrant[]) =>
    (JSON.parse((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, grants)).body).result.tools as { name: string }[]).map((t) => t.name);

  assert.ok((await names(grant(["mcp:read", "mcp:suggest", "experiments"]))).includes("experiment_tracking_setup"));
  assert.ok(!(await names(grant(["mcp:read", "mcp:suggest"]))).includes("experiment_tracking_setup"));

  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "experiment_tracking_setup", arguments: {} } };
  const text = JSON.parse((await rpc(call, grant(["mcp:read", "experiments"]))).body).result.content[0].text as string;
  assert.match(text, /pip install weaveforge/);
  assert.match(text, /"Thesis", "Lab \\"B\\""/);
  assert.match(text, /\/home\/me\/\.weaveforge\/mcp\.json/);
  assert.match(text, /set nothing else/);
  assert.ok(!text.includes(TOKEN));

  const refused = JSON.parse((await rpc(call, grant(["mcp:read"]))).body).result;
  assert.equal(refused.isError, true);
});

test("a token without a permission gets 403 for that surface", async () => {
  const only = grant(["experiments"]);
  for (const url of ["/vault/notes/a.note.md", "/search/simple/?query=tea"]) {
    const answer = await routeLocalRequest(await vault(), ask({ url }), only);
    assert.equal(answer.status, 403);
  }
  const mcp = await routeLocalRequest(
    await vault(),
    ask({ method: "POST", url: "/mcp", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }),
    only,
  );
  assert.equal(mcp.status, 403);
});

test("Notes read does not allow writes", async () => {
  const read = grant(["rest:read"]);
  assert.equal((await routeLocalRequest(await vault(), ask({}), read)).status, 200);
  const put = await routeLocalRequest(await vault(), ask({ method: "PUT", body: "x" }), read);
  assert.equal(put.status, 403);
});

test("an expired token is refused", async () => {
  const answer = await routeLocalRequest(await vault(), ask({}), grant(["rest:read"], "2000-01-01T00:00:00Z"));
  assert.equal(answer.status, 401);
});

test("MCP read without drafts hides the suggest tools", async () => {
  const answer = await routeLocalRequest(
    await vault(),
    ask({ method: "POST", url: "/mcp", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }),
    grant(["mcp:read"]),
  );
  assert.equal(answer.status, 200);
  const names: string[] = JSON.parse(answer.body).result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.length > 0);
  assert.ok(!names.some((n) => n.startsWith("suggest_")));
});

test("stored tokens keep only a hash; a legacy plaintext token migrates with every permission", () => {
  const { record, token } = makeLocalApiToken("x", ["experiments"], null);
  assert.equal(record.hash, hashLocalApiToken(token));
  assert.ok(!JSON.stringify(record).includes(token));
  const legacy = parseLocalApiTokens(TOKEN);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.records[0]?.permissions.length, 5);
  assert.deepEqual(parseLocalApiTokens(JSON.stringify([record])).records, [record]);
});
