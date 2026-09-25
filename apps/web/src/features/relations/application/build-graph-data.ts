import {
  RELATION_TYPES,
  extractHashtags,
  extractWikilinks,
  normalizeTitleKey,
  type GraphExperimentEntry,
  type Paper,
  type PaperRelation,
  type ReadingList,
  type RelationType,
  type ReportSection,
  type VaultPage,
} from "@weaveforge/core";
import { listDisplayColor } from "@/features/reading-lists";
// The palette lives in a leaf module so that consumers wanting only a colour
// do not pull this file's feature imports along with it.
import {
  RELATION_COLORS,
  STATUS_COLORS,
  tagColor,
  NOTE_COLOR,
  WIKILINK_COLOR,
  REPORT_COLOR,
  EXPERIMENT_COLOR,
  EXPERIMENT_LINK_COLOR,
} from "../domain/graph-palette";
import {
  effectiveRelationTypes,
  showConceptEdges,
  showRelationEdges,
  type ColorBy,
  type GraphViewSettings,
  type GroupBy,
} from "@weaveforge/core";

export interface GNode {
  id: string;
  kind: "paper" | "tag" | "note" | "report" | "experiment";
  label: string;
  val: number;
  color: string;
  paperId?: string;
  /** Publication year, when the paper carries one. Drives the timeline layout. */
  year?: number;
  noteId?: string;
  sectionId?: string;
  tagName?: string;
  experimentId?: string;
  /** A run's status, for the side panel and the tooltip. */
  experimentStatus?: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

export interface GLink {
  id: string;
  source: string;
  target: string;
  color: string;
  width: number;
  kind: "rel" | "tag" | "concept" | "wikilink" | "experiment";
  relation?: RelationType;
  relationId?: string;
  sourceKind?: "manual" | "auto";
  dashed?: boolean;
}

/**
 * A run, as the graph draws it — `GraphExperimentEntry` from core.
 *
 * Re-exported under this file's own name so the builder, its tests and the
 * canvas all say `ExperimentEntry` while there is one definition of the shape
 * and it lives in the layer the container's facade can also reach.
 */
export type ExperimentEntry = GraphExperimentEntry;

export interface GraphBuildResult {
  data: { nodes: GNode[]; links: GLink[] };
  neighbors: Map<string, Set<string>>;
  tagToPapers: Map<string, string[]>;
  tagToNotes: Map<string, string[]>;
}

function noteTags(note: Pick<VaultPage, "title" | "body">): string[] {
  return extractHashtags(`${note.title}\n${note.body}`);
}

function paperColor(
  p: Paper,
  colorBy: ColorBy,
  groupBy: GroupBy,
  membership: Map<string, Set<string>>,
  lists: ReadingList[],
): string {
  if (colorBy === "tag") return p.tags[0] ? tagColor(p.tags[0]) : "#b9b2a6";
  if (colorBy === "list" || groupBy === "list") {
    const list = lists.find((l) => membership.get(l.id)?.has(p.id));
    return list ? listDisplayColor(list) : STATUS_COLORS[p.status] ?? "#b9b2a6";
  }
  return STATUS_COLORS[p.status] ?? "#b9b2a6";
}

function isOrphan(p: Paper, relDegree: Map<string, number>, tagCount: number): boolean {
  return (relDegree.get(p.id) ?? 0) === 0 && tagCount === 0;
}

/** Pure graph builder: papers, notes, report sections, relations, concepts → force-graph. */
export function buildGraphData(
  papers: Paper[],
  relations: PaperRelation[],
  settings: GraphViewSettings,
  membership: Map<string, Set<string>> = new Map(),
  lists: ReadingList[] = [],
  notes: VaultPage[] = [],
  sections: ReportSection[] = [],
  experiments: ExperimentEntry[] = [],
): GraphBuildResult {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const degree = new Map<string, number>();
  const relDegree = new Map<string, number>();
  const bump = (id: string, rel = false) => {
    degree.set(id, (degree.get(id) ?? 0) + 1);
    if (rel) relDegree.set(id, (relDegree.get(id) ?? 0) + 1);
  };

  const allowedTypes = new Set(effectiveRelationTypes(settings));
  const paperIds = new Set(papers.map((p) => p.id));

  /**
   * A run is drawn only when it has a paper to sit beside.
   *
   * `relatedPaper` is the one edge an experiment carries, and an unlinked run
   * would be a node with nothing attached — which is exactly what `hideOrphans`
   * exists to keep off the canvas. Its paper must also be one the graph is
   * actually showing: a run pointing at a paper filtered out by the settings
   * elsewhere would otherwise contribute a node and an edge to nowhere, and the
   * link filter at the end would drop the edge while keeping the node.
   */
  const linkedExperiments = experiments.filter(
    (e) => e.relatedPaper !== undefined && paperIds.has(e.relatedPaper),
  );

  if (showRelationEdges(settings)) {
    for (const e of relations) {
      if (!paperIds.has(e.fromPaper) || !paperIds.has(e.toPaper)) continue;
      if (!allowedTypes.has(e.relation)) continue;
      links.push({
        id: e.id,
        source: e.fromPaper,
        target: e.toPaper,
        color: RELATION_COLORS[e.relation],
        width: (e.source === "auto" ? 0.8 : 1.6) * settings.linkThickness,
        kind: "rel",
        relation: e.relation,
        relationId: e.id,
        sourceKind: e.source,
        dashed: settings.showAutoStyle && e.source === "auto",
      });
      bump(e.fromPaper, true);
      bump(e.toPaper, true);
    }
  }

  const tagUse = new Map<string, number>();
  const paperTagCount = new Map<string, number>();
  const noteTagCount = new Map<string, number>();
  if (showConceptEdges(settings)) {
    for (const p of papers) {
      for (const t of p.tags) {
        tagUse.set(t, (tagUse.get(t) ?? 0) + 1);
        paperTagCount.set(p.id, (paperTagCount.get(p.id) ?? 0) + 1);
        const tagId = `tag:${t}`;
        links.push({
          id: `pt:${p.id}:${t}`,
          source: p.id,
          target: tagId,
          color: tagColor(t),
          width: 0.6 * settings.linkThickness,
          kind: "tag",
        });
        bump(p.id);
        bump(tagId);
      }
    }
    for (const n of notes) {
      for (const t of noteTags(n)) {
        tagUse.set(t, (tagUse.get(t) ?? 0) + 1);
        noteTagCount.set(n.id, (noteTagCount.get(n.id) ?? 0) + 1);
        const tagId = `tag:${t}`;
        links.push({
          id: `nt:${n.id}:${t}`,
          source: n.id,
          target: tagId,
          color: tagColor(t),
          width: 0.6 * settings.linkThickness,
          kind: "tag",
        });
        bump(n.id);
        bump(tagId);
      }
    }
  }

  const minDeg = Math.max(1, settings.minConceptDegree);
  const visibleTags = new Set<string>();
  for (const [t, count] of tagUse) {
    if (count >= minDeg) visibleTags.add(t);
  }

  if (settings.showConceptCooccurrence) {
    const itemsByTag = new Map<string, string[]>();
    for (const p of papers) {
      for (const t of p.tags) {
        if (!visibleTags.has(t)) continue;
        const arr = itemsByTag.get(t) ?? [];
        arr.push(p.id);
        itemsByTag.set(t, arr);
      }
    }
    for (const n of notes) {
      for (const t of noteTags(n)) {
        if (!visibleTags.has(t)) continue;
        const arr = itemsByTag.get(t) ?? [];
        arr.push(n.id);
        itemsByTag.set(t, arr);
      }
    }
    const tagList = [...visibleTags];
    for (let i = 0; i < tagList.length; i++) {
      for (let j = i + 1; j < tagList.length; j++) {
        const a = tagList[i]!;
        const b = tagList[j]!;
        const setA = new Set(itemsByTag.get(a) ?? []);
        const shared = (itemsByTag.get(b) ?? []).some((id) => setA.has(id));
        if (!shared) continue;
        links.push({
          id: `cc:${a}:${b}`,
          source: `tag:${a}`,
          target: `tag:${b}`,
          color: "rgba(140, 133, 124, 0.35)",
          width: 0.4,
          kind: "concept",
        });
        bump(`tag:${a}`);
        bump(`tag:${b}`);
      }
    }
  }

  const tagToPapers = new Map<string, string[]>();
  const tagToNotes = new Map<string, string[]>();
  for (const p of papers) {
    for (const t of p.tags) {
      const arr = tagToPapers.get(t) ?? [];
      arr.push(p.id);
      tagToPapers.set(t, arr);
    }
  }
  for (const n of notes) {
    for (const t of noteTags(n)) {
      const arr = tagToNotes.get(t) ?? [];
      arr.push(n.id);
      tagToNotes.set(t, arr);
    }
  }

  // Direct [[wikilink]] edges from vault / paper notes / report sections.
  const wikiLinked = new Set<string>();
  {
    const noteByTitle = new Map<string, string>();
    for (const n of notes) noteByTitle.set(normalizeTitleKey(n.title), n.id);
    const paperByTitle = new Map<string, string>();
    for (const p of papers) paperByTitle.set(normalizeTitleKey(p.title), p.id);
    const sectionByTitle = new Map<string, string>();
    for (const s of sections) sectionByTitle.set(normalizeTitleKey(s.title), s.id);
    const resolveTarget = (key: string, sourceId: string): string | undefined => {
      const noteId = noteByTitle.get(key);
      if (noteId && noteId !== sourceId) return noteId;
      const paperId = paperByTitle.get(key);
      if (paperId && paperId !== sourceId) return paperId;
      const sectionId = sectionByTitle.get(key);
      if (sectionId && sectionId !== sourceId) return sectionId;
      return undefined;
    };
    const seen = new Set<string>();
    const addWikiEdges = (sourceId: string, body: string | undefined) => {
      if (!body) return;
      for (const ref of extractWikilinks(body)) {
        const key = normalizeTitleKey(ref.target);
        if (!key) continue;
        const targetId = resolveTarget(key, sourceId);
        if (!targetId) continue;
        const id = `wl:${sourceId}:${targetId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        links.push({
          id,
          source: sourceId,
          target: targetId,
          color: WIKILINK_COLOR,
          width: 1.2 * settings.linkThickness,
          kind: "wikilink",
        });
        bump(sourceId);
        bump(targetId);
        wikiLinked.add(sourceId);
        wikiLinked.add(targetId);
      }
    };
    for (const n of notes) addWikiEdges(n.id, n.body);
    for (const p of papers) addWikiEdges(p.id, p.summary);
    for (const s of sections) addWikiEdges(s.id, s.notes);
  }

  for (const p of papers) {
    const tagsOnPaper = p.tags.filter((t) => !showConceptEdges(settings) || visibleTags.has(t));
    if (
      settings.hideOrphans &&
      isOrphan(p, relDegree, paperTagCount.get(p.id) ?? 0) &&
      tagsOnPaper.length === 0 &&
      !wikiLinked.has(p.id)
    ) {
      continue;
    }
    nodes.push({
      id: p.id,
      kind: "paper",
      label: p.title,
      val: (2 + Math.sqrt(degree.get(p.id) ?? 0) * 2) * settings.nodeSize,
      color: paperColor(p, settings.colorBy, settings.groupBy, membership, lists),
      paperId: p.id,
      year: typeof p.year === "number" && Number.isFinite(p.year) ? p.year : undefined,
    });
  }

  for (const n of notes) {
    const tagsOnNote = noteTags(n).filter((t) => !showConceptEdges(settings) || visibleTags.has(t));
    if (
      settings.hideOrphans &&
      (noteTagCount.get(n.id) ?? 0) === 0 &&
      tagsOnNote.length === 0 &&
      !wikiLinked.has(n.id)
    ) {
      continue;
    }
    nodes.push({
      id: n.id,
      kind: "note",
      label: n.title,
      val: (1.8 + Math.sqrt(degree.get(n.id) ?? 0) * 1.8) * settings.nodeSize,
      color: NOTE_COLOR,
      noteId: n.id,
    });
  }

  for (const s of sections) {
    if (settings.hideOrphans && !wikiLinked.has(s.id)) continue;
    nodes.push({
      id: s.id,
      kind: "report",
      label: s.title,
      val: (1.8 + Math.sqrt(degree.get(s.id) ?? 0) * 1.8) * settings.nodeSize,
      color: REPORT_COLOR,
      sectionId: s.id,
    });
  }

  /**
   * Runs, each hanging off the paper it tests.
   *
   * A run is the record of *doing* the work a paper proposes, and until now the
   * graph showed only the papers — so the one artefact a reader produces
   * themselves was the one thing the picture of their research left out.
   * Attaching it to `relatedPaper` rather than to a note or a tag is not a
   * choice: that field is the only link a run carries.
   *
   * Sized a step below a note, so a paper with four runs does not have those
   * runs out-weigh the paper they hang from.
   *
   * Note what is *not* here: `bump(e.relatedPaper)`. The paper's node — and so
   * its `val`, which is derived from its degree — was created above this loop,
   * so incrementing the paper's degree now would change nothing the canvas
   * reads. It looks like it connects the run to its paper and does not: the
   * edge in `links` is what does that, and `neighbors` is built from the links
   * at the end. An earlier version of this loop carried the call, which is a
   * line of code asserting a relationship the data model already expresses.
   */
  for (const e of linkedExperiments) {
    links.push({
      id: `exp:${e.id}`,
      source: e.relatedPaper!,
      target: e.id,
      color: EXPERIMENT_LINK_COLOR,
      width: 1 * settings.linkThickness,
      kind: "experiment",
    });
    // The run's own degree, and only that: it is what sizes the run, and a run
    // carries exactly one edge so it is always 1 today. Written out rather than
    // hard-coded so a second edge — a milestone, say — would size it correctly.
    bump(e.id);
    nodes.push({
      id: e.id,
      kind: "experiment",
      label: e.name,
      val: (1.6 + Math.sqrt(degree.get(e.id) ?? 0) * 1.6) * settings.nodeSize,
      color: EXPERIMENT_COLOR,
      experimentId: e.id,
      experimentStatus: e.status,
    });
  }

  if (showConceptEdges(settings)) {
    for (const t of visibleTags) {
      nodes.push({
        id: `tag:${t}`,
        kind: "tag",
        label: `#${t}`,
        val: (1.5 + Math.sqrt(tagUse.get(t) ?? 1) * 1.6) * settings.nodeSize,
        color: tagColor(t),
        tagName: t,
      });
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredLinks = links.filter(
    (l) => nodeIds.has(l.source) && nodeIds.has(l.target),
  );

  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (neighbors.get(a) ?? neighbors.set(a, new Set()).get(a)!).add(b);
    (neighbors.get(b) ?? neighbors.set(b, new Set()).get(b)!).add(a);
  };
  for (const l of filteredLinks) link(l.source, l.target);

  return { data: { nodes: nodes, links: filteredLinks }, neighbors, tagToPapers, tagToNotes };
}
