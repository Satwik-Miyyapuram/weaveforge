/**
 * Writes the showcase workspace through a Supabase-shaped client.
 *
 * The same code runs in two places: the `seed:showcase` Node script (service
 * role against live Supabase, for the demo accounts) and the desktop app's
 * "Load demo workspace" button (PGlite, no account). Neither the data nor this
 * module imports anything app-specific, so both callers can share it; the
 * caller supplies the client, the blob store and a way to fetch each chart.
 *
 * Every insert names `user_id` explicitly. Supabase would default it from
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

/** Drops any earlier copy of the project. Everything else cascades from projects. */
export async function resetShowcaseProject(db: Db, userId: string, name: string): Promise<string> {
  const del = await db.from("projects").delete().eq("user_id", userId).eq("name", name);
  if (del.error) throw new Error(`delete project: ${del.error.message}`);
  const row = must(
    await db.from("projects").insert({ user_id: userId, name, color: SHOWCASE_PROJECT_COLOR }).select("id").single(),
    "insert project",
  ) as { id: string };
  return row.id;
}

async function seedMilestonesAndLog(db: Db, userId: string, projectId: string, now: Date, milestones: ShowcaseMilestone[], log: ShowcaseLogEntry[]) {
  const ms = await insertRows<{ id: string; title: string }>(
    db,
    "milestones",
    milestones.map((m) => ({
      user_id: userId,
      project_id: projectId,
      title: m.title,
      description: m.description ?? null,
      status: m.status,
      target_date: m.target_date,
      dependencies: m.dependencies ?? [],
      compute: m.compute ?? [],
    })),
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

export async function seedShowcase(opts: SeedShowcaseOptions): Promise<SeedShowcaseResult> {
  const { db, userId, store, chart } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const projectName = opts.projectName ?? SHOWCASE_PROJECT_NAME;
  const counts: Record<string, number> = {};

  const projectId = await resetShowcaseProject(db, userId, projectName);
  log(`project ${projectName} → ${projectId}`);

  // Papers first: nearly everything else hangs off their ids.
  const paperRows = await insertRows<{ id: string; title: string }>(
    db,
    "papers",
    SHOWCASE_PAPERS.map((p) => ({
      user_id: userId,
      project_id: projectId,
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
      read_at: p.readDaysAgo == null ? null : dateDaysAgo(now, p.readDaysAgo),
      bibtex: p.bibtex ?? null,
      metadata: SHOWCASE_ANNOTATIONS[p.title] ? { annotations: SHOWCASE_ANNOTATIONS[p.title] } : {},
    })),
    "id, title",
  );
  const paperIds: Record<string, string> = {};
  for (const r of paperRows) paperIds[r.title] = r.id;
  counts.papers = paperRows.length;
  const pid = (title: string) => {
    const id = paperIds[title];
    if (!id) throw new Error(`showcase: unknown paper "${title}"`);
    return id;
  };

  // Figures: upload each chart and append a `paperimg:` block to the notes.
  let figures = 0;
  for (const [title, list] of Object.entries(SHOWCASE_PAPER_FIGURES)) {
    const paperId = pid(title);
    const blocks: string[] = [];
    for (const [kind, alt] of list) {
      const png = await chart(kind);
      if (!png) continue;
      const path = `${userId}/${paperId}/${kind}.png`;
      await store.upload(PAPER_IMAGE_BUCKET, path, toBlob(png), "image/png");
      blocks.push(`![${alt}](${PAPER_IMAGE_PREFIX}${path})`);
      figures += 1;
    }
    if (blocks.length === 0) continue;
    const paper = SHOWCASE_PAPERS.find((p) => p.title === title)!;
    const upd = await db
      .from("papers")
      .update({ summary: `${paper.summary}\n\n${blocks.join("\n\n")}` })
      .eq("id", paperId);
    if (upd.error) throw new Error(`update paper figures: ${upd.error.message}`);
  }
  counts.figures = figures;

  await insertRows(
    db,
    "paper_relations",
    SHOWCASE_RELATIONS.map(([from, to, relation, note]) => ({
      user_id: userId,
      project_id: projectId,
      from_paper: pid(from),
      to_paper: pid(to),
      relation,
      source: "manual",
      note: note ?? null,
    })),
  );
  counts.relations = SHOWCASE_RELATIONS.length;

  // Reading lists: parents before children, then items, then screening.
  const listIds: Record<string, string> = {};
  const itemIds: Record<string, string> = {}; // `${list}\u0000${paper}` → item id
  let items = 0;
  for (const pass of [SHOWCASE_READING_LISTS.filter((l) => !l.parent), SHOWCASE_READING_LISTS.filter((l) => l.parent)]) {
    for (const [i, l] of pass.entries()) {
      const row = must(
        await db
          .from("reading_lists")
          .insert({
            user_id: userId,
            project_id: projectId,
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
      const inserted = await insertRows<{ id: string; paper_id: string }>(
        db,
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
        const title = Object.keys(paperIds).find((t) => paperIds[t] === it.paper_id)!;
        itemIds[`${l.name}\u0000${title}`] = it.id;
      }
      items += inserted.length;
    }
  }
  counts.readingLists = SHOWCASE_READING_LISTS.length;
  counts.readingListItems = items;

  await insertRows(
    db,
    "screening_decisions",
    SHOWCASE_SCREENING.map((d) => ({
      item_id: itemIds[`${d.list}\u0000${d.paper}`],
      reviewer_id: userId,
      stage: d.stage,
      state: d.state,
      reason: d.reason ?? null,
    })),
  );
  counts.screeningDecisions = SHOWCASE_SCREENING.length;

  const milestones = await seedMilestonesAndLog(db, userId, projectId, now, SHOWCASE_MILESTONES, SHOWCASE_LOG);
  counts.milestones = milestones.length;
  counts.logEntries = SHOWCASE_LOG.length;

  // Experiments, then artifacts and metric curves per experiment.
  const experimentIds: Record<string, string> = {};
  let artifacts = 0;
  let metricPoints = 0;
  for (const e of SHOWCASE_EXPERIMENTS) {
    const row = must(
      await db
        .from("experiments")
        .insert({
          user_id: userId,
          project_id: projectId,
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
      const png = await chart(kind);
      if (!png) continue;
      const path = `${userId}/${row.id}/${file}`;
      await store.upload(EXPERIMENT_ARTIFACT_BUCKET, path, toBlob(png), "image/png");
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
  counts.experiments = SHOWCASE_EXPERIMENTS.length;
  counts.artifacts = artifacts;
  counts.metricPoints = metricPoints;

  // Report outline: parents before children, in the order listed.
  const sectionIds: Record<string, string> = {};
  for (const [i, s] of SHOWCASE_REPORT.entries()) {
    const row = must(
      await db
        .from("report_sections")
        .insert({
          user_id: userId,
          project_id: projectId,
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
  counts.reportSections = SHOWCASE_REPORT.length;

  await insertRows(
    db,
    "annotation_pins",
    SHOWCASE_ANNOTATION_PINS.map(([title, key, sectionNo]) => ({
      user_id: userId,
      project_id: projectId,
      paper_id: pid(title),
      annotation_key: key,
      report_section_id: sectionIds[sectionNo],
    })),
  );
  await insertRows(
    db,
    "annotation_quotation_types",
    SHOWCASE_QUOTATION_TYPES.map(([title, key, quotation_type]) => ({
      user_id: userId,
      project_id: projectId,
      paper_id: pid(title),
      annotation_key: key,
      quotation_type,
    })),
  );
  counts.annotationPins = SHOWCASE_ANNOTATION_PINS.length;

  await insertRows(
    db,
    "vault_pages",
    SHOWCASE_VAULT.map((v, i) => ({ user_id: userId, project_id: projectId, title: v.title, body: v.body, sort_order: i })),
  );
  counts.vaultPages = SHOWCASE_VAULT.length;

  // Custom paper fields and their values.
  let fieldValues = 0;
  for (const [i, f] of SHOWCASE_FIELDS.entries()) {
    const def = must(
      await db
        .from("paper_field_defs")
        .insert({ user_id: userId, project_id: projectId, name: f.name, kind: f.kind, options: f.options ?? [], sort_order: i })
        .select("id")
        .single(),
      `insert field ${f.name}`,
    ) as { id: string };
    const rows = Object.entries(f.values).map(([title, value]) => ({
      user_id: userId,
      project_id: projectId,
      paper_id: pid(title),
      field_id: def.id,
      value,
    }));
    await insertRows(db, "paper_field_values", rows);
    fieldValues += rows.length;
  }
  counts.fieldDefs = SHOWCASE_FIELDS.length;
  counts.fieldValues = fieldValues;

  await insertRows(
    db,
    "citation_alert_tracks",
    SHOWCASE_CITATION_TRACKS.map((title, i) => ({
      user_id: userId,
      project_id: projectId,
      paper_id: pid(title),
      tracked_at: isoDaysAgo(now, 20 - i),
      last_checked_at: isoDaysAgo(now, 1),
      seen_citing_ids: [],
    })),
  );
  counts.citationTracks = SHOWCASE_CITATION_TRACKS.length;

  const pinId = (type: string, name: string): string | undefined => {
    switch (type) {
      case "milestone":
        return milestones.find((m) => m.title === name)?.id;
      case "experiment":
        return experimentIds[name];
      case "report_section":
        return sectionIds[name];
      case "reading_list":
        return listIds[name];
      case "paper":
        return paperIds[name];
      default:
        return undefined;
    }
  };
  await insertRows(
    db,
    "library_pins",
    SHOWCASE_PINS.flatMap((p) => {
      const id = pinId(p.type, p.name);
      return id ? [{ user_id: userId, owner_id: userId, project_id: projectId, resource_type: p.type, resource_id: id }] : [];
    }),
  );
  counts.libraryPins = SHOWCASE_PINS.length;

  log(`seeded ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  return { projectId, paperIds, counts };
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
