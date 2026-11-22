import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { AiAuditRecord } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileAiAuditStore } from "../file-ai-audit-store";

before(loadTestCore);

function record(over: Partial<AiAuditRecord> = {}): AiAuditRecord {
  return {
    id: crypto.randomUUID(),
    proposalId: "p-1",
    action: "accepted",
    createdAt: "2026-06-24T10:00:00.000Z",
    ...over,
  };
}

test("two saves in one month append two parseable lines to one .jsonl", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FileAiAuditStore(fs);
  const a = record();
  const b = record({ action: "rejected", createdAt: "2026-06-25T10:00:00.000Z" });
  await store.save(a);
  await store.save(b);

  const paths: string[] = [];
  for await (const e of fs.walk(".weaveforge/ai/audit")) if (e.kind === "file") paths.push(e.path);
  assert.equal(paths.length, 1);
  assert.match(paths[0] ?? "", /^\.weaveforge\/ai\/audit\/2026-06\/.+\.jsonl$/);

  const lines = (await fs.readText(paths[0] ?? "")).split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [a, b]);
});
