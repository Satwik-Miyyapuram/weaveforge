/**
 * Turns a `[[link]]` in a file into the paper or note it names, and back (0.9.7 L3).
 * Files name each other by link, never by id; the app still asks by id.
 *
 * A paper is a `.paper.md` under the papers folder (id from its frontmatter, or its
 * path when it has none); a note is a `.note.md` under the notes folder with a
 * `weaveforge-id`. Each one's link is `[[file name minus .md]]`. Links match the way
 * the vault resolves them (`listItemKey`: case, alias and `.md` ignored), and a link
 * with a folder (`[[papers/x.paper]]`) matches the file of that name.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { ProjectRoot } from "./file-entity-store";

export type LinkTarget = { paperId: string } | { vaultPageId: string };

interface Entry {
  target: LinkTarget;
  /** The `listItemKey` of the file's own link. */
  key: string;
  link: string;
}

function idOf(target: LinkTarget): string {
  return "paperId" in target ? target.paperId : target.vaultPageId;
}

export class LinkIndex {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly root: ProjectRoot,
  ) {}

  /** The paper or note `link` points at, or null when none does. */
  async resolve(link: string): Promise<LinkTarget | null> {
    const key = readyCore().listItemKey(link);
    if (key === undefined) return null;
    const entries = await this.entries();
    const hit = entries.find((e) => e.key === key) ?? entries.find((e) => key.endsWith(`/${e.key}`));
    return hit?.target ?? null;
  }

  /** The link to the paper or note, or null when it has no file. */
  async linkFor(target: LinkTarget): Promise<string | null> {
    const kind = "paperId" in target ? "paperId" : "vaultPageId";
    const id = idOf(target);
    return (await this.entries()).find((e) => kind in e.target && idOf(e.target) === id)?.link ?? null;
  }

  private async entries(): Promise<Entry[]> {
    return [...(await this.scan("paper", ".paper.md")), ...(await this.scan("vault_page", ".note.md"))];
  }

  private async scan(kind: "paper" | "vault_page", suffix: string): Promise<Entry[]> {
    const core = readyCore();
    const dir = core.entityDir(kind, this.root());
    const out: Entry[] = [];
    if (!(await this.fs.stat(dir))) return out;
    for await (const entry of this.fs.walk(dir)) {
      if (entry.kind !== "file" || !entry.path.endsWith(suffix)) continue;
      let id: string | undefined;
      try {
        const text = await this.fs.readText(entry.path);
        if (kind === "paper") {
          const raw: unknown = core.paperRowFromFile(text).id;
          id = typeof raw === "string" && raw ? raw : entry.path;
        } else {
          id = core.frontmatterString(core.readFrontmatter(text).frontmatter, "weaveforge-id") ?? undefined;
        }
      } catch {
        continue;
      }
      if (!id) continue;
      const link = `[[${entry.path.slice(entry.path.lastIndexOf("/") + 1, -".md".length)}]]`;
      const key = core.listItemKey(link);
      if (key === undefined) continue;
      out.push({ target: kind === "paper" ? { paperId: id } : { vaultPageId: id }, key, link });
    }
    return out;
  }
}
