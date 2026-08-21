import assert from "node:assert/strict";
import test from "node:test";
import { AI_TOOL_NAMES } from "@weaveforge/core";
import type { AiAccessSettings, AiRetrievalDocument } from "@weaveforge/core";
import { dispatchMcpTool } from "../mcp-browser-relay";
import type { McpToolHost } from "../mcp-browser-relay";

const settings = {
  enabled: true, disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"], proposalKinds: [],
} as AiAccessSettings;

const EXCERPT = "Transformers replace recurrence with attention entirely.";

/** Source ids are `type|id`, so a test can ask for any resource type it needs. */
function excerptFor(sourceId: string): AiRetrievalDocument | null {
  const [resourceType, resourceId] = sourceId.split("|");
  if (!resourceType || !resourceId) return null;
  return {
    text: EXCERPT,
    source: {
      sourceId, resourceType, resourceId,
      label: "Attention is all you need", href: `/papers/${resourceId}`,
    },
  } as AiRetrievalDocument;
}

interface Recorded {
  draft?: Parameters<McpToolHost["proposeDraft"]>[0];
  zotero?: Parameters<McpToolHost["proposeZoteroImport"]>[0];
}

function host(recorded: Recorded = {}): McpToolHost {
  return {
    async searchWorkspace(input) { return [{ source: { sourceId: `hit:${input.query}` }, text: EXCERPT }] as never; },
    async getSourceExcerpt(input) { return excerptFor(input.sourceId) as never; },
    async getWorkspaceOutline() { return [{ sourceId: "paper|paper-1", resourceType: "paper", resourceId: "paper-1" }] as never; },
    async proposeDraft(input) { recorded.draft = input; return { status: "requires_review", proposalId: "p-1", kind: input.kind, message: "" }; },
    async proposeZoteroImport(input) { recorded.zotero = input; return { status: "requires_review", proposalId: "p-2", kind: "zotero_import", message: "" }; },
  } as McpToolHost;
}

const call = (tool: string, args: Record<string, unknown> = {}, recorded?: Recorded) =>
  dispatchMcpTool(host(recorded), "session-1", settings, { tool, arguments: args });

/** Minimal arguments that satisfy each tool, so the sweep below can reach them all. */
const HAPPY_ARGS: Record<string, Record<string, unknown>> = {
  search_workspace: { query: "attention" },
  get_source_excerpt: { sourceId: "paper|paper-1" },
  get_workspace_outline: {},
  propose_append_paper_note: { paperId: "paper-1", addition: "A remark." },
  propose_create_vault_note: { title: "Note", body: "Body" },
  propose_create_log_entry: { body: "Did a thing." },
  propose_paper_update: { paperId: "paper-1", status: "read" },
  propose_paper_field_value: { paperId: "paper-1", fieldId: "field-1", value: "yes", sourceId: "paper|paper-1", quoteExact: "attention entirely" },
  propose_reading_list_change: { listId: "list-1", paperId: "paper-1" },
  propose_relation: { fromPaper: "paper-1", toPaper: "paper-2", relation: "cites" },
  propose_zotero_import: { title: "Attention is all you need" },
  propose_milestone_follow_up: { title: "Write intro" },
  propose_experiment_follow_up: { name: "Ablation" },
};

test("every advertised tool name is dispatchable, and nothing else is", async () => {
  assert.deepEqual(Object.keys(HAPPY_ARGS).sort(), [...AI_TOOL_NAMES].sort(), "the fixture must track AI_TOOL_NAMES");
  for (const name of AI_TOOL_NAMES) {
    await assert.doesNotReject(() => call(name, HAPPY_ARGS[name]), `${name} should dispatch`);
  }
  await assert.rejects(() => call("delete_everything"), /not enabled for this deployment/);
  await assert.rejects(() => dispatchMcpTool(host(), "s", settings, {}), /not enabled for this deployment/);
});

test("each proposal tool drafts its own kind, and never writes directly", async () => {
  const kinds: Record<string, string> = {
    propose_append_paper_note: "append_paper_note", propose_create_vault_note: "create_vault_note",
    propose_create_log_entry: "create_log_entry", propose_paper_update: "paper_update",
    propose_paper_field_value: "paper_field_value", propose_reading_list_change: "reading_list_change",
    propose_relation: "relation", propose_milestone_follow_up: "milestone_follow_up",
    propose_experiment_follow_up: "experiment_follow_up",
  };
  for (const [tool, kind] of Object.entries(kinds)) {
    const recorded: Recorded = {};
    const result = await call(tool, HAPPY_ARGS[tool]!, recorded) as { status: string };
    assert.equal(result.status, "requires_review", `${tool} must go to review`);
    assert.equal(recorded.draft?.kind, kind);
    assert.equal(recorded.draft?.tool, tool);
  }
  const recorded: Recorded = {};
  await call("propose_zotero_import", HAPPY_ARGS.propose_zotero_import!, recorded);
  assert.equal(recorded.zotero?.title, "Attention is all you need");
});

test("a missing required argument is refused before any draft is written", async () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["propose_append_paper_note", { paperId: "paper-1" }, /addition is required/],
    ["propose_append_paper_note", { addition: "x" }, /paperId is required/],
    ["propose_create_vault_note", { title: "t" }, /body is required/],
    ["propose_create_log_entry", {}, /body is required/],
    ["propose_relation", { fromPaper: "a", toPaper: "b" }, /relation is required/],
    ["propose_paper_field_value", { paperId: "p", fieldId: "f", value: "v", sourceId: "paper|p" }, /quoteExact is required/],
    ["propose_experiment_follow_up", {}, /name is required/],
  ];
  for (const [tool, args, message] of cases) {
    const recorded: Recorded = {};
    await assert.rejects(() => call(tool, args, recorded), message, `${tool} ${JSON.stringify(args)}`);
    assert.equal(recorded.draft, undefined, `${tool} must not draft when arguments are refused`);
  }
});

test("a field value must be a string, a number, or a non-empty list of strings", async () => {
  const base = HAPPY_ARGS.propose_paper_field_value!;
  for (const value of [null, {}, [], ["  "], [1], true, ""]) {
    await assert.rejects(() => call("propose_paper_field_value", { ...base, value }), /value must be/, JSON.stringify(value));
  }
  const recorded: Recorded = {};
  await call("propose_paper_field_value", { ...base, value: [" a ", "b", " "] }, recorded);
  assert.deepEqual(recorded.draft?.payload.value, ["a", "b"], "list values are trimmed and empty entries dropped");
});

test("evidence is checked against the real excerpt, not taken on the model's word", async () => {
  const base = HAPPY_ARGS.propose_paper_field_value!;
  // A quote the source does not contain.
  await assert.rejects(() => call("propose_paper_field_value", { ...base, quoteExact: "recurrence is essential" }), /not found in the source excerpt/);
  // A source that resolves to a different paper than the one being edited.
  await assert.rejects(() => call("propose_paper_field_value", { ...base, sourceId: "paper|paper-9" }), /different paper than paperId/);
  // A source that is not paper-scoped at all.
  await assert.rejects(() => call("propose_paper_field_value", { ...base, sourceId: "vault_page|page-1" }), /must resolve to a paper-scoped source/);
  // A source id that resolves to nothing.
  await assert.rejects(() => call("propose_paper_field_value", { ...base, sourceId: "unresolvable" }), /no excerpt could be resolved/);

  const recorded: Recorded = {};
  await call("propose_paper_field_value", { ...base, page: 3, quotePrefix: "with ", quoteSuffix: "." }, recorded);
  const evidence = recorded.draft?.evidence?.[0];
  assert.equal(evidence?.paperId, "paper-1");
  assert.equal(evidence?.excerpt, EXCERPT);
  assert.equal(evidence?.page, 3);
  assert.deepEqual(evidence?.locus?.quote, { type: "TextQuoteSelector", exact: "attention entirely", prefix: "with ", suffix: "." });
});

test("a zotero annotation cites the paper it hangs off, not its own composite id", async () => {
  const recorded: Recorded = {};
  await call("propose_append_paper_note", {
    paperId: "paper-1", addition: "A remark.", sourceId: "zotero_annotation|paper-1:ABCD", quoteExact: "attention entirely",
  }, recorded);
  assert.equal(recorded.draft?.evidence?.[0]?.paperId, "paper-1");
});

test("append-paper-note takes evidence without a quote, and refuses one that does not match", async () => {
  const recorded: Recorded = {};
  await call("propose_append_paper_note", { paperId: "paper-1", addition: "A remark.", sourceId: "paper|paper-1" }, recorded);
  assert.equal(recorded.draft?.evidence?.[0]?.locus, undefined, "no quote means no locus, not an empty one");
  assert.equal(recorded.draft?.evidence?.[0]?.excerpt, EXCERPT);

  await assert.rejects(
    () => call("propose_append_paper_note", { paperId: "paper-1", addition: "x", sourceId: "paper|paper-1", quoteExact: "not in there" }),
    /not found in the source excerpt/,
  );

  // No sourceId at all is allowed: the note simply carries no evidence.
  const bare: Recorded = {};
  await call("propose_append_paper_note", { paperId: "paper-1", addition: "x" }, bare);
  assert.equal(bare.draft?.evidence, undefined);
});

test("an over-long quote affix is truncated rather than passed through", async () => {
  const recorded: Recorded = {};
  await call("propose_paper_field_value", { ...HAPPY_ARGS.propose_paper_field_value!, quotePrefix: "x".repeat(5_000) }, recorded);
  assert.equal((recorded.draft?.evidence?.[0]?.locus?.quote as { prefix: string }).prefix.length, 2_000);
});
