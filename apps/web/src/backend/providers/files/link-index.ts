/**
 * Turns a `[[link]]` in a file into the paper or note it names, and back (0.9.7 L3).
 * Files name each other by link, never by id; the app still asks by id.
 *
 * A paper is a `.paper.md` under the papers folder (id from its frontmatter, or its
 * path when it has none); a note is a `.note.md` under the notes folder with a
 * `weaveforge-id`. Each one's link is `[[file name minus .md]]`, or its workspace path
 * minus `.md` when another paper or note has the same name. Links match the way the
 * vault resolves them (`listItemKey`: case, alias and `.md` ignored); a link with a
 * folder (`[[papers/x.paper]]`) matches the file whose path ends with it. A link that
 * fits more than one file resolves to nothing rather than to a guess.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { ProjectRoot } from "./file-entity-store";

export type LinkTarget = { paperId: string } | { vaultPageId: string };

interface Entry {
  target: LinkTarget;
  /** The `listItemKey` of the file's bare link. */
  key: string;
  /** The `listItemKey` of the file's workspace path link. */
  pathKey: string;
  /** The file's workspace path minus `.md`. */
  path: string;
}

function idOf(target: LinkTarget): string {
  return "paperId" in target ? target.paperId : target.vaultPageId;
}

/** One scan of the folders; every lookup on it is free. */
export class Links {
  constructor(private readonly entries: readonly Entry[]) {}

  /** The paper or note `link` points at, or null when none or several do. */
  resolve(link: string): LinkTarget | null {
    const key = readyCore().listItemKey(link);
    if (key === undefined) return null;
    const hits = this.entries.filter(
      (e) => e.pathKey === key || e.pathKey.endsWith(`/${key}`) || key.endsWith(`/${e.pathKey}`),
    );
    return hits.length === 1 ? hits[0]!.target : null;
  }

  /** The link to the paper or note, or null when it has no file. */
  linkFor(target: LinkTarget): string | null {
    const kind = "paperId" in target ? "paperId" : "vaultPageId";
    const id = idOf(target);
    const hit = this.entries.find((e) => kind in e.target && idOf(e.target) === id);
    if (!hit) return null;
    const shared = this.entries.some((e) => e !== hit && e.key === hit.key);
    return `[[${shared ? hit.path : hit.path.slice(hit.path.lastIndexOf("/") + 1)}]]`;
  }
}

export class LinkIndex {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly root: ProjectRoot,
  ) {}

  /** Scans the folders once; use it for several lookups in one call. */
  async snapshot(): Promise<Links> {
    return new Links([...(await this.scan("paper", ".paper.md")), ...(await this.scan("vault_page", ".note.md"))]);
  }

  /** One lookup; see `Links.resolve`. */
  async resolve(link: string): Promise<LinkTarget | null> {
    return (await this.snapshot()).resolve(link);
  }

  /** One lookup; see `Links.linkFor`. */
  async linkFor(target: LinkTarget): Promise<string | null> {
    return (await this.snapshot()).linkFor(target);
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
      const path = entry.path.slice(0, -".md".length);
      const key = core.listItemKey(`[[${path.slice(path.lastIndexOf("/") + 1)}]]`);
      const pathKey = core.listItemKey(`[[${path}]]`);
      if (key === undefined || pathKey === undefined) continue;
      out.push({ target: kind === "paper" ? { paperId: id } : { vaultPageId: id }, key, pathKey, path });
    }
    return out;
  }
}
