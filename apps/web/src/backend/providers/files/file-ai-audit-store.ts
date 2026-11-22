/**
 * AI audit records appended as JSON lines under `.weaveforge/ai/audit/<YYYY-MM>/`
 * (0.9.7). Mirrors `ai_audit_chunk_path` in crates/wf-core/src/sync/folder_layout.rs.
 */
import type { AiAuditRecord, IAiAuditStore, IWorkspaceFs } from "@weaveforge/core";

export class FileAiAuditStore implements IAiAuditStore {
  /** One batch per store instance, so a process appends to one file per month. */
  private readonly batchId = crypto.randomUUID();

  constructor(private readonly fs: IWorkspaceFs) {}

  async save(record: AiAuditRecord): Promise<void> {
    const path = `.weaveforge/ai/audit/${record.createdAt.slice(0, 7)}/${this.batchId}.jsonl`;
    const existing = (await this.fs.stat(path)) ? await this.fs.readText(path) : "";
    await this.fs.writeFile(path, `${existing}${JSON.stringify(record)}\n`);
  }

  /** Accepted actions across every audit file in the folder (rejected and conflicted ones do not count). */
  async countAccepted(): Promise<number> {
    let count = 0;
    for await (const entry of this.fs.walk(".weaveforge/ai/audit")) {
      if (entry.kind !== "file" || !entry.path.endsWith(".jsonl")) continue;
      for (const line of (await this.fs.readText(entry.path)).split("\n")) {
        if (line.trim() && (JSON.parse(line) as AiAuditRecord).action === "accepted") count++;
      }
    }
    return count;
  }
}
