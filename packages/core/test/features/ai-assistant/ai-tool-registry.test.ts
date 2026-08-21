import assert from "node:assert/strict";
import { test } from "node:test";
import { AiToolRegistry } from "../../../src/index.js";

test("tool registry exposes stable handlers for UI and future MCP transport", async () => {
  const registry = new AiToolRegistry();
  registry.register({
    name: "search_workspace",
    description: "Search authorized workspace sources",
    inputSchema: { type: "object" },
    async handle(input: { query: string }, context) {
      return { query: input.query, requestId: context.requestId };
    },
  });
  const tool = registry.get("search_workspace");
  assert.ok(tool);
  assert.equal((await tool.handle({ query: "graph" }, { sessionId: "s", userId: "u", requestId: "r" })).requestId, "r");
  assert.equal(registry.list().length, 1);
  assert.throws(() => registry.register({
    name: "search_workspace", description: "duplicate", inputSchema: {}, async handle() { return null; },
  }));
});
