"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Paper, PaperFieldDef, PaperFieldValueData, ReadingListTreeNode } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";
import { MultiSelect } from "@/components/multi-select";
import {
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
  type ExtractionColumnId,
  type ExtractionRow,
} from "../application/extraction-table";
import { collectListIds } from "./list-ui";

function collectSubtreeIds(node: ReadingListTreeNode): string[] {
  return collectListIds([node]);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const listIds = collectSubtreeIds(node);
    const [nextDefs, items, allValues] = await Promise.all([
      getContainer().papers.listPaperFieldDefs(),
      getContainer().readingLists.listItemsForLists(listIds),
      getContainer().papers.listPaperFieldValuesForProject(),
    ]);
    const paperIds = items.flatMap((item) => (item.paperId ? [item.paperId] : []));
    setDefs(nextDefs);
    setRows(flattenPaperRows(papers, paperIds, allValues, nextDefs));
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

  const availableColumns = useMemo(() => {
    return [
      { value: "title", label: "Title" },
      { value: "year", label: "Year" },
      { value: "status", label: "Status" },
      ...defs.map((d) => ({ value: `field:${d.id}`, label: d.name })),
    ];
  }, [defs]);

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
      {error && <p className="error">{error}</p>}
      <div className="extraction-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>
                  {availableColumns.find((o) => o.value === c)?.label ?? c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.paper.id}>
                {columns.map((column) => (
                  <td key={column}>
                    <ExtractionCell
                      row={row}
                      column={column}
                      defs={defs}
                      papers={papers}
                      disabled={busy || readOnly}
                      onSave={saveCell}
                    />
                  </td>
                ))}
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
