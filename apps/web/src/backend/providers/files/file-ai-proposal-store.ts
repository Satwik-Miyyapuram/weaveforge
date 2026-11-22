/**
 * AI write proposals as `.weaveforge/proposals/<id>.json` files (0.9.7). One
 * file per proposal; a file that does not parse is skipped, never fatal.
 */
import type { AiWriteProposal, IAiProposalStore, IWorkspaceFs } from "@weaveforge/core";

const DIR = ".weaveforge/proposals";

/** Key names that name a secret; mirrors `is_secret_key` in crates/wf-core/src/settings/secret_guard.rs. */
const SECRET_KEY_ENDINGS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "accesskey",
  "privatekey",
  "cookie",
  "credential",
  "credentials",
  "bearer",
  "scholarkey",
  "secretkey",
  "signingkey",
  "authkey",
];

function isSecretKey(key: string): boolean {
  const normal = key.toLowerCase().replace(/[-_]/g, "");
  return SECRET_KEY_ENDINGS.some((ending) => normal.endsWith(ending));
}

/** The dotted path of the first secret-looking key, or null when there is none. */
function findSecretKey(value: unknown, at: string): string | null {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = findSecretKey(item, `${at}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const here = at ? `${at}.${key}` : key;
      if (isSecretKey(key)) return here;
      const found = findSecretKey(item, here);
      if (found) return found;
    }
  }
  return null;
}

export class FileAiProposalStore implements IAiProposalStore {
  constructor(private readonly fs: IWorkspaceFs) {}

  async save(proposal: AiWriteProposal): Promise<void> {
    const secret = findSecretKey(proposal, "");
    if (secret) {
      throw new Error(`Not saved: this would put a secret (${secret}) in a workspace file that syncs.`);
    }
    await this.fs.writeFile(this.pathOf(proposal.id), `${JSON.stringify(proposal, null, 2)}\n`);
  }

  getById(id: string): Promise<AiWriteProposal | null> {
    return this.read(this.pathOf(id));
  }

  async listPending(): Promise<AiWriteProposal[]> {
    const pending: AiWriteProposal[] = [];
    for (const entry of await this.fs.list(DIR)) {
      if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
      const proposal = await this.read(entry.path);
      if (proposal?.status === "pending") pending.push(proposal);
    }
    return pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claimPending(id: string): Promise<boolean> {
    // Single device: read-then-write is the atomic step.
    const current = await this.getById(id);
    if (current?.status !== "pending") return false;
    await this.save({ ...current, status: "executing" });
    return true;
  }

  private pathOf(id: string): string {
    return `${DIR}/${id}.json`;
  }

  private async read(path: string): Promise<AiWriteProposal | null> {
    if (!(await this.fs.stat(path))) return null;
    try {
      const parsed: unknown = JSON.parse(await this.fs.readText(path));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AiWriteProposal) : null;
    } catch {
      return null;
    }
  }
}
