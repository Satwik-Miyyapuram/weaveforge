import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpToolNames, workspaceMcpTools } from "../repo-stats.mjs";

/** The assistant's tool list must come from the Rust desktop server, not the retired relay TypeScript. */
describe("mcpToolNames", () => {
  const { reads, proposals, workspace } = mcpToolNames();

  it("returns non-empty reads and proposals", () => {
    assert.ok(reads.length > 0, "no read tools");
    assert.ok(proposals.length > 0, "no proposal tools");
  });

  it("names every proposal suggest_ and no read suggest_", () => {
    assert.ok(proposals.every((name) => name.startsWith("suggest_")));
    assert.ok(reads.every((name) => !name.startsWith("suggest_")));
  });

  it("includes suggest_report_edit among the proposals", () => {
    assert.ok(proposals.includes("suggest_report_edit"));
  });

  it("gives every declared tool a description, as check:mcp-plugin requires", () => {
    const tools = workspaceMcpTools();
    assert.equal(tools.length, workspace.length);
    assert.ok(tools.every((tool) => tool.description.length > 0), "a tool has no description");
  });

  it("lists every read and proposal in the workspace server", () => {
    for (const name of [...reads, ...proposals]) {
      assert.ok(workspace.includes(name), `${name} missing from workspace`);
    }
  });
});
