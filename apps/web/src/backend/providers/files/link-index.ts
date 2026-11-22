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

/** A file the scan could not read, and why. */
export interface Unreadable {
  path: string;
  reason: string;
}

/** One scan of the folders; every lookup on it is free. */
export class Links {
  constructor(
    private readonly entries: readonly Entry[],
    /** Files the scan could not read. Their links and memberships are missing from this snapshot. */
    readonly unreadable: readonly Unreadable[] = [],
  ) {}

  /** The paper or note `link` points at, or null when none or several do. */
  resolve(link: string): LinkTarget | null {
    const core = readyCore();
    const key = core.listItemKey(link);
    if (key === undefined) return null;
    const matches = (pathKey: string) =>
      pathKey === key || pathKey.endsWith(`/${key}`) || key.endsWith(`/${pathKey}`);
    // An unreadable file that could match means the link may name it: no guess among the readable ones.
    const hidden = this.unreadable.some((u) => {
      const pathKey = core.listItemKey(`[[${u.path.replace(/\.md$/, "")}]]`);
      return pathKey !== undefined && matches(pathKey);
    });
    if (hidden) return null;
    const hits = this.entries.filter((e) => matches(e.pathKey));
    return hits.length === 1 ? hits[0]!.target : null;
  }

  /** Every paper and note, with its workspace path (`.md` included). */
  all(): { target: LinkTarget; path: string }[] {
    return this.entries.map((e) => ({ target: e.target, path: `${e.path}.md` }));
  }

  /** The workspace path (`.md` included) of the paper or note, or null when it has no file. */
  pathFor(target: LinkTarget): string | null {
    const hit = this.find(target);
    return hit ? `${hit.path}.md` : null;
  }

  /** The link to the paper or note, or null when it has no file. */
  linkFor(target: LinkTarget): string | null {
    const hit = this.find(target);
    if (!hit) return null;
    // An unreadable file with the same name makes the bare link ambiguous to resolve(): write the folder link.
    const core = readyCore();
    const shared =
      this.entries.some((e) => e !== hit && e.key === hit.key) ||
      this.unreadable.some((u) => core.listItemKey(`[[${u.path.slice(u.path.lastIndexOf("/") + 1).replace(/\.md$/, "")}]]`) === hit.key);
    return `[[${shared ? hit.path : hit.path.slice(hit.path.lastIndexOf("/") + 1)}]]`;
  }

  private find(target: LinkTarget): Entry | undefined {
    const kind = "paperId" in target ? "paperId" : "vaultPageId";
    const id = idOf(target);
    return this.entries.find((e) => kind in e.target && idOf(e.target) === id);
  }
}

export class LinkIndex {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly root: ProjectRoot,
  ) {}

  /** Scans the folders once; use it for several lookups in one call. */
  async snapshot(): Promise<Links> {
    const paper = await this.scan("paper", ".paper.md");
    const vault = await this.scan("vault_page", ".note.md");
    const unreadable = [...paper.unreadable, ...vault.unreadable];
    // Lookups keep the files they could read; each unreadable one is logged, never dropped silently.
    for (const u of unreadable) console.warn(`Skipped ${u.path}: could not read it.`, u.reason);
    return new Links([...paper.entries, ...vault.entries], unreadable);
  }

  /** One lookup; see `Links.resolve`. */
  async resolve(link: string): Promise<LinkTarget | null> {
    return (await this.snapshot()).resolve(link);
  }

  /** One lookup; see `Links.linkFor`. */
  async linkFor(target: LinkTarget): Promise<string | null> {
    return (await this.snapshot()).linkFor(target);
  }

  private async scan(
    kind: "paper" | "vault_page",
    suffix: string,
  ): Promise<{ entries: Entry[]; unreadable: Unreadable[] }> {
    const core = readyCore();
    const dir = core.entityDir(kind, this.root());
    const out: Entry[] = [];
    const unreadable: Unreadable[] = [];
    if (!(await this.fs.stat(dir))) return { entries: out, unreadable };
    for await (const entry of this.fs.walk(dir)) {
      if (entry.kind !== "file" || !entry.path.endsWith(suffix)) continue;
      let id: string | undefined;
      let text: string;
      try {
        text = await this.fs.readText(entry.path);
      } catch (error) {
        unreadable.push({ path: entry.path, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      try {
        if (kind === "paper") {
          const raw: unknown = core.paperRowFromFile(text).id;
          id = typeof raw === "string" && raw ? raw : entry.path;
        } else {
          id = core.frontmatterString(core.readFrontmatter(text).frontmatter, "weaveforge-id") ?? undefined;
        }
      } catch (error) {
        // A file whose frontmatter cannot be parsed may still be a member or a link target: report it.
        unreadable.push({ path: entry.path, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!id) continue;
      const path = entry.path.slice(0, -".md".length);
      const key = core.listItemKey(`[[${path.slice(path.lastIndexOf("/") + 1)}]]`);
      const pathKey = core.listItemKey(`[[${path}]]`);
      if (key === undefined || pathKey === undefined) continue;
      out.push({ target: kind === "paper" ? { paperId: id } : { vaultPageId: id }, key, pathKey, path });
    }
    return { entries: out, unreadable };
  }
}
