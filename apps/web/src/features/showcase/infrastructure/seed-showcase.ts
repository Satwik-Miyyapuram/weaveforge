/**
 * Writes the showcase workspace through a supabase-js-shaped client.
 *
 * The same code runs in two places: the `seed:showcase` Node script (service
 * role against the live server, for the demo accounts) and the desktop app's
 * "Load demo workspace" button (PGlite, no account). Neither the data nor this
 * module imports anything app-specific, so both callers can share it; the
 * caller supplies the client, the blob store and a way to fetch each chart.
 *
 * Every insert names `user_id` explicitly. The schema would default it from
 * `auth.uid()`, but a service-role session and PGlite both have no auth
 * context, so the default would be null.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHOWCASE_ANNOTATIONS,
  SHOWCASE_ANNOTATION_PINS,
  SHOWCASE_CITATION_TRACKS,
  SHOWCASE_EXPERIMENTS,
  SHOWCASE_FIELDS,
  SHOWCASE_LOG,
  SHOWCASE_MILESTONES,
  SHOWCASE_PAPERS,
  SHOWCASE_PAPER_FIGURES,
  SHOWCASE_PINS,
  SHOWCASE_PROJECT_COLOR,
  SHOWCASE_PROJECT_NAME,
  SHOWCASE_QUOTATION_TYPES,
  SHOWCASE_READING_LISTS,
  SHOWCASE_RELATIONS,
  SHOWCASE_REPORT,
  SHOWCASE_SCREENING,
  SHOWCASE_VAULT,
  superviseeShowcase,
  type ShowcaseLogEntry,
  type ShowcaseMilestone,
} from "../domain/showcase-data";

/** Bucket paths match what the app writes, so the readers need no special case. */
export const PAPER_IMAGE_BUCKET = "paper-images";
export const EXPERIMENT_ARTIFACT_BUCKET = "experiment-artifacts";
const PAPER_IMAGE_PREFIX = "paperimg:";

export interface ShowcaseBlobStore {
  upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<unknown>;
}

export interface SeedShowcaseOptions {
  db: SupabaseClient<any, any, any>;
  userId: string;
  store: ShowcaseBlobStore;
  /** Returns the PNG for a chart kind (`beta-loss-curve`, …), or null to skip the figure. */
  chart: (kind: string) => Promise<Uint8Array | Blob | null>;
  projectName?: string;
  /** Fixed "now" so the logbook and read dates are reproducible. */
  now?: Date;
  log?: (line: string) => void;
}

export interface SeedShowcaseResult {
  projectId: string;
  paperIds: Record<string, string>;
  counts: Record<string, number>;
}

type Db = SeedShowcaseOptions["db"];

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data == null) throw new Error(`${what}: no rows returned`);
  return res.data;
}

async function insertRows<T = { id: string }>(db: Db, table: string, rows: Record<string, unknown>[], select = "id"): Promise<T[]> {
  if (rows.length === 0) return [];
  return must(await db.from(table).insert(rows).select(select), `insert ${table}`) as T[];
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function dateDaysAgo(now: Date, days: number): string {
  return isoDaysAgo(now, days).slice(0, 10);
}

function toBlob(png: Uint8Array | Blob): Blob {
  return png instanceof Blob ? png : new Blob([png as BlobPart], { type: "image/png" });
}

/**
 * Drops any earlier showcase copy of the project. Everything else cascades from
 * projects. Only rows marked `is_showcase` go (migration 0146), so a user's own
 * project with the same name is left alone.
 */
export async function resetShowcaseProject(db: Db, userId: string, name: string): Promise<string> {
  const del = await db.from("projects").delete().eq("user_id", userId).eq("name", name).eq("is_showcase", true);
  if (del.error) throw new Error(`delete project: ${del.error.message}`);
  const row = must(
    await db
      .from("projects")
      .insert({ user_id: userId, name, color: SHOWCASE_PROJECT_COLOR, is_showcase: true })
      .select("id")
      .single(),
    "insert project",
  ) as { id: string };
  return row.id;
}

async function seedMilestonesAndLog(db: Db, userId: string, projectId: string, now: Date, milestones: ShowcaseMilestone[], log: ShowcaseLogEntry[]) {
  const milestoneIds = new Map(milestones.map((m) => [m.title, crypto.randomUUID()]));
  const ms = await insertRows<{ id: string; title: string }>(
    db,
    "milestones",
    milestones.map((m) => {
      const id = milestoneIds.get(m.title)!;
      const dependencies = (m.dependencies ?? []).map((d) => {
        if (d.kind === "milestone" && !d.refId && d.label && milestoneIds.has(d.label)) {
          return { ...d, refId: milestoneIds.get(d.label) };
        }
        return d;
      });
      return {
        id,
        user_id: userId,
        project_id: projectId,
        title: m.title,
        description: m.description ?? null,
        status: m.status,
        target_date: m.target_date,
        dependencies,
        compute: m.compute ?? [],
      };
    }),
    "id, title",
  );
  await insertRows(
    db,
    "log_entries",
    log.map((e) => ({
      user_id: userId,
      project_id: projectId,
      entry_date: dateDaysAgo(now, e.daysAgo),
      kind: e.kind,
      body: e.body,
      links: [],
    })),
  );
  return ms;
}

/** What every section of the seed writes with, and the counts it reports. */
interface SeedContext {
  db: Db;
  userId: string;
  projectId: string;
  now: Date;
  store: ShowcaseBlobStore;
  chart: SeedShowcaseOptions["chart"];
  counts: Record<string, number>;
}

type PaperId = (title: string) => string;

/** The fields every project-scoped row carries. */
function owned(ctx: SeedContext) {
  return { user_id: ctx.userId, project_id: ctx.projectId };
}

/** Key of a list item in the item index: one list, one paper. */
function itemKey(list: string, paper: string): string {
  return `${list}\u0000${paper}`;
}

/** The item for a list and paper, or an error naming both. */
export function requireItem(itemIds: ReadonlyMap<string, string>, list: string, paper: string): string {
  const id = itemIds.get(itemKey(list, paper));
  if (!id) throw new Error(`showcase: missing item ${list}/${paper}`);
  return id;
}

export async function seedShowcase(opts: SeedShowcaseOptions): Promise<SeedShowcaseResult> {
  const { db, userId, store, chart } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const projectName = opts.projectName ?? SHOWCASE_PROJECT_NAME;

  const projectId = await resetShowcaseProject(db, userId, projectName);
  log(`project ${projectName} → ${projectId}`);
  const ctx: SeedContext = { db, userId, projectId, now, store, chart, counts: {} };

  // Papers first: nearly everything else hangs off their ids.
  const paperIds = await seedPapers(ctx);
  const pid: PaperId = (title) => {
    const id = paperIds[title];
    if (!id) throw new Error(`showcase: unknown paper "${title}"`);
    return id;
  };
  await seedFigures(ctx, pid);
  await seedRelations(ctx, pid);
  const lists = await seedReadingLists(ctx, pid);
  await seedScreening(ctx, lists.itemIds);

  const milestones = await seedMilestonesAndLog(db, userId, projectId, now, SHOWCASE_MILESTONES, SHOWCASE_LOG);
  ctx.counts.milestones = milestones.length;
  ctx.counts.logEntries = SHOWCASE_LOG.length;

  const experimentIds = await seedExperiments(ctx, pid);
  const sectionIds = await seedReport(ctx);
  await seedAnnotationLinks(ctx, pid, sectionIds);
  await seedVault(ctx);
  await seedFields(ctx, pid);
  await seedCitationTracks(ctx, pid);
  await seedPins(ctx, {
    milestone: Object.fromEntries(milestones.map((m) => [m.title, m.id])),
    experiment: experimentIds,
    report_section: sectionIds,
    reading_list: lists.listIds,
    paper: paperIds,
  });

  const { counts } = ctx;
  log(`seeded ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  return { projectId, paperIds, counts };
}

async function seedPapers(ctx: SeedContext): Promise<Record<string, string>> {
  const paperRows = await insertRows<{ id: string; title: string }>(
    ctx.db,
    "papers",
    SHOWCASE_PAPERS.map((p) => ({
      ...owned(ctx),
      title: p.title,
      authors: p.authors,
      year: p.year,
      venue: p.venue ?? null,
      doi: p.doi ?? null,
      arxiv_id: p.arxiv_id ?? null,
      url: p.url ?? null,
      abstract: p.abstract ?? null,
      summary: p.summary,
      status: p.status,
      tags: p.tags,
      rating: p.rating ?? null,
      read_at: p.readDaysAgo == null ? null : dateDaysAgo(ctx.now, p.readDaysAgo),
      bibtex: p.bibtex ?? null,
      metadata: SHOWCASE_ANNOTATIONS[p.title] ? { annotations: SHOWCASE_ANNOTATIONS[p.title] } : {},
    })),
    "id, title",
  );
  const paperIds: Record<string, string> = {};
  for (const r of paperRows) paperIds[r.title] = r.id;
  ctx.counts.papers = paperRows.length;
  return paperIds;
}

/** Upload each chart and append a `paperimg:` block to the paper's notes. */
async function seedFigures(ctx: SeedContext, pid: PaperId): Promise<void> {
  let figures = 0;
  for (const [title, list] of Object.entries(SHOWCASE_PAPER_FIGURES)) {
    const paperId = pid(title);
    const blocks: string[] = [];
    for (const [kind, alt] of list) {
      const png = await ctx.chart(kind);
      if (!png) continue;
      const path = `${ctx.userId}/${paperId}/${kind}.png`;
      await ctx.store.upload(PAPER_IMAGE_BUCKET, path, toBlob(png), "image/png");
      blocks.push(`![${alt}](${PAPER_IMAGE_PREFIX}${path})`);
      figures += 1;
    }
    if (blocks.length === 0) continue;
    const paper = SHOWCASE_PAPERS.find((p) => p.title === title)!;
    const upd = await ctx.db
      .from("papers")
      .update({ summary: `${paper.summary}\n\n${blocks.join("\n\n")}` })
      .eq("id", paperId);
    if (upd.error) throw new Error(`update paper figures: ${upd.error.message}`);
  }
  ctx.counts.figures = figures;
}

async function seedRelations(ctx: SeedContext, pid: PaperId): Promise<void> {
  await insertRows(
    ctx.db,
    "paper_relations",
    SHOWCASE_RELATIONS.map(([from, to, relation, note]) => ({
      ...owned(ctx),
      from_paper: pid(from),
      to_paper: pid(to),
      relation,
      source: "manual",
      note: note ?? null,
    })),
  );
  ctx.counts.relations = SHOWCASE_RELATIONS.length;
}

/** Reading lists, parents before children, each with its items. */
async function seedReadingLists(
  ctx: SeedContext,
  pid: PaperId,
): Promise<{ listIds: Record<string, string>; itemIds: Map<string, string> }> {
  const listIds: Record<string, string> = {};
  const itemIds = new Map<string, string>();
  let items = 0;
  for (const pass of [SHOWCASE_READING_LISTS.filter((l) => !l.parent), SHOWCASE_READING_LISTS.filter((l) => l.parent)]) {
    for (const [i, l] of pass.entries()) {
      const row = must(
        await ctx.db
          .from("reading_lists")
          .insert({
            ...owned(ctx),
            name: l.name,
            description: l.description ?? null,
            color: l.color,
            sort_order: i,
            parent_id: l.parent ? listIds[l.parent] : null,
          })
          .select("id")
          .single(),
        `insert reading list ${l.name}`,
      ) as { id: string };
      listIds[l.name] = row.id;
      // Rows come back by paper id; name each by the title it was inserted for.
      const titleById = new Map(l.papers.map((title) => [pid(title), title]));
      const inserted = await insertRows<{ id: string; paper_id: string }>(
        ctx.db,
        "reading_list_items",
        l.papers.map((title, j) => ({
          list_id: row.id,
          paper_id: pid(title),
          sort_order: j,
          note: l.notes?.[title] ?? null,
        })),
        "id, paper_id",
      );
      for (const it of inserted) {
        const title = titleById.get(it.paper_id);
        if (title) itemIds.set(itemKey(l.name, title), it.id);
      }
      items += inserted.length;
    }
  }
  ctx.counts.readingLists = SHOWCASE_READING_LISTS.length;
  ctx.counts.readingListItems = items;
  return { listIds, itemIds };
}

async function seedScreening(ctx: SeedContext, itemIds: ReadonlyMap<string, string>): Promise<void> {
  await insertRows(
    ctx.db,
    "screening_decisions",
    SHOWCASE_SCREENING.map((d) => ({
      item_id: requireItem(itemIds, d.list, d.paper),
      reviewer_id: ctx.userId,
      stage: d.stage,
      state: d.state,
      reason: d.reason ?? null,
    })),
  );
  ctx.counts.screeningDecisions = SHOWCASE_SCREENING.length;
}

/** Experiments, then each one's artifacts and metric curves. */
async function seedExperiments(ctx: SeedContext, pid: PaperId): Promise<Record<string, string>> {
  const { db, userId, now } = ctx;
  const experimentIds: Record<string, string> = {};
  let artifacts = 0;
  let metricPoints = 0;
  for (const e of SHOWCASE_EXPERIMENTS) {
    const row = must(
      await db
        .from("experiments")
        .insert({
          ...owned(ctx),
          name: e.name,
          hypothesis: e.hypothesis ?? null,
          status: e.status,
          config: e.config,
          metrics: e.metrics,
          artifacts: [],
          branch: e.branch ?? null,
          commit_sha: e.commit_sha ?? null,
          repo_url: e.repo_url ?? null,
          run_command: e.run_command ?? null,
          result_note: e.result_note ?? null,
          related_paper: e.related_paper ? pid(e.related_paper) : null,
          started_at: e.startedDaysAgo == null ? null : isoDaysAgo(now, e.startedDaysAgo),
          finished_at: e.finishedDaysAgo == null ? null : isoDaysAgo(now, e.finishedDaysAgo),
        })
        .select("id")
        .single(),
      `insert experiment ${e.name}`,
    ) as { id: string };
    experimentIds[e.name] = row.id;

    const paths: string[] = [];
    for (const [kind, file] of e.artifacts ?? []) {
      const png = await ctx.chart(kind);
      if (!png) continue;
      const path = `${userId}/${row.id}/${file}`;
      await ctx.store.upload(EXPERIMENT_ARTIFACT_BUCKET, path, toBlob(png), "image/png");
      paths.push(path);
    }
    if (paths.length > 0) {
      const upd = await db.from("experiments").update({ artifacts: paths }).eq("id", row.id);
      if (upd.error) throw new Error(`update experiment artifacts: ${upd.error.message}`);
      artifacts += paths.length;
    }

    const started = e.startedDaysAgo == null ? now.getTime() - 86_400_000 : now.getTime() - e.startedDaysAgo * 86_400_000;
    const points: Record<string, unknown>[] = [];
    for (const [metric, [steps, fn]] of Object.entries(e.curves ?? {})) {
      for (let s = 0; s < steps; s++) {
        points.push({
          experiment_id: row.id,
          user_id: userId,
          metric,
          step: s,
          value: fn(s),
          wall_time: new Date(started + s * 60_000).toISOString(),
        });
      }
    }
    if (points.length > 0) {
      const ins = await db.from("experiment_metrics").insert(points);
      if (ins.error) throw new Error(`insert metrics for ${e.name}: ${ins.error.message}`);
      metricPoints += points.length;
    }
  }
  ctx.counts.experiments = SHOWCASE_EXPERIMENTS.length;
  ctx.counts.artifacts = artifacts;
  ctx.counts.metricPoints = metricPoints;
  return experimentIds;
}

/** Report outline: parents before children, in the order listed. */
async function seedReport(ctx: SeedContext): Promise<Record<string, string>> {
  const sectionIds: Record<string, string> = {};
  for (const [i, s] of SHOWCASE_REPORT.entries()) {
    const row = must(
      await ctx.db
        .from("report_sections")
        .insert({
          ...owned(ctx),
          section_no: s.section_no,
          title: s.title,
          parent_id: s.parent ? sectionIds[s.parent] : null,
          status: s.status,
          word_count: s.word_count ?? 0,
          target_words: s.target_words ?? null,
          deadline: s.deadline ?? null,
          notes: s.notes ?? null,
          sort_order: i,
        })
        .select("id")
        .single(),
      `insert section ${s.section_no}`,
    ) as { id: string };
    sectionIds[s.section_no] = row.id;
  }
  ctx.counts.reportSections = SHOWCASE_REPORT.length;
  return sectionIds;
}

/** Annotations pinned to report sections, and their quotation types. */
async function seedAnnotationLinks(ctx: SeedContext, pid: PaperId, sectionIds: Record<string, string>): Promise<void> {
  await insertRows(
    ctx.db,
    "annotation_pins",
    SHOWCASE_ANNOTATION_PINS.map(([title, key, sectionNo]) => ({
      ...owned(ctx),
      paper_id: pid(title),
      annotation_key: key,
      report_section_id: sectionIds[sectionNo],
    })),
  );
  await insertRows(
    ctx.db,
    "annotation_quotation_types",
    SHOWCASE_QUOTATION_TYPES.map(([title, key, quotation_type]) => ({
      ...owned(ctx),
      paper_id: pid(title),
      annotation_key: key,
      quotation_type,
    })),
  );
  ctx.counts.annotationPins = SHOWCASE_ANNOTATION_PINS.length;
}

async function seedVault(ctx: SeedContext): Promise<void> {
  await insertRows(
    ctx.db,
    "vault_pages",
    SHOWCASE_VAULT.map((v, i) => ({ ...owned(ctx), title: v.title, body: v.body, sort_order: i })),
  );
  ctx.counts.vaultPages = SHOWCASE_VAULT.length;
}

/** Custom paper fields and their values. */
async function seedFields(ctx: SeedContext, pid: PaperId): Promise<void> {
  let fieldValues = 0;
  for (const [i, f] of SHOWCASE_FIELDS.entries()) {
    const def = must(
      await ctx.db
        .from("paper_field_defs")
        .insert({ ...owned(ctx), name: f.name, kind: f.kind, options: f.options ?? [], sort_order: i })
        .select("id")
        .single(),
      `insert field ${f.name}`,
    ) as { id: string };
    const rows = Object.entries(f.values).map(([title, value]) => ({
      ...owned(ctx),
      paper_id: pid(title),
      field_id: def.id,
      value,
    }));
    await insertRows(ctx.db, "paper_field_values", rows);
    fieldValues += rows.length;
  }
  ctx.counts.fieldDefs = SHOWCASE_FIELDS.length;
  ctx.counts.fieldValues = fieldValues;
}

async function seedCitationTracks(ctx: SeedContext, pid: PaperId): Promise<void> {
  await insertRows(
    ctx.db,
    "citation_alert_tracks",
    SHOWCASE_CITATION_TRACKS.map((title, i) => ({
      ...owned(ctx),
      paper_id: pid(title),
      tracked_at: isoDaysAgo(ctx.now, 20 - i),
      last_checked_at: isoDaysAgo(ctx.now, 1),
      seen_citing_ids: [],
    })),
  );
  ctx.counts.citationTracks = SHOWCASE_CITATION_TRACKS.length;
}

/** Library pins, each resolved by type to an id seeded above; unknown names are skipped. */
async function seedPins(ctx: SeedContext, idsByType: Record<string, Record<string, string>>): Promise<void> {
  await insertRows(
    ctx.db,
    "library_pins",
    SHOWCASE_PINS.flatMap((p) => {
      const id = idsByType[p.type]?.[p.name];
      return id ? [{ ...owned(ctx), owner_id: ctx.userId, resource_type: p.type, resource_id: id }] : [];
    }),
  );
  ctx.counts.libraryPins = SHOWCASE_PINS.length;
}

/** The lighter workspace a supervisee account gets: milestones and a logbook only. */
export async function seedSuperviseeShowcase(opts: Omit<SeedShowcaseOptions, "store" | "chart"> & { label: string }): Promise<string> {
  const now = opts.now ?? new Date();
  const projectName = opts.projectName ?? SHOWCASE_PROJECT_NAME;
  const projectId = await resetShowcaseProject(opts.db, opts.userId, projectName);
  const data = superviseeShowcase(opts.label);
  await seedMilestonesAndLog(opts.db, opts.userId, projectId, now, data.milestones, data.log);
  opts.log?.(`supervisee ${opts.label}: project ${projectId}`);
  return projectId;
}
