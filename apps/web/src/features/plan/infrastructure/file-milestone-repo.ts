/**
 * Milestones as workspace files (0.9.5 files-first, L5): one
 * `<root>/plan/<slug>--<id-suffix>.milestone.md` per milestone, frontmatter
 * `title`, `status`, `target-date`, `created-at`, body = description.
 *
 * Laws (proved in test/file-milestone-repo.test.ts):
 * - A saved milestone reads back unchanged.
 * - The date is `target-date`, else `due`; an invalid date is shown with a
 *   badge, left out of the feed, and the file is not rewritten for it.
 * - Every save and delete publishes the whole feed once.
 * - A save keeps the path and every field it does not own.
 * - A save never overwrites a file changed since it was read.
 */
import type {
  IMilestoneRepository,
  IWorkspaceFs,
  Milestone,
  MilestoneFilter,
  MilestoneStatus,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** A milestone as the published feed carries it (Rust `FeedMilestone`). */
export interface FeedItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  targetDate?: string;
}

/** Sends the whole feed after a change (`POST /api/plan/feed/publish`). */
export type PublishFeed = (items: FeedItem[]) => Promise<void>;

const TYPE = "milestone";
/** How many numbered trash names a delete tries, as for papers. */
const TRASH_NAME_ATTEMPTS = 1000;
const STATUSES: readonly MilestoneStatus[] = ["planned", "in_progress", "done", "blocked"];

interface Found {
  path: string;
  text: string;
  milestone: Milestone;
}

/** True when the milestone names a date that is not a real calendar day. */
export function hasBadDate(milestone: Milestone): boolean {
  return milestone.targetDate !== undefined && !readyCore().isIsoDay(milestone.targetDate);
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parse(path: string, text: string): Found | null {
  const core = readyCore();
  const { frontmatter, body } = core.readFrontmatter(text);
  const field = (key: string) => core.frontmatterString(frontmatter, key);
  const id = field("weaveforge-id");
  if (!id || field("weaveforge-type") !== TYPE) return null;
  const status = field("status") as MilestoneStatus | undefined;
  const description = body.trim();
  const milestone: Milestone = {
    id,
    title: field("title") ?? id,
    status: status && STATUSES.includes(status) ? status : "planned",
    dependencies: asList(frontmatter.dependencies),
    compute: asList(frontmatter.compute),
    createdAt: field("created-at") ?? "",
  };
  if (description) milestone.description = description;
  const date = field("target-date") ?? field("due");
  if (date) milestone.targetDate = date;
  return { path, text, milestone };
}

export class FileMilestoneRepository implements IMilestoneRepository {
  constructor(
    private readonly fs: IWorkspaceFs,
    /** Project folder the `plan/` folder sits in ("" for the workspace root). */
    private readonly root: string,
    private readonly publish?: PublishFeed,
  ) {}

  private get dir(): string {
    return this.root ? `${this.root}/plan` : "plan";
  }

  private async readAll(): Promise<Found[]> {
    if (!(await this.fs.stat(this.dir))) return [];
    const found: Found[] = [];
    for await (const entry of this.fs.walk(this.dir)) {
      if (!entry.path.endsWith(`.${TYPE}.md`)) continue;
      // One unreadable file is skipped and reported, not fatal to the list (F97-P2-23).
      let text: string;
      try {
        text = await this.fs.readText(entry.path);
      } catch (error) {
        console.warn(`Skipped milestone ${entry.path}: could not read it.`, error);
        continue;
      }
      const parsed = parse(entry.path, text);
      if (parsed) found.push(parsed);
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getById(id: string): Promise<Milestone | null> {
    return (await this.readAll()).find((f) => f.milestone.id === id)?.milestone ?? null;
  }

  async list(filter: MilestoneFilter = {}): Promise<Milestone[]> {
    const needle = filter.titleContains?.toLowerCase();
    return (await this.readAll())
      .map((f) => f.milestone)
      .filter((m) => !filter.status || m.status === filter.status)
      .filter((m) => !needle || m.title.toLowerCase().includes(needle));
  }

  async save(milestone: Milestone): Promise<void> {
    const core = readyCore();
    const found = (await this.readAll()).find((f) => f.milestone.id === milestone.id);
    const path = found?.path ?? core.flatPath(TYPE, milestone.id, milestone.title, this.root);
    const old = found ? core.readFrontmatter(found.text).frontmatter : {};
    const fields: Record<string, unknown> = {
      "weaveforge-id": milestone.id,
      "weaveforge-type": TYPE,
      ...old,
      title: milestone.title,
      status: milestone.status,
      "target-date": milestone.targetDate,
      "created-at": milestone.createdAt,
      dependencies: milestone.dependencies.length ? milestone.dependencies : undefined,
      compute: milestone.compute.length ? milestone.compute : undefined,
    };
    if (milestone.targetDate !== undefined) delete fields.due;
    const text = core.writeFrontmatter(fields, milestone.description ? `${milestone.description}\n` : "");
    await this.write(path, text, found?.text ?? null);
    await this.publishAll();
  }

  /** Moves the milestone's file to `.weaveforge/trash/<day>/<path>`; never unlinks it. */
  async delete(id: string): Promise<void> {
    const found = (await this.readAll()).find((f) => f.milestone.id === id);
    if (found) await this.moveToTrash(found.path);
    await this.publishAll();
  }

  /** Renames `path` to the first free trash name for today (`-2`, `-3`, … on a clash). */
  private async moveToTrash(path: string): Promise<void> {
    const core = readyCore();
    const now = Date.now();
    for (let n = 1; n <= TRASH_NAME_ATTEMPTS; n += 1) {
      const target = core.trashPathFor(path, now, n);
      if (await this.fs.stat(target)) continue;
      await this.fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
      await this.fs.rename(path, target);
      return;
    }
    throw new Error(`${path}: no free name in the trash; not deleted.`);
  }

  private async write(path: string, text: string, expected: string | null): Promise<void> {
    if (!this.fs.writeTextIf) return this.fs.writeFile(path, text);
    if (!(await this.fs.writeTextIf(path, text, expected))) {
      throw new Error(`${path} changed on disk; reload before saving.`);
    }
  }

  private async publishAll(): Promise<void> {
    if (!this.publish) return;
    const items = (await this.list()).map((m): FeedItem => {
      const item: FeedItem = { id: m.id, title: m.title, status: m.status };
      if (m.description) item.description = m.description;
      if (m.targetDate && !hasBadDate(m)) item.targetDate = m.targetDate;
      return item;
    });
    await this.publish(items);
  }
}
