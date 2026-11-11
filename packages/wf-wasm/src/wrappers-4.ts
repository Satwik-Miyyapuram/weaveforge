/**
 * Typed wrappers over the raw wasm exports, folded from 17 one-module files:
 * markdown-images, mcp-config-rewrite, member-rows, membership-row, merge-reader-annotations,
 * metric-chart-data, metric-rows, metrics-overleaf, milestone, nav-open-groups, node-colouring,
 * one-euro, org, overleaf-bibtex, overleaf-error, overleaf-export-package, overleaf-upload.
 */
import {
  collectCitedKeys as rawCollectCitedKeys,
  createMilestoneWith,
  emaSmooth as rawEmaSmooth,
  entryFileError as rawEntryFileError,
  filterLabMembers as rawFilterLabMembers,
  filterTeamMembers as rawFilterTeamMembers,
  hasActiveLab as rawHasActiveLab,
  isSupervisorRole as rawIsSupervisorRole,
  joinBibtex as rawJoinBibtex,
  libraryBibtex as rawLibraryBibtex,
  loadOpenGroups as rawLoadOpenGroups,
  memberRowToDomain as rawMemberRowToDomain,
  membershipViewFromRow as rawMembershipViewFromRow,
  mergeReaderAnnotations as rawMergeReaderAnnotations,
  metricRowToDomain as rawMetricRowToDomain,
  milestoneInputError,
  NibFilter as RawNibFilter,
  OneEuroFilter as RawOneEuroFilter,
  ownedAssetFolderPaths as rawOwnedAssetFolderPaths,
  paperCiteKeys as rawPaperCiteKeys,
  paperToBibtex as rawPaperToBibtex,
  parseOverleafProjectId as rawParseOverleafProjectId,
  planSeriesIngestIndices as rawPlanSeriesIngestIndices,
  recolourNodes as rawRecolourNodes,
  redactOverleafErrorText as rawRedactOverleafErrorText,
  resolveDisplayRole as rawResolveDisplayRole,
  resolveOrgJoinAssignment as rawResolveOrgJoinAssignment,
  rewriteMcpConfig as rawRewriteMcpConfig,
  roleRank as rawRoleRank,
  rootFolderIdOf as rawRootFolderIdOf,
  sanitizeSectionTargets as rawSanitizeSectionTargets,
  setImagePlacement as rawSetImagePlacement,
  stepsToPrune as rawStepsToPrune,
  studentsOf as rawStudentsOf,
  validateComputeError,
  validateDependenciesError,
  validateNewMember as rawValidateNewMember,
  walkOverleafSections as rawWalkOverleafSections,
  withActive as rawWithActive,
  withMissingFigures as rawWithMissingFigures,
} from "../pkg/wf_wasm.js";
import type { OrgInviteRole, Role } from "@weaveforge/core";
import type {
  AlignedChart,
  ChartSeries,
  ComputeNeed,
  DependencyKind,
  FoundImageRef,
  ImagePlacementPatch,
  JoinAssignment,
  Member,
  MemberLink,
  Membership,
  MembershipRow,
  MetricPoint,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
  NewMember,
  NewMilestoneInput,
  OrgMembershipView,
  ProfileRow,
  ReportSectionTreeNode,
  TickFormat,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

export {
  alignSeries,
  canCreateRole,
  communities,
  creatableRoles,
  createMilestoneWith,
  degreeColours,
  encodeOpenGroups,
  findImageRefs,
  formatInviteCode,
  fromRelativeBlobLinks,
  imageAltFromFilename,
  imageExtensionForMime,
  imagePathsInBody,
  inkPositionOptions,
  inkPressureOptions,
  isElectronMcpEntry,
  isExplicitLabMembership,
  isIsoDay,
  isMissingServiceRole,
  isoDayFromParts,
  isOnSamplingGrid,
  isOverleafProjectId,
  markdownImage,
  mcpFileOf,
  milestoneInputError,
  needsMigrationHint,
  needsOrgSetup,
  needsStandaloneRoleSync,
  normalizeMarkdownImageSyntax,
  normalizeOrgInviteCode,
  oneEuroAlpha,
  overleafExternalUrl,
  overleafExternalUrl as externalUrl,
  overleafGitUrl,
  parseMdImageAlt,
  planAssetReanchor,
  rampColour,
  relativeAssetPaths,
  resolveSupervisorId,
  shouldSyncStandalone,
  strideForStep,
  stripUnresolvedImageRefs,
  tickFormat,
  toggleGroup,
  toRelativeBlobLinks,
  validateComputeError,
  validateDependenciesError,
  validateOrgName,
  withImageWidth,
  withMdImageAlt,
  workspaceBodies,
  yearColours,
} from "../pkg/wf_wasm.js";
export type {
  AlignedChart,
  AlignedSeries,
  ChartPoint,
  ChartSeries,
  Member,
  MembershipRow,
  MetricPoint,
  OrgMembershipView,
  ProfileRow,
  TickFormat,
} from "./bindings.js";

// --- markdown-images ---
/**
 * Markdown image and blob link helpers (Rust `markdown_images`), re-exported from index.ts.
 */
export type { FoundImageRef };

/** The folder paths the bodies already point at (Rust `owned_asset_folder_paths`). */
export function ownedAssetFolderPaths(bodies: readonly string[]): string[] {
  for (const body of bodies) checkIndexText(body);
  return rawOwnedAssetFolderPaths(bodies) as string[];
}

/** Rewrite the `ordinal`-th image whose alt is `alt` to the patched placement (Rust `set_image_placement`). */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: ImagePlacementPatch): string {
  // serde reads a key that is present as an explicit null, so an absent (undefined) field is dropped here to keep its value.
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return rawSetImagePlacement(body, alt, ordinal, fields);
}

// --- mcp-config-rewrite ---
/**
 * MCP client config rewrite (Rust `mcp_config_rewrite`), re-exported from index.ts.
 * Each function keeps the signature of apps/shell/sidecar/src/mcp-rewrite.ts.
 */
/** The config with every Electron entry for this launch's MCP file moved to `launch`. */
export function rewriteMcpConfig(
  config: unknown,
  key: "mcpServers" | "servers",
  launch: { command: string; args: string[]; env: Record<string, string> },
): { changed: boolean; config: unknown } {
  return rawRewriteMcpConfig(config, key, launch) as { changed: boolean; config: unknown };
}

// --- member-rows ---
/**
 * Lab member row mapping (Rust `member_rows`). The row shape stays in the web app, next to the
 * queries that select it.
 */
/** A `profiles` row as a lab member. Rust hands the role back as a plain string; the cast to the domain role is made here, once. */
export function memberRowToDomain(row: ProfileRow): Member {
  const raw = rawMemberRowToDomain(row) as Omit<Member, "role"> & { role: string };
  return { ...raw, role: raw.role as Role };
}

// --- membership-row ---
/**
 * Org membership row mapping (Rust `membership_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
/** A membership row as the membership view the app models. Rust hands the role back as a plain string; the cast to the invite role is made here, once. */
export function membershipViewFromRow(row: MembershipRow): OrgMembershipView {
  const raw = rawMembershipViewFromRow(row) as Omit<OrgMembershipView, "role"> & { role: string };
  return { ...raw, role: raw.role as OrgInviteRole };
}

// --- merge-reader-annotations ---
/**
 * Zotero-projected and local reader annotations merged (Rust
 * `reader::merge_annotations`), re-exported from index.ts.
 */
/**
 * Zotero and local rows as one list sorted by `sortIndex`. A local row wins on id
 * collision, and a Zotero row a local row already sent to Zotero is dropped.
 * Returns copies of the rows, not the same objects. Any row with `id`, `zoteroKey`
 * and `sortIndex` fits.
 */
export function mergeReaderAnnotations<T extends { id: string; zoteroKey?: string | null; sortIndex: string }>(
  zotero: readonly T[],
  local: readonly T[],
): T[] {
  return rawMergeReaderAnnotations(zotero, local) as T[];
}

// --- metric-chart-data ---
/**
 * Metric chart data (Rust `metric_chart_data`): the union step axis, EMA smoothing and the
 * tick-format decision. The tick strings are rendered in the web app, where `toFixed` and
 * `toExponential` define them.
 */
/** Debiased EMA over the non-gap values; gaps stay gaps. An `alpha` at or below zero is a no-op. */
export function emaSmooth(values: (number | null)[], alpha: number): (number | null)[] {
  return rawEmaSmooth(values, alpha) as (number | null)[];
}

// --- metric-rows ---
/**
 * Metric row mapping (Rust `metric_rows`). The row shape stays in the web app. A driver may hand
 * back `wall_time` as a `Date`; it is normalised to an ISO string here, before the row crosses
 * into wasm, so the Rust side only ever sees a string.
 */
/** A metric row as the driver returns it: `wall_time` may be a string, a `Date`, or nothing. */
export interface MetricRowInput {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | Date | null;
}

/** A metric row as a metric point. `wallTime` is an ISO string, or absent. */
export function metricRowToDomain(row: MetricRowInput): MetricPoint {
  const wallTime = row.wall_time instanceof Date ? row.wall_time.toISOString() : row.wall_time;
  return rawMetricRowToDomain({ ...row, wall_time: wallTime ?? null }) as MetricPoint;
}

// --- metrics-overleaf ---
/**
 * Metric downsampling (Rust `experiments`) and Overleaf link rules (Rust `overleaf`),
 * re-exported from index.ts. Signatures match the removed TS in
 * packages/core experiments/domain/downsample-metrics.ts and apps/web overleaf/domain/link-rules.ts.
 */
/** What to store for one series: grid points plus the newest, and a superseded tip to delete. */
export function planSeriesIngest<T extends { step: number }>(
  points: readonly T[],
  previousMaxStep: number | null,
): { keep: T[]; supersededTipStep: number | null } {
  const plan = rawPlanSeriesIngestIndices(
    Float64Array.from(points, (p) => p.step),
    previousMaxStep ?? undefined,
  ) as { keep: number[]; supersededTipStep: number | null };
  return { keep: plan.keep.map((i) => points[i]!), supersededTipStep: plan.supersededTipStep ?? null };
}

/** Steps to delete from a stored series: off-grid steps, except the newest. */
export function stepsToPrune(storedSteps: readonly number[]): number[] {
  return Array.from(rawStepsToPrune(Float64Array.from(storedSteps)));
}

/** The message for an unsafe entry file path, or null. */
export function entryFileError(entryFile: string): string | null {
  return rawEntryFileError(entryFile) ?? null;
}

/** The project id from a pasted id, project page or git URL; null otherwise. */
export function parseOverleafProjectId(raw: string): string | null {
  return rawParseOverleafProjectId(raw) ?? null;
}

/** The { sectionKey -> targetWords } map with null targets dropped, or null when malformed. */
export function sanitizeSectionTargets(input: unknown): Record<string, number> | null {
  return (rawSanitizeSectionTargets(input) as Record<string, number> | null) ?? null;
}

/** Indices of the steps to keep and the superseded tip (Rust `plan_series_ingest`). */
export function planSeriesIngestIndices(
  steps: Float64Array,
  previousMaxStep?: number | null,
): { keep: number[]; supersededTipStep: number | null } {
  return rawPlanSeriesIngestIndices(steps, previousMaxStep) as { keep: number[]; supersededTipStep: number | null };
}

// --- milestone ---
/**
 * Milestone domain rules (Rust `milestone`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/plan/domain/milestone.ts.
 */
/** Every milestone status. */
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["planned", "in_progress", "done", "blocked"];

/** Every dependency kind. */
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ["milestone", "experiment", "paper", "external"];

/** Throws `MilestoneValidationError` with the Rust validation message, if there is one. */
function throwIfInvalid(message: string | undefined): void {
  if (message == null) return;
  const error = new Error(message);
  error.name = "MilestoneValidationError";
  throw error;
}

/** Validate a dependency list; throws on structurally invalid entries. */
export function validateDependencies(deps: MilestoneDependency[]): void {
  throwIfInvalid(validateDependenciesError(deps));
}

/** Validate compute needs; throws on invalid entries. */
export function validateCompute(compute: ComputeNeed[]): void {
  throwIfInvalid(validateComputeError(compute));
}

/** A new milestone from caller input. Throws `MilestoneValidationError` before drawing an id. */
export function createMilestone(
  input: NewMilestoneInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): Milestone {
  throwIfInvalid(milestoneInputError(input));
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return createMilestoneWith(input, id, now);
}

// --- nav-open-groups ---
/**
 * Which sidebar groups are unfolded (Rust `nav_open_groups`), re-exported from
 * index.ts. The localStorage I/O lives in the web app, not here.
 */
/** The group you are in is always open, so `active` is added when it is not listed. */
export function withActive(groups: readonly string[], active: string | null): string[] {
  return rawWithActive(groups, active ?? undefined) as string[];
}

/** The open groups from the stored JSON (`null` when none), with `active` forced open. */
export function loadOpenGroups(raw: string | null, active: string | null): string[] {
  return rawLoadOpenGroups(raw ?? undefined, active ?? undefined) as string[];
}

// --- node-colouring ---
/**
 * Graph node colours (Rust `node_colouring`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/node-colouring.ts.
 */
/** The node fields recolouring reads. `color` is written back in place. */
export interface RecolourableNode {
  id: string;
  label: string;
  color: string;
  paperId?: string;
  year?: number;
  tagName?: string;
}

/** The lookups recolouring needs beyond the nodes and links. */
export interface RecolourLookups {
  papers: ReadonlyMap<string, { id: string; title: string; status?: string; tags: readonly string[] }>;
  /** Hashtags per note id. */
  noteTags: ReadonlyMap<string, readonly string[]>;
  /** Paper ids per list id. */
  membership: ReadonlyMap<string, ReadonlySet<string>>;
  lists: readonly { id: string; name: string }[];
}

/**
 * Applies a graph-wide colour mode (`year`, `degree`, `cluster`, `groups`) to the
 * nodes in place. Other modes leave the nodes as built.
 */
export function recolourNodes(
  nodes: RecolourableNode[],
  links: readonly { source: string; target: string }[],
  colorBy: string,
  groups: readonly { query: string; color: string }[],
  ctx: RecolourLookups,
): void {
  const colours = rawRecolourNodes(nodes, links, colorBy, groups, {
    papers: Object.fromEntries(ctx.papers),
    noteTags: Object.fromEntries(ctx.noteTags),
    membership: Object.fromEntries([...ctx.membership].map(([id, set]) => [id, [...set]])),
    lists: ctx.lists,
  }) as string[] | null;
  if (colours) nodes.forEach((n, i) => {
    n.color = colours[i]!;
  });
}

// --- one-euro ---
/**
 * The 1-Euro pen filter (Rust `ink::one_euro`): the smoothing factor and the
 * stateful filter handles the pen path holds across samples.
 */
// Narrowed by hand: Specta exports every f64 as `number | null`, but the filter
// only ever sees and returns finite numbers.

/** One channel's tuning: cutoffs in hertz, beta unitless. */
export interface OneEuroOptions {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
}

/** One raw pen sample: position in 0.1 mm, pressure 0..1, time in ms. */
export interface NibSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

/** A filtered pen sample, with the velocity the taper reads. */
export interface FilteredNibSample {
  x: number;
  y: number;
  pressure: number;
  velocity: number;
  t: number;
}

/** One scalar channel (Rust `OneEuroFilter`), held across calls. */
export class OneEuroFilter {
  private readonly raw: RawOneEuroFilter;

  constructor(options: OneEuroOptions) {
    this.raw = new RawOneEuroFilter(options);
  }

  /** The last filtered value, or `null` before the first sample. */
  get last(): number | null {
    return this.raw.last ?? null;
  }

  /** The last estimated speed, in value units per millisecond. */
  get speed(): number {
    return this.raw.speed;
  }

  /** Forget everything. Called at pen-down: a new stroke is a new signal. */
  reset(): void {
    this.raw.reset();
  }

  filter(value: number, time: number): number {
    return this.raw.filter(value, time);
  }
}

/** The pen-level filter (Rust `NibFilter`): position and pressure as one state. */
export class NibFilter {
  private readonly raw: RawNibFilter;

  constructor(options: { position: OneEuroOptions; pressure: OneEuroOptions }) {
    this.raw = new RawNibFilter(options.position, options.pressure);
  }

  /**
   * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
   * rather than filtered: the velocity taper is a drawing property.
   */
  get speed(): number {
    return this.raw.speed;
  }

  /** Start a new stroke: no state carries over from the last one. */
  reset(): void {
    this.raw.reset();
  }

  /** Snapshot the filter now; the returned function restores that snapshot. */
  save(): () => void {
    const snapshot = this.raw.save();
    return () => this.raw.restore(snapshot);
  }

  filter(sample: NibSample): FilteredNibSample {
    // Rust returns exactly [x, y, pressure, velocity, t].
    const [x, y, pressure, velocity, t] = this.raw.filter(
      sample.x,
      sample.y,
      sample.pressure,
      sample.t,
    ) as unknown as [number, number, number, number, number];
    return { x, y, pressure, velocity, t };
  }
}

// --- org ---
/**
 * Lab member and org rules (Rust `member` and `org`), re-exported from index.ts. Keeps
 * the signatures of the functions in packages/core/src/features/org/domain/ and
 * apps/web/src/features/org/application/ that they replace. Functions that return
 * members return them from the input array (the Rust side returns indices).
 */
/** What a viewer may see of a lab. `orgMemberIds` is the active lab's roster, if known. */
function wireVisibility(options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null }) {
  return {
    inLab: options.inLab,
    orgMemberIds: options.orgMemberIds ? [...options.orgMemberIds] : null,
  };
}

function pick<T>(items: readonly T[], indices: readonly number[]): T[] {
  return indices.map((i) => items[i] as T);
}

/** The supervision team: the viewer plus all supervisees, at any depth. */
export function filterTeamMembers<T extends MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[] {
  return pick(members, rawFilterTeamMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The full active-lab roster, for the org chart. */
export function filterLabMembers<T extends MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[] {
  return pick(members, rawFilterLabMembers(viewerId, members, wireVisibility(options)) as number[]);
}

/** The people below `viewerId` in the supervisor tree, at any depth. */
export function studentsOf<T extends MemberLink>(viewerId: string | undefined, team: readonly T[]): T[] {
  return pick(team, rawStudentsOf(viewerId ?? undefined, team) as number[]);
}

/** Rank of a role: standalone -1, masters 0, phd 1, professor 2. `undefined` for an unknown role. */
export function roleRank(role: string): number | undefined {
  return rawRoleRank(role) ?? undefined;
}

/** Whether a role can supervise others (rank above masters). */
export function isSupervisorRole(role: string | null | undefined): boolean {
  return rawIsSupervisorRole(role ?? undefined);
}

/** Role shown for a member: standalone outside a lab, except an owner's professor. */
export function resolveDisplayRole(
  role: string,
  opts: { inLab: boolean; ownsOrg?: boolean },
): string {
  return rawResolveDisplayRole(role, opts.inLab, opts.ownsOrg ?? false);
}

/** Whether the active lab is set and the user is explicitly in it, or owns it. */
export function hasActiveLab(
  activeOrgId: string | null | undefined,
  memberships: readonly Membership[],
  ownsActiveOrg = false,
): boolean {
  return rawHasActiveLab(activeOrgId ?? undefined, memberships, ownsActiveOrg);
}

/**
 * Validate and normalize a new member; absent optional fields are left out rather than null. Throws an `Error` named `MemberValidationError`. */
export function validateNewMember(
  input: Pick<NewMember, "email" | "password" | "role"> & Partial<Pick<NewMember, "fullName" | "supervisorId">>,
): Omit<NewMember, "fullName" | "supervisorId"> & { fullName?: string; supervisorId?: string } {
  let member: NewMember;
  try {
    member = rawValidateNewMember(
      input.email,
      input.password,
      input.fullName ?? undefined,
      input.role,
      input.supervisorId ?? undefined,
    ) as NewMember;
  } catch (thrown) {
    if (typeof thrown !== "string") throw thrown;
    const error = new Error(thrown);
    error.name = "MemberValidationError";
    throw error;
  }
  return { ...member, fullName: member.fullName ?? undefined, supervisorId: member.supervisorId ?? undefined };
}

/**
 * Pick the joiner's role and supervisor from the invite type and the lab's members.
 * Throws the validation message as a string.
 */
export function resolveOrgJoinAssignment(
  targetRole: string,
  professorIds: readonly string[],
  phdIds: readonly string[],
  professorSupervisorId?: string | null,
  phdSupervisorId?: string | null,
): JoinAssignment {
  return rawResolveOrgJoinAssignment(
    targetRole,
    professorIds,
    phdIds,
    professorSupervisorId ?? undefined,
    phdSupervisorId ?? undefined,
  ) as JoinAssignment;
}

// --- overleaf-bibtex ---
/**
 * The Overleaf BibTeX export helpers (Rust `overleaf::bibtex`), re-exported from index.ts.
 * The paper input is the subset of `Paper` the entries read; a `Paper` satisfies it. The cite-key
 * fields are flattened from `metadata` here, as the Rust side expects them at the top level.
 */
/** The paper fields a `.bib` entry reads, as a `Paper` supplies them. */
export interface BibPaperInput {
  id: string;
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  bibtex?: string;
  metadata?: Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toBibPaper(paper: BibPaperInput) {
  const meta = paper.metadata ?? {};
  return {
    id: paper.id,
    title: paper.title,
    authors: [...(paper.authors ?? [])],
    year: typeof paper.year === "number" ? paper.year : undefined,
    venue: paper.venue,
    doi: paper.doi,
    arxivId: paper.arxivId,
    url: paper.url,
    bibtex: paper.bibtex,
    citeKey: stringField(meta["citeKey"]),
    citationKey: stringField(meta["citationKey"]),
    extra: stringField(meta["extra"]),
  };
}

/** One cite key per paper, in order and unique across the list. */
export function paperCiteKeys(papers: readonly BibPaperInput[]): string[] {
  return rawPaperCiteKeys(papers.map(toBibPaper));
}

/** The cite keys a LaTeX body cites, from its `\cite{...}` commands. */
export function collectCitedKeys(latex: string): Set<string> {
  return new Set<string>(rawCollectCitedKeys(latex));
}

/** One `.bib` entry under `key`. A stored entry is reused with its key replaced. */
export function paperToBibtex(paper: BibPaperInput, key: string): string {
  return rawPaperToBibtex(toBibPaper(paper), key);
}

/** The `.bib` text for entries already rendered, one blank line apart. */
export function joinBibtex(entries: readonly string[]): string {
  return rawJoinBibtex([...entries]);
}

/** The whole library as one `.bib`, with the keys the export gives each paper. */
export function libraryBibtex(papers: readonly BibPaperInput[]): string {
  return rawLibraryBibtex(papers.map(toBibPaper));
}

// --- overleaf-error ---
/**
 * Overleaf error text redaction (Rust `overleaf::error_redact`), re-exported from index.ts. The
 * caller formats the thrown value first; this removes the token and URL credentials and caps the
 * length at 500 UTF-16 units.
 */
/** The text with `token` replaced by `[redacted]` and URL credentials removed, at most 500 units. */
export function redactOverleafErrorText(raw: string, token?: string): string {
  return rawRedactOverleafErrorText(raw, token || undefined);
}

// --- overleaf-export-package ---
/**
 * Overleaf export package steps (Rust `overleaf_export_package`), re-exported from index.ts:
 * the section walk that builds `main.tex`'s body, and the manifest rewrite for missing figures.
 * Object shapes come from ./bindings.ts where they exist; the walk and file types are declared here.
 */
/** A file in the export package: its path inside the package and its text. */
export interface OverleafExportFile {
  path: string;
  contents: string;
}

/** A binary figure to fetch and place under `figures/`. */
export interface OverleafExportImage {
  /** Storage path after `reportimg:` (ownerId/sectionId/file). */
  storagePath: string;
  /** Relative ZIP path, e.g. `figures/uuid.webp`. */
  zipPath: string;
}

/** Counts the section walk adds to the export stats. */
export interface OverleafWalkStats {
  sections: number;
  equationsApprox: number;
  figures: number;
}

/** The section walk's result. */
export interface OverleafSectionWalk {
  /** Body lines for `main.tex`. */
  out: string[];
  warnings: string[];
  images: OverleafExportImage[];
  stats: OverleafWalkStats;
}

/** Options for {@link walkOverleafSections}. */
export interface OverleafWalkOptions {
  includeNotes: boolean;
  /** Normalized paper title to bib key; when set, `[[wikilinks]]` become `\cite{key}`. */
  citeByTitle?: ReadonlyMap<string, string>;
}

/**
 * Walk the report outline into the `main.tex` body, warnings, figures and counts. Pure; the
 * Map is passed to Rust as a plain object.
 */
export function walkOverleafSections(
  tree: readonly ReportSectionTreeNode[],
  opts: OverleafWalkOptions,
): OverleafSectionWalk {
  const citeByTitle = opts.citeByTitle ? Object.fromEntries(opts.citeByTitle) : undefined;
  return rawWalkOverleafSections(tree, { includeNotes: opts.includeNotes, citeByTitle }) as OverleafSectionWalk;
}

/**
 * The files with `manifest.json` rewritten for figures whose blobs could not be loaded. Rust
 * returns a new array; the app wrapper keeps the no-missing identity.
 */
export function withMissingFigures(
  files: readonly OverleafExportFile[],
  missing: readonly OverleafExportImage[],
): OverleafExportFile[] {
  return rawWithMissingFigures(files, missing) as OverleafExportFile[];
}

// --- overleaf-upload ---
/**
 * Overleaf root folder id from the join answer (Rust `overleaf::upload`), re-exported from index.ts.
 */
/** The project's root folder id, or null when the project is read-only or the answer has none. */
export function rootFolderIdOf(join: readonly unknown[]): string | null {
  return rawRootFolderIdOf(join) ?? null;
}
