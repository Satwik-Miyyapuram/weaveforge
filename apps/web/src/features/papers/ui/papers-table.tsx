"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PAPER_STATUSES, type Paper, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { OpenIcon } from "@/components/view-icons";
import { Select } from "@/components/select";
import { paperExternalLink } from "./paper-external-link";

/** Tabular list — same chrome as experiments Compare (`cmp-table`). */
export function PapersTable({
  papers,
  isReadOnly,
  sharedOwnerName,
  onOpen,
  onReplace,
}: {
  papers: readonly Paper[];
  isReadOnly: (id: string) => boolean;
  sharedOwnerName: (id: string) => string | undefined;
  onOpen: (id: string) => void;
  onReplace: (p: Paper) => void;
}) {
  type SortKey = "title" | "authors" | "year" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "year" ? "desc" : "asc");
    }
  }

  const rows = useMemo(() => {
    const list = [...papers];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "title") {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * dir;
      }
      if (sortKey === "authors") {
        const aa = a.authors[0] ?? "";
        const bb = b.authors[0] ?? "";
        return aa.localeCompare(bb, undefined, { sensitivity: "base" }) * dir;
      }
      if (sortKey === "year") {
        const ay = a.year ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        const by = b.year ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        return (ay - by) * dir;
      }
      const ai = PAPER_STATUSES.indexOf(a.status);
      const bi = PAPER_STATUSES.indexOf(b.status);
      return (ai - bi) * dir;
    });
    return list;
  }, [papers, sortKey, sortDir]);

  /**
   * A sortable column header.
   *
   * `aria-sort` belongs on the header cell, not on the button inside it — a
   * button has no sort state, a columnheader does.
   */
  function sortHeader(key: SortKey, label: string, className: string) {
    const active = sortKey === key;
    return (
      <th
        className={className}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className={`link-btn papers-sort-btn${active ? " papers-sort-btn--on" : ""}`}
          onClick={() => toggleSort(key)}
        >
          {label}
          <span className="papers-sort-arrow" aria-hidden>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="table-scroll papers-table-scroll">
      <table className="cmp-table papers-table">
        <thead>
          <tr>
            {sortHeader("title", "Title", "papers-col-title")}
            {sortHeader("authors", "Authors", "papers-col-authors")}
            {sortHeader("year", "Year", "papers-col-year")}
            {sortHeader("status", "Status", "papers-col-status")}
            <th className="papers-col-link">Link</th>
            <th className="papers-col-open" aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((paper) => (
            <PaperTableRow
              key={paper.id}
              paper={paper}
              readOnly={isReadOnly(paper.id)}
              sharedByName={sharedOwnerName(paper.id)}
              onOpen={() => onOpen(paper.id)}
              onReplace={onReplace}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaperTableRow({
  paper,
  readOnly,
  sharedByName,
  onOpen,
  onReplace,
}: {
  paper: Paper;
  readOnly: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onReplace: (p: Paper) => void;
}) {
  const [busy, setBusy] = useState(false);
  const link = paperExternalLink(paper);
  const authors =
    paper.authors.length === 0
      ? "—"
      : paper.authors.length === 1
        ? paper.authors[0]!
        : `${paper.authors[0]} et al.`;

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try {
      onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="papers-col-title">
        <button
          type="button"
          className="link-btn papers-table-title-btn"
          onClick={onOpen}
          title={paper.title}
        >
          {paper.title}
        </button>
        {readOnly && sharedByName && (
          <span className="muted papers-table-shared">Shared by {sharedByName}</span>
        )}
      </td>
      <td className="papers-col-authors" title={paper.authors.join(", ") || undefined}>
        {authors}
      </td>
      <td className="papers-col-year">{paper.year ?? "—"}</td>
      <td className="papers-col-status">
        {readOnly ? (
          <span className="muted">{paper.status.replace("_", " ")}</span>
        ) : (
          <Select
            className="status-select"
            value={paper.status}
            disabled={busy}
            onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
            aria-label={`Status for ${paper.title}`}
          >
            {PAPER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        )}
      </td>
      <td className="papers-col-link">
        {link ? (
          <a href={link.href} target="_blank" rel="noreferrer" className="link-btn" title={link.label}>
            <span className="papers-link-full">{link.label} ↗</span>
            <span className="papers-link-short" aria-hidden>↗</span>
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="papers-col-open">
        <button
          type="button"
          className="entity-icon-btn paper-open-icon"
          onClick={onOpen}
          aria-label={`Open note for ${paper.title}`}
          title="Open note"
        >
          <OpenIcon />
        </button>
      </td>
    </tr>
  );
}
