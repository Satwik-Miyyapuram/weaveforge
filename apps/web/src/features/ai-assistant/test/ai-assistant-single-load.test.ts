/**
 * One workspace load per AI read (B59, 10-06).
 *
 * A search or excerpt read every repository once for the text, then again to
 * work out which sources auto-inclusion adds. Same rows, read twice.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AiAssistantFacade } from "@/container/facades";
import type { AiAccessSettings, Paper } from "@weaveforge/core";

const PAPER = {
  id: "paper-1", title: "Attention", authors: ["A"], year: 2017, venue: "NeurIPS",
  abstract: "An abstract about attention.", status: "reading", tags: [], summary: "note body",
} as unknown as Paper;
const LATER = { ...PAPER, id: "paper-2", title: "Attention again", summary: "" } as unknown as Paper;

const base: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"],
  proposalKinds: [],
};

function counted(papers: Paper[]) {
  const calls: Record<string, number> = {};
  const repo = (name: string, rows: () => unknown[]) => ({
    async list() {
      calls[name] = (calls[name] ?? 0) + 1;
      return rows();
    },
  });
  const ai = new AiAssistantFacade({
    papers: repo("papers", () => papers) as never,
    vaultPages: repo("vaultPages", () => []) as never,
    readingLists: repo("readingLists", () => []) as never,
    logEntries: repo("logEntries", () => []) as never,
    experiments: repo("experiments", () => []) as never,
    milestones: repo("milestones", () => []) as never,
    proposals: { async save() {}, async getById() { return null; }, async listPending() { return []; } } as never,
    isEncryptionUnlocked: () => true,
    newId: () => "session-1",
    now: () => "2026-01-02T00:00:00.000Z",
    allowedTools: ["search_workspace", "get_source_excerpt", "get_workspace_outline"],
  });
  return { ai, calls, reset: () => Object.keys(calls).forEach((k) => delete calls[k]) };
}

async function started(papers: Paper[]) {
  const h = counted(papers);
  const options = await h.ai.listSourceOptions();
  const source = options.find((o) => o.resourceType === "paper")!;
  const active = await h.ai.startSession({ workspaceName: "w", sourceIds: [source.sourceId], settings: base, proposalCapabilities: [] });
  h.reset();
  return { ...h, sessionId: active.grant.id, sourceId: source.sourceId };
}

const once = { papers: 1, vaultPages: 1, readingLists: 1, logEntries: 1, experiments: 1, milestones: 1 };

test("a search loads each repository once", async () => {
  const s = await started([PAPER]);
  await s.ai.searchWorkspace({ sessionId: s.sessionId, settings: base, query: "attention" });
  assert.deepEqual(s.calls, once);
});

test("an excerpt read loads each repository once", async () => {
  const s = await started([PAPER]);
  assert.ok(await s.ai.getSourceExcerpt({ sessionId: s.sessionId, settings: base, sourceId: s.sourceId }));
  assert.deepEqual(s.calls, once);
});

test("the outline still loads each repository once", async () => {
  const s = await started([PAPER]);
  await s.ai.getWorkspaceOutline({ sessionId: s.sessionId, settings: base });
  assert.deepEqual(s.calls, once);
});

test("auto-included sources still come from the same single load", async () => {
  const papers = [PAPER];
  const s = await started(papers);
  papers.push(LATER);
  const settings: AiAccessSettings = { ...base, autoIncludeNewSourceCategories: ["paper_metadata"] };
  const results = await s.ai.searchWorkspace({ sessionId: s.sessionId, settings, query: "again" });
  assert.ok(results.some((r) => r.source.resourceId === "paper-2"), "a paper added after the grant is searchable");
  assert.deepEqual(s.calls, once);
});

test("without auto-inclusion a later paper stays out", async () => {
  const papers = [PAPER];
  const s = await started(papers);
  papers.push(LATER);
  const results = await s.ai.searchWorkspace({ sessionId: s.sessionId, settings: base, query: "again" });
  assert.ok(!results.some((r) => r.source.resourceId === "paper-2"));
});
