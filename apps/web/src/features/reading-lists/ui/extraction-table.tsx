"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Paper, PaperFieldDef, PaperFieldValueData, ReadingListTreeNode } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";
import { MultiSelect } from "@/components/multi-select";
import {
  buildProposeFillPrompt,
  emptyCellPaperIds,
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
  pendingFieldFills,
  pendingKey,
  type ExtractionColumnId,
  type ExtractionRow,
  type PendingFieldFill,
} from "../application/extraction-table";
import { collectListIds } from "./list-ui";

function collectSubtreeIds(node: ReadingListTreeNode): string[] {
  return collectListIds([node]);
}

function isFillableField(def: PaperFieldDef): boolean {
  return def.kind === "text" || def.kind === "number" || def.kind === "select" || def.kind === "multi_select";
}

/** Structured comparison table over papers in a list (and nested sublists). */
export function ExtractionTable({
  node,
  papers,
  readOnly = false,
}: {
  node: ReadingListTreeNode;
  papers: Paper[];
  readOnly?: boolean;
}) {
  const [defs, setDefs] = useState<PaperFieldDef[]>([]);
  const [rows, setRows] = useState<ExtractionRow[]>([]);
  const [columns, setColumns] = useState<ExtractionColumnId[]>(["title", "year", "status"]);
  const [pending, setPending] = useState<PendingFieldFill[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [promptFieldId, setPromptFieldId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const listIds = collectSubtreeIds(node);
    const [nextDefs, items, allValues, proposals] = await Promise.all([
      getContainer().papers.listPaperFieldDefs(),
      getContainer().readingLists.listItemsForLists(listIds),
      getContainer().papers.listPaperFieldValuesForProject(),
      getContainer().aiProposals.listPending(),
    ]);
    const paperIds = items.flatMap((item) => (item.paperId ? [item.paperId] : []));
    setDefs(nextDefs);
    setRows(flattenPaperRows(papers, paperIds, allValues, nextDefs));
    setPending(pendingFieldFills(proposals));
    setColumns((prev) => {
      const fieldCols = nextDefs.map((d) => `field:${d.id}` as const);
      const kept = prev.filter(
        (c) => c === "title" || c === "year" || c === "status" || fieldCols.includes(c as `field:${string}`),
      );
      const missing = fieldCols.filter((c) => !kept.includes(c));
      return [...kept, ...missing];
    });
  }, [node, papers]);

  useEffect(() => {
    void reload().catch((err) => setError(formatError(err)));
  }, [reload]);

  useEffect(() => {
    const onChange = () => { void reload().catch((err) => setError(formatError(err))); };
    window.addEventListener("ai-proposals-changed", onChange);
    return () => window.removeEventListener("ai-proposals-changed", onChange);
  }, [reload]);

  const availableColumns = useMemo(() => {
    return [
      { value: "title", label: "Title" },
      { value: "year", label: "Year" },
      { value: "status", label: "Status" },
      ...defs.map((d) => ({ value: `field:${d.id}`, label: d.name })),
    ];
  }, [defs]);

  const pendingByCell = useMemo(() => {
    const map = new Map<string, PendingFieldFill>();
    const counts = new Map<string, number>();
    for (const fill of pending) {
      const key = pendingKey(fill.paperId, fill.fieldId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      map.set(key, fill); // last pending wins for preview
    }
    return { map, counts };
  }, [pending]);

  const listPendingCount = useMemo(() => {
    const paperIds = new Set(rows.map((r) => r.paper.id));
    return pending.filter((p) => paperIds.has(p.paperId)).length;
  }, [pending, rows]);

  async function saveCell(paperId: string, fieldId: string, value: PaperFieldValueData | null) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().papers.setPaperFieldValue(paperId, fieldId, value);
      await reload();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "md" | "csv") {
    const text =
      kind === "md"
        ? extractionMarkdown(rows, defs, columns)
        : extractionCsv(rows, defs, columns);
    try {
      await navigator.clipboard.writeText(text);
      setMsg(kind === "md" ? "Copied markdown table" : "Copied CSV");
      window.setTimeout(() => setMsg(null), 1500);
    } catch {
      setError("Clipboard unavailable");
    }
  }

  async function copyProposePrompt(fieldId: string) {
    const def = defs.find((d) => d.id === fieldId);
    if (!def || !isFillableField(def)) return;
    const pendingKeys = new Set(
      pending.filter((p) => p.fieldId === fieldId).map((p) => pendingKey(p.paperId, p.fieldId)),
    );
    const emptyIds = new Set(emptyCellPaperIds(rows, fieldId, pendingKeys));
    const targets = rows
      .filter((r) => emptyIds.has(r.paper.id))
      .map((r) => ({ id: r.paper.id, title: r.paper.title }));
    const promptPapers = targets.length
      ? targets
      : rows
          .filter((r) => !pendingKeys.has(pendingKey(r.paper.id, fieldId)))
          .map((r) => ({ id: r.paper.id, title: r.paper.title }));
    if (!promptPapers.length) {
      setError("Every paper in this column already has a pending fill — review or reject those first.");
      setPromptFieldId(null);
      return;
    }
    const prompt = buildProposeFillPrompt({
      listId: node.list.id,
      fieldId,
      fieldName: def.name,
      papers: promptPapers,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptFieldId(null);
      setMsg(
        targets.length
          ? `Copied fill prompt for ${targets.length} empty cell${targets.length === 1 ? "" : "s"}`
          : `Copied fill prompt for ${promptPapers.length} paper${promptPapers.length === 1 ? "" : "s"}`,
      );
      window.setTimeout(() => setMsg(null), 2500);
    } catch {
      setError("Clipboard unavailable");
    }
  }

  if (rows.length === 0) {
    return <p className="muted">No papers in this list yet.</p>;
  }

  return (
    <div className="extraction-table">
      <div className="extraction-table-toolbar">
        <MultiSelect
          id={`extract-cols-${node.list.id}`}
          values={columns}
          onChange={(next) =>
            setColumns(next.length ? (next as ExtractionColumnId[]) : ["title"])
          }
          allLabel="Columns"
          ariaLabel="Table columns"
          options={availableColumns}
        />
        <button type="button" className="link-btn" onClick={() => void copy("md")}>
          Copy markdown
        </button>
        <button type="button" className="link-btn" onClick={() => void copy("csv")}>
          Copy CSV
        </button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      {listPendingCount > 0 && (
        <p className="extraction-pending-banner" role="status">
          {listPendingCount} proposed fill{listPendingCount === 1 ? "" : "s"} pending review.{" "}
          <Link href="/ai-review">Open AI review →</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="extraction-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => {
                const fieldId = c.startsWith("field:") ? c.slice("field:".length) : null;
                const def = fieldId ? defs.find((d) => d.id === fieldId) : null;
                const fillable = def ? isFillableField(def) : false;
                return (
                  <th key={c}>
                    <div className="extraction-th">
                      <span>{availableColumns.find((o) => o.value === c)?.label ?? c}</span>
                      {!readOnly && fillable && fieldId && (
                        <button
                          type="button"
                          className="link-btn extraction-propose-btn"
                          onClick={() => setPromptFieldId((cur) => (cur === fieldId ? null : fieldId))}
                        >
                          Propose fill
                        </button>
                      )}
                    </div>
                    {promptFieldId === fieldId && fieldId && (
                      <div className="extraction-propose-panel">
                        <p className="muted">
                          Copies an agent prompt for your paired MCP session. Nothing is written until you approve each cell on AI review.
                        </p>
                        <button
                          type="button"
                          className="secondary-btn btn-sm"
                          onClick={() => void copyProposePrompt(fieldId)}
                        >
                          Copy agent prompt
                        </button>
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.paper.id}>
                {columns.map((column) => {
                  const fieldId = column.startsWith("field:") ? column.slice("field:".length) : null;
                  const cellKey = fieldId ? pendingKey(row.paper.id, fieldId) : null;
                  const fill = cellKey ? pendingByCell.map.get(cellKey) : undefined;
                  const dupCount = cellKey ? pendingByCell.counts.get(cellKey) ?? 0 : 0;
                  return (
                    <td key={column} className={fill ? "extraction-cell-pending" : undefined}>
                      {fill ? (
                        <div className="extraction-pending-cell" title={fill.preview}>
                          <span className="extraction-pending-label">
                            Pending review{dupCount > 1 ? ` · ${dupCount}` : ""}
                          </span>
                          <span className="extraction-pending-preview">{fill.preview || "—"}</span>
                        </div>
                      ) : (
                        <ExtractionCell
                          row={row}
                          column={column}
                          defs={defs}
                          papers={papers}
                          disabled={busy || readOnly}
                          onSave={saveCell}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtractionCell({
  row,
  column,
  defs,
  papers,
  disabled,
  onSave,
}: {
  row: ExtractionRow;
  column: ExtractionColumnId;
  defs: PaperFieldDef[];
  papers: Paper[];
  disabled: boolean;
  onSave: (paperId: string, fieldId: string, value: PaperFieldValueData | null) => void;
}) {
  if (column === "title") return <span>{row.paper.title}</span>;
  if (column === "year") return <span>{row.paper.year ?? "—"}</span>;
  if (column === "status") return <span>{row.paper.status.replace("_", " ")}</span>;

  const fieldId = column.slice("field:".length);
  const def = defs.find((d) => d.id === fieldId);
  const value = row.values.get(fieldId);
  if (!def) return <span>—</span>;

  if (def.kind === "relation" || def.kind === "rollup") {
    return (
      <span>
        {value == null
          ? "—"
          : Array.isArray(value)
            ? value
                .map((id) => papers.find((p) => p.id === id)?.title ?? String(id))
                .join(", ")
            : String(value)}
      </span>
    );
  }

  if (def.kind === "select") {
    return (
      <Select
        value={(value as string | undefined) ?? ""}
        disabled={disabled}
        onChange={(e) => onSave(row.paper.id, fieldId, e.target.value || null)}
        aria-label={def.name}
      >
        <option value="">—</option>
        {def.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }

  if (def.kind === "multi_select") {
    const current = Array.isArray(value) ? value : [];
    return (
      <div className="paper-field-multi">
        {def.options.map((opt) => {
          const checked = current.includes(opt);
          return (
            <label key={opt} className="paper-field-check">
              <input
                type="checkbox"
                className="themed-check"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  const next = checked
                    ? current.filter((x) => x !== opt)
                    : [...current, opt];
                  onSave(row.paper.id, fieldId, next.length ? next : null);
                }}
              />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <ExtractionTextCell
      kind={def.kind === "number" ? "number" : "text"}
      value={value}
      disabled={disabled}
      label={def.name}
      onCommit={(next) => onSave(row.paper.id, fieldId, next)}
    />
  );
}

function ExtractionTextCell({
  kind,
  value,
  disabled,
  label,
  onCommit,
}: {
  kind: "text" | "number";
  value: PaperFieldValueData | undefined;
  disabled: boolean;
  label: string;
  onCommit: (next: PaperFieldValueData | null) => void;
}) {
  const initial =
    kind === "number"
      ? typeof value === "number"
        ? String(value)
        : ""
      : typeof value === "string"
        ? value
        : "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);

  return (
    <input
      className="paper-field-input"
      type={kind === "number" ? "number" : "text"}
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (kind === "number") {
          if (draft.trim() === "") {
            onCommit(null);
            return;
          }
          const n = Number(draft);
          if (Number.isFinite(n)) onCommit(n);
          else setDraft(initial);
          return;
        }
        const trimmed = draft.trim();
        const current = typeof value === "string" ? value : "";
        if (trimmed !== current) onCommit(trimmed || null);
      }}
    />
  );
}
