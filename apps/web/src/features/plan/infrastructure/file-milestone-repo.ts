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
  ComputeNeed,
  EditMilestoneInput,
  IMilestoneManager,
  IMilestoneRepository,
  IWorkspaceFs,
  Milestone,
  MilestoneDependency,
  MilestoneFilter,
  MilestoneStatus,
  NewMilestoneInput,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { moveToTrash } from "@/lib/workspace-trash";
import { rootOf, type RootLike } from "@/backend/providers/files/file-entity-store";

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

/** List items that are objects. The frontmatter writer stores an object item as JSON text, so text items are parsed; anything else is dropped. */
function asObjects<T>(value: unknown): T[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.flatMap((item) => {
    if (typeof item === "string") {
      try {
        item = JSON.parse(item);
      } catch {
        return [];
      }
    }
    return item !== null && typeof item === "object" && !Array.isArray(item) ? [item as T] : [];
  });
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
    dependencies: asObjects(frontmatter.dependencies),
    compute: asObjects(frontmatter.compute),
    createdAt: field("created-at") ?? "",
  };
  if (description) milestone.description = description;
  const date = field("target-date") ?? field("due");
  if (date) milestone.targetDate = date;
  return { path, text, milestone };
}

/** Same rules as Rust `validate_dependencies` (crates/wf-core/src/plan/milestone.rs). */
function checkDependencies(deps: MilestoneDependency[]): void {
  for (const dep of deps) {
    if (dep.kind === "external") {
      if (!(dep.label ?? "").trim()) throw new Error("External dependencies need a label.");
    } else if (!(dep.refId ?? "").trim()) {
      throw new Error(`A ${dep.kind} dependency needs a refId.`);
    }
  }
}

/** Same rules as Rust `validate_compute`. */
function checkCompute(compute: ComputeNeed[]): void {
  for (const need of compute) {
    if (!need.resource.trim()) throw new Error("Compute needs a resource name.");
    if (need.count !== undefined && (!Number.isFinite(need.count) || need.count <= 0)) {
      throw new Error("Compute count must be a positive number.");
    }
    if (need.hours !== undefined && (!Number.isFinite(need.hours) || need.hours < 0)) {
      throw new Error("Compute hours cannot be negative.");
    }
  }
}

/** Title and date rules shared by add and update (Rust `validate_new_milestone`, `update`). */
function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Milestone title is required.");
  return trimmed;
}

function checkDate(date: string | undefined): void {
  if (date && !readyCore().isIsoDay(date)) throw new Error("Target date must be yyyy-mm-dd.");
}

export class FileMilestoneRepository implements IMilestoneRepository, IMilestoneManager {
  constructor(
    private readonly fs: IWorkspaceFs,
    /** Project folder the `plan/` folder sits in ("" for the workspace root). */
    private readonly root: RootLike,
    private readonly publish?: PublishFeed,
  ) {}

  private get dir(): string {
    const root = rootOf(this.root);
    return root ? `${root}/plan` : "plan";
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
    const path = found?.path ?? core.flatPath(TYPE, milestone.id, milestone.title, rootOf(this.root));
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

  async add(input: NewMilestoneInput): Promise<Milestone> {
    const title = checkTitle(input.title);
    checkDate(input.targetDate || undefined);
    const dependencies = input.dependencies ?? [];
    const compute = input.compute ?? [];
    checkDependencies(dependencies);
    checkCompute(compute);
    const milestone: Milestone = {
      id: crypto.randomUUID(),
      title,
      status: input.status ?? "planned",
      dependencies,
      compute,
      createdAt: new Date().toISOString(),
    };
    if (input.description) milestone.description = input.description;
    if (input.targetDate) milestone.targetDate = input.targetDate;
    await this.save(milestone);
    return milestone;
  }

  async setStatus(id: string, status: MilestoneStatus): Promise<Milestone> {
    if (!STATUSES.includes(status)) throw new Error(`Unknown milestone status: ${String(status)}`);
    return this.change(id, (m) => ({ ...m, status }));
  }

  async update(id: string, input: EditMilestoneInput): Promise<Milestone> {
    const title = input.title === undefined ? undefined : checkTitle(input.title);
    checkDate(input.targetDate || undefined);
    if (input.dependencies) checkDependencies(input.dependencies);
    if (input.compute) checkCompute(input.compute);
    return this.change(id, (m) => {
      const next: Milestone = {
        ...m,
        title: title ?? m.title,
        status: input.status ?? m.status,
        dependencies: input.dependencies ?? m.dependencies,
        compute: input.compute ?? m.compute,
      };
      const description = input.description ?? m.description;
      const targetDate = input.targetDate === undefined ? m.targetDate : input.targetDate || undefined;
      delete next.description;
      delete next.targetDate;
      if (description) next.description = description;
      if (targetDate) next.targetDate = targetDate;
      return next;
    });
  }

  async remove(id: string): Promise<void> {
    await this.delete(id);
  }

  /** Reads milestone `id`, applies `change`, saves it and returns the saved milestone. */
  private async change(id: string, change: (m: Milestone) => Milestone): Promise<Milestone> {
    const current = await this.getById(id);
    if (!current) throw new Error(`No milestone with id "${id}".`);
    const next = change(current);
    await this.save(next);
    return next;
  }

  /** Moves the milestone's file to `.weaveforge/trash/<day>/<path>`; never unlinks it. */
  async delete(id: string): Promise<void> {
    const found = (await this.readAll()).find((f) => f.milestone.id === id);
    if (found) await moveToTrash(this.fs, found.path, Date.now());
    await this.publishAll();
  }

  private async write(path: string, text: string, expected: string | null): Promise<void> {
    if (!this.fs.writeTextIf) throw new Error(`${path}: this workspace cannot save without overwriting outside edits.`);
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
