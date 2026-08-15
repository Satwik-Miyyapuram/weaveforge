"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type Paper, type PaperRelation, type RelationType, type ReportSection, type VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { RELATION_COLORS, tagColor } from "../application/build-graph-data";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";

interface StoredAnnotation {
  text?: string;
  comment?: string;
  color?: string;
  tags?: string[];
}

/** Side panel for a selected paper, note, report section, or concept node. */
export function GraphSidePanel({
  paper,
  note,
  section,
  conceptName,
  papers,
  notes,
  relations,
  tagToPapers,
  tagToNotes,
  onClose,
  onRefresh,
  onSelectPaper,
  onSelectNote,
  onSelectConcept,
}: {
  paper: Paper | null;
  note: VaultPage | null;
  section?: ReportSection | null;
  conceptName: string | null;
  papers: Paper[];
  notes: VaultPage[];
  relations: PaperRelation[];
  tagToPapers: Map<string, string[]>;
  tagToNotes: Map<string, string[]>;
  onClose: () => void;
  onRefresh: () => void;
  onSelectPaper: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectConcept: (name: string) => void;
}) {
  const visible = Boolean(paper || note || section || conceptName);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const kindLabel = paper ? "Paper" : note ? "Note" : section ? "Report" : "Concept";

  return (
    <aside
      className="graph-side-panel card"
      role="region"
      aria-label={`${kindLabel} details`}
    >
      <div className="graph-side-head">
        <strong>{kindLabel}</strong>
        <button type="button" className="link-btn" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>
      {paper && (
        <PaperPanel
          paper={paper}
          relations={relations}
          papers={papers}
          onRefresh={onRefresh}
          onSelectPaper={onSelectPaper}
          onSelectConcept={onSelectConcept}
        />
      )}
      {note && !paper && !section && (
        <NotePanel note={note} onSelectConcept={onSelectConcept} />
      )}
      {section && !paper && !note && <SectionPanel section={section} />}
      {conceptName && !paper && !note && !section && (
        <ConceptPanel
          name={conceptName}
          papers={papers}
          notes={notes}
          tagToPapers={tagToPapers}
          tagToNotes={tagToNotes}
          onSelectPaper={onSelectPaper}
          onSelectNote={onSelectNote}
          onSelectConcept={onSelectConcept}
          onMerged={onRefresh}
        />
      )}
    </aside>
  );
}

function PaperPanel({
  paper,
  relations,
  papers,
  onRefresh,
  onSelectPaper,
  onSelectConcept,
}: {
  paper: Paper;
  relations: PaperRelation[];
  papers: Paper[];
  onRefresh: () => void;
  onSelectPaper: (id: string) => void;
  onSelectConcept: (name: string) => void;
}) {
  const [linking, setLinking] = useState(false);
  const touching = relations.filter((e) => e.fromPaper === paper.id || e.toPaper === paper.id);

  async function autoLinkPaper() {
    setLinking(true);
    try {
      await getContainer().graph.linkCitations.forPaper(paper);
      onRefresh();
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="graph-side-body">
      <h3 className="graph-side-title">{paper.title}</h3>
      {paper.authors.length > 0 && (
        <p className="muted graph-side-meta">{paper.authors.join(", ")}</p>
      )}
      <p className="graph-side-meta">
        Status: <span className="status-pill">{paper.status.replace("_", " ")}</span>
      </p>
      {paper.tags.length > 0 && (
        <div className="tag-chips">
          {paper.tags.map((t) => (
            <button key={t} type="button" className="tag-chip tag-chip-btn" onClick={() => onSelectConcept(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      <div className="graph-side-actions">
        <Link href={`/papers?paper=${encodeURIComponent(paper.id)}`} className="btn-secondary">
          Open in Papers
        </Link>
        <button type="button" className="btn-secondary" onClick={() => void autoLinkPaper()} disabled={linking}>
          {linking ? "Linking…" : "Auto-link citations"}
        </button>
      </div>
      {touching.length > 0 && (
        <div className="graph-side-section">
          <div className="muted">Relations ({touching.length})</div>
          <ul className="graph-side-list">
            {touching.slice(0, 8).map((e) => {
              const otherId = e.fromPaper === paper.id ? e.toPaper : e.fromPaper;
              const other = papers.find((p) => p.id === otherId);
              return (
                <li key={e.id}>
                  <span className="legend-swatch" style={{ background: RELATION_COLORS[e.relation] }} />
                  {e.relation.replace("_", " ")}{" "}
                  <button type="button" className="link-btn" onClick={() => onSelectPaper(otherId)}>
                    {other?.title.slice(0, 40) ?? otherId}
                  </button>
                  {e.source === "auto" && <span className="muted"> (auto)</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotePanel({
  note,
  onSelectConcept,
}: {
  note: VaultPage;
  onSelectConcept: (name: string) => void;
}) {
  const tags = (note.body.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map((t) =>
    t.replace(/^#+/, "").toLowerCase(),
  );
  const uniqueTags = [...new Set(tags)];

  return (
    <div className="graph-side-body">
      <h3 className="graph-side-title">{note.title}</h3>
      {uniqueTags.length > 0 && (
        <div className="tag-chips">
          {uniqueTags.map((t) => (
            <button key={t} type="button" className="tag-chip tag-chip-btn" onClick={() => onSelectConcept(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      <div className="graph-side-actions">
        <Link href={`/notes?page=${encodeURIComponent(note.id)}`} className="btn-secondary">
          Open in Notes
        </Link>
      </div>
    </div>
  );
}

function SectionPanel({ section }: { section: ReportSection }) {
  return (
    <div className="graph-side-body">
      <h3 className="graph-side-title">{section.title}</h3>
      {section.sectionNo && <p className="muted">§ {section.sectionNo}</p>}
      <p className="muted">{section.status.replace("_", " ")} · {section.wordCount} words</p>
      <div className="graph-side-actions">
        <Link href={`/report?section=${encodeURIComponent(section.id)}`} className="btn-secondary">
          Open in Report
        </Link>
      </div>
    </div>
  );
}

function ConceptPanel({
  name,
  papers,
  notes,
  tagToPapers,
  tagToNotes,
  onSelectPaper,
  onSelectNote,
  onSelectConcept,
  onMerged,
}: {
  name: string;
  papers: Paper[];
  notes: VaultPage[];
  tagToPapers: Map<string, string[]>;
  tagToNotes: Map<string, string[]>;
  onSelectPaper: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectConcept: (name: string) => void;
  onMerged: () => void;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedPaperIds = tagToPapers.get(name) ?? [];
  const linkedNoteIds = tagToNotes.get(name) ?? [];
  const linkedPapers = papers.filter((p) => linkedPaperIds.includes(p.id));
  const linkedNotes = notes.filter((n) => linkedNoteIds.includes(n.id));
  const linkedCount = linkedPapers.length + linkedNotes.length;

  const relatedConcepts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of linkedPapers) {
      for (const t of p.tags) {
        if (t === name) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    for (const n of linkedNotes) {
      const tags = (n.body.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map((t) => t.replace(/^#+/, "").toLowerCase());
      for (const t of tags) {
        if (t === name) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [linkedPapers, linkedNotes, name]);

  const evidence = useMemo(() => {
    const out: { paper: Paper; ann: StoredAnnotation }[] = [];
    for (const p of linkedPapers) {
      const anns = (p.metadata?.annotations as StoredAnnotation[] | undefined) ?? [];
      for (const a of anns) {
        const tags = [
          ...(a.tags ?? []),
        ];
        if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
          out.push({ paper: p, ann: a });
        }
      }
    }
    return out.slice(0, 6);
  }, [linkedPapers, name]);

  const allConcepts = useMemo(() => {
    const set = new Set<string>();
    for (const p of papers) for (const t of p.tags) set.add(t);
    return [...set].filter((t) => t !== name).sort();
  }, [papers, name]);

  async function merge() {
    if (!mergeInto) return;
    setBusy(true);
    setError(null);
    try {
      const { manageTags, tags } = getContainer().graph;
      const keep = await tags.findByName(mergeInto);
      const drop = await tags.findByName(name);
      if (!keep || !drop) throw new Error("Tag not found.");
      await manageTags.mergeConcepts(keep.id, drop.id);
      setMergeOpen(false);
      onMerged();
      onSelectConcept(mergeInto);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="graph-side-body">
      <h3 className="graph-side-title" style={{ color: tagColor(name) }}>#{name}</h3>
      <p className="muted">{linkedCount} item{linkedCount === 1 ? "" : "s"}</p>
      <div className="graph-side-actions">
        <button type="button" className="btn-secondary" onClick={() => setMergeOpen((v) => !v)}>
          Merge alias…
        </button>
      </div>
      {mergeOpen && (
        <div className="graph-merge-box">
          <label className="muted" htmlFor="merge-into">Merge into</label>
          <Select
            id="merge-into"
            value={mergeInto}
            onChange={(e) => setMergeInto(e.target.value)}
            aria-label="Merge into"
            searchable
          >
            <option value="">Pick concept…</option>
            {allConcepts.map((t) => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </Select>
          {error && <p className="error">{error}</p>}
          <button type="button" className="btn-primary" disabled={!mergeInto || busy} onClick={() => void merge()}>
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      )}
      {linkedPapers.length > 0 && (
        <div className="graph-side-section">
          <div className="muted">Papers</div>
          <ul className="graph-side-list">
            {linkedPapers.map((p) => (
              <li key={p.id}>
                <button type="button" className="link-btn" onClick={() => onSelectPaper(p.id)}>
                  {p.title}
                </button>
                <span className="muted"> · {p.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {linkedNotes.length > 0 && (
        <div className="graph-side-section">
          <div className="muted">Notes</div>
          <ul className="graph-side-list">
            {linkedNotes.map((n) => (
              <li key={n.id}>
                <button type="button" className="link-btn" onClick={() => onSelectNote(n.id)}>
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {relatedConcepts.length > 0 && (
        <div className="graph-side-section">
          <div className="muted">Co-occurring</div>
          <div className="tag-chips">
            {relatedConcepts.map(([t, n]) => (
              <button key={t} type="button" className="tag-chip tag-chip-btn" onClick={() => onSelectConcept(t)}>
                #{t} <span className="muted">({n})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {evidence.length > 0 && (
        <div className="graph-side-section">
          <div className="muted">Annotation evidence</div>
          <ul className="annotation-list">
            {evidence.map(({ paper: p, ann }, i) => (
              <li key={i} className="annotation">
                {ann.color && <span className="annotation-swatch" style={{ background: ann.color }} aria-hidden />}
                <div className="annotation-body">
                  <button type="button" className="link-btn annotation-paper" onClick={() => onSelectPaper(p.id)}>
                    {p.title.slice(0, 48)}
                  </button>
                  {ann.text && <p className="annotation-text">{ann.text}</p>}
                  {ann.comment && <p className="annotation-comment">{ann.comment}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Popover for a selected relation edge. */
export function EdgeDetailPopover({
  edge,
  papers,
  position,
  onClose,
  onDeleted,
}: {
  edge: PaperRelation;
  papers: Paper[];
  position: { x: number; y: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const from = papers.find((p) => p.id === edge.fromPaper);
  const to = papers.find((p) => p.id === edge.toPaper);

  async function remove() {
    setBusy(true);
    try {
      await getContainer().graph.removeRelation(edge.id);
      onDeleted();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="graph-edge-popover card"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Relation edge"
    >
      <div className="graph-edge-popover-head">
        <span className="legend-swatch" style={{ background: RELATION_COLORS[edge.relation as RelationType] }} />
        <strong>{edge.relation.replace("_", " ")}</strong>
        <button type="button" className="link-btn" onClick={onClose}>✕</button>
      </div>
      <p className="muted graph-edge-popover-path">
        {from?.title.slice(0, 36) ?? edge.fromPaper} → {to?.title.slice(0, 36) ?? edge.toPaper}
      </p>
      {edge.note && <p>{edge.note}</p>}
      <p className="muted">Source: {edge.source}</p>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove()}>
        {busy ? "Deleting…" : "Delete edge"}
      </button>
    </div>
  );
}
