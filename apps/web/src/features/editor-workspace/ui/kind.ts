/**
 * Every per-kind decision in the editor workspace, in one table.
 *
 * Delete a branch here and the explorer, the tabs, the breadcrumbs, the
 * document host and the status bar all lose that decision together, because
 * none of them asks what a document *is* — they ask this table.
 *
 * The kinds are the `TreeNodeKind`s the explorer can show (see
 * `workspace-tree.ts`), which are the `WorkspaceEntityType`s the folder layout
 * knows about plus the grouping-only `folder`. Unknown kinds are not an error
 * and not a crash: a document kind added in `packages/core` before this table
 * has heard of it reads as a plain text document with the fallback icon, which
 * is the honest answer and keeps a core change from breaking this screen.
 *
 * Ink (`.ink.md`, §3.3 of the design) is not built. When it lands it is one row
 * here — `pencil`, the ink tint, `document: "ink"` — and one case in
 * `document-host.tsx`. Nothing else in the screen learns a new word.
 */

import { KIND_SUFFIX } from "@weaveforge/core";

import type { TreeNodeKind } from "../application/workspace-tree";
import type { SegmentKey } from "./status-bar";

export const KINDS: readonly TreeNodeKind[] = [
  "vault_page",
  "paper",
  "reading_list",
  "report_section",
  "experiment",
  "milestone",
  "log_entry",
  "folder",
];

/** `icon` is a `nav-icon.tsx` handle; `fallback` is the same handle. */
export const FALLBACK_KIND = "folder";

/** The two tints a kind can carry. No colour is written anywhere but here. */
export type KindTint = "info" | "warn" | "accent" | "good" | "neutral";

export interface KindMeta {
  /** A `nav-icon.tsx` glyph handle — the same icon the nav uses for the entity. */
  icon: string;
  tint: KindTint;
  /** The `.md` suffix the UI appends, or `null` where there is no file. */
  suffix: string | null;
  /** What the pane mounts for this kind. `text` is the shipped editor. */
  document: "text" | "ink";
  /** Status-bar segments for this kind, in paint order. */
  segments: readonly SegmentKey[];
  /**
   * Whether a row of this kind is a *document* — something with an id that can
   * be opened, saved and counted — as opposed to a grouping row. The explorer
   * asks this instead of comparing against `"folder"` by name, and an Outline
   * heading row is the other thing that is not a document.
   */
  documentRow: boolean;
  /**
   * The order member rows take inside a reading list: papers before notes.
   * `null` where the kind never appears as a list member.
   */
  memberOrder: number | null;
  /**
   * Which of Read mode's wikilink lookup tables this kind resolves against, or
   * `null` where a `[[link]]` cannot point at it. `VaultMarkdown` takes exactly
   * these three lists, so a kind's answer here is what makes a link to it work.
   */
  linkGroup: "notes" | "papers" | "sections" | null;
  /**
   * Whether the workspace can make one of these from a title — the explorer's
   * "New note", the new-note chord, a "Create note" completion row, a click on
   * an unresolved link — and nest it under another of its kind. Only notes: a
   * paper needs its metadata and a section its place in the report.
   */
  creatable: boolean;
}

const TEXT_SEGMENTS = ["words", "chars", "cursor", "encoding", "language"] as const;

export const KIND_TABLE: Record<TreeNodeKind, KindMeta> = {
  // A grouping row: it is not a document, so it has no file, no words and no
  // place as a list member, and nothing can link to it.
  folder: {
    icon: "folder",
    tint: "neutral",
    suffix: null,
    document: "text",
    segments: [],
    documentRow: false,
    memberOrder: null,
    linkGroup: null,
    creatable: false,
  },
  vault_page: {
    icon: "notes",
    tint: "info",
    suffix: ".note.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    // Papers first, then notes; `10` and `20` leave room for a kind between.
    memberOrder: 20,
    linkGroup: "notes",
    creatable: true,
  },
  paper: {
    icon: "book",
    tint: "warn",
    suffix: ".paper.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: 10,
    linkGroup: "papers",
    creatable: false,
  },
  reading_list: {
    icon: "list",
    tint: "accent",
    suffix: ".list.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: null,
    linkGroup: null,
    creatable: false,
  },
  report_section: {
    icon: "doc",
    tint: "good",
    suffix: ".report.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: null,
    linkGroup: "sections",
    creatable: false,
  },
  experiment: {
    icon: "flask",
    tint: "warn",
    suffix: ".experiment.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: null,
    linkGroup: null,
    creatable: false,
  },
  milestone: {
    icon: "flag",
    tint: "neutral",
    suffix: ".milestone.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: null,
    linkGroup: null,
    creatable: false,
  },
  log_entry: {
    icon: "pencil",
    tint: "neutral",
    suffix: ".log.md",
    document: "text",
    segments: TEXT_SEGMENTS,
    documentRow: true,
    memberOrder: null,
    linkGroup: null,
    creatable: false,
  },
};

/** The table row for a kind, or the folder row for anything unknown. */
export function kindMeta(kind: string): KindMeta {
  return (KIND_TABLE as Record<string, KindMeta | undefined>)[kind] ?? KIND_TABLE[FALLBACK_KIND];
}

/** The icon handle for a kind — what `NavIcon` should draw. */
export function kindIcon(kind: string): string {
  return kindMeta(kind).icon;
}

/**
 * Whether a row of this kind is a document that can be opened and saved.
 *
 * The alternative is `kind === "folder"` at every call site, which is a per-kind
 * decision taken outside the table — exactly what §3.3 forbids, and what would
 * need editing again when ink's heading rows arrive.
 */
export function isDocumentKind(kind: string): boolean {
  return kindMeta(kind).documentRow;
}

/** Papers before notes inside a reading list, by the table's own ordering. */
export function memberRank(kind: string): number {
  return kindMeta(kind).memberOrder ?? Number.MAX_SAFE_INTEGER;
}

/** Which wikilink lookup table a kind resolves against, or `null`. */
export function linkGroupOf(kind: string): KindMeta["linkGroup"] {
  return kindMeta(kind).linkGroup;
}

/** Whether the workspace can make a document of this kind from a title. */
export function isCreatableKind(kind: string): boolean {
  return kindMeta(kind).creatable;
}

/**
 * The tint class a kind reads at a glance by, or `null` where the kind carries
 * no tint. Returned as a class fragment so the stylesheet owns the colour:
 * `kind-tint-info` resolves to `--s-info`.
 */
export function kindTintClass(kind: string): string | null {
  const tint = kindMeta(kind).tint;
  return tint === "neutral" ? null : `kind-tint-${tint}`;
}

/**
 * The tint for a row's icon, which for a folder depends on whether it is open.
 *
 * A folder is `--faint` closed and `--accent` open — the treatment the
 * prototype gives the `Notes` root, and the only per-kind decision here that
 * takes a second input. It lives in this table rather than in the row markup so
 * the "no `kind ===` outside these tables" rule holds everywhere.
 */
export function kindIconClass(kind: string, open = false): string | null {
  if (!isDocumentKind(kind)) return open ? "kind-tint-accent" : null;
  return kindTintClass(kind);
}

/**
 * The suffix shown after a title, computed from `KIND_SUFFIX` and never typed.
 *
 * `KIND_SUFFIX` is what the mirrored folder writes into the filename; the
 * table above carries the answer the UI shows so the editor does not have to
 * know how core spells a kind. Where the two disagree this returns the
 * filename's spelling, because that is the one on disk.
 */
export function kindSuffix(kind: string): string | null {
  const suffix = (KIND_SUFFIX as Record<string, string | undefined>)[kind];
  if (suffix) return `.${suffix}.md`;
  return kindMeta(kind).suffix;
}

/** The suffix for a kind that is definitely not a folder. */
export function documentSuffix(kind: string): string {
  return kindSuffix(kind) ?? "";
}

/** Which renderer a kind mounts. */
export function documentKind(kind: string): KindMeta["document"] {
  return kindMeta(kind).document;
}

/** The status-bar segments for a kind. `[]` for anything unknown. */
export function segmentsFor(kind: string): readonly SegmentKey[] {
  return kindMeta(kind).segments;
}

/** The label a tab, crumb and palette row append to a title. */
export function labelledTitle(title: string, kind: string): string {
  const suffix = kindSuffix(kind);
  return suffix ? `${title}${suffix}` : title;
}
