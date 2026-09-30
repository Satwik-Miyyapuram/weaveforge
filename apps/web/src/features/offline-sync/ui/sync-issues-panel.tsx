"use client";

import { useState } from "react";
import { useSyncIssues } from "./use-sync-issues";

/**
 * What sync could not decide on its own.
 *
 * Every row here is a question only the person can answer, so the panel is
 * absent when there are none: a permanent "no conflicts" section trains the
 * reader to stop looking at the one place that will eventually matter.
 */
/** Refused writes listed before the rest fold behind "Show all". */
const DEAD_SHOWN = 5;

export function SyncIssuesPanel() {
  const {
    issues,
    keep,
    keepAllLocal,
    keepAllRemote,
    keepAllConflicts,
    resolveWithMarkers,
    retry,
    discard,
  } = useSyncIssues();
  const [showAll, setShowAll] = useState(false);
  const { conflicts, dead } = issues;
  const shown = showAll ? dead : dead.slice(0, DEAD_SHOWN);
  if (conflicts.length === 0 && dead.length === 0) return null;

  return (
    <div className="card settings-block">
      <h3 className="settings-group">Needs you</h3>
      {conflicts.length > 1 && (
        <div className="field-inline" style={{ marginBottom: "12px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void keepAllConflicts("local")}
            title="Resolve all conflicts by keeping edits made on this device"
          >
            Keep all {conflicts.length} local
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void keepAllConflicts("remote")}
            title="Resolve all conflicts by accepting cloud versions"
          >
            Keep all {conflicts.length} cloud
          </button>
        </div>
      )}
      {dead.length > 1 && (
        <div className="field-inline">
          <button type="button" className="btn-secondary" onClick={() => dead.forEach((entry) => void retry(entry.opId))}>
            Try all {dead.length} again
          </button>
          <button type="button" className="btn-ghost btn-cancel" onClick={() => dead.forEach((entry) => void discard(entry.opId))}>
            Discard all
          </button>
        </div>
      )}
      {conflicts.map((conflict) => (
        <ConflictRow
          key={conflict.id}
          fields={conflict.fields.map((field) => field.field)}
          label={`${conflict.table} · ${conflict.rowId.slice(0, 8)}`}
          values={conflict.fields}
          onKeep={(picks) => void keep(conflict.id, picks)}
          onKeepAllLocal={() => void keepAllLocal(conflict.id)}
          onKeepAllRemote={() => void keepAllRemote(conflict.id)}
          onResolveWithMarkers={(field) => void resolveWithMarkers(conflict.id, field)}
        />
      ))}
      {shown.map((entry) => (
        <div key={entry.opId} className="sync-issue">
          <p>
            <strong>{entry.table}</strong> — {entry.op} refused after {entry.attempts} tries.
          </p>
          <p className="muted">{entry.lastError ?? "No reason given."}</p>
          <div className="field-inline">
            <button type="button" className="btn-secondary btn-sm" onClick={() => void retry(entry.opId)}>
              Try again
            </button>
            <button type="button" className="btn-ghost btn-cancel btn-sm" onClick={() => void discard(entry.opId)}>
              Discard
            </button>
          </div>
        </div>
      ))}
      {dead.length > shown.length && (
        <button type="button" className="btn-ghost sync-issue-more" onClick={() => setShowAll(true)}>
          Show the other {dead.length - shown.length}
        </button>
      )}
    </div>
  );
}

interface ConflictRowProps {
  label: string;
  fields: string[];
  values: { field: string; local: unknown; remote: unknown }[];
  onKeep: (picks: Record<string, "local" | "remote">) => void;
  onKeepAllLocal: () => void;
  onKeepAllRemote: () => void;
  onResolveWithMarkers: (field: string) => void;
}

/**
 * One row, one field at a time with git conflict options.
 */
function ConflictRow({
  label,
  fields,
  values,
  onKeep,
  onKeepAllLocal,
  onKeepAllRemote,
  onResolveWithMarkers,
}: ConflictRowProps) {
  const [picks, setPicks] = useState<Record<string, "local" | "remote">>({});
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);

  return (
    <div className="sync-conflict">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <p style={{ margin: 0 }}>
          <strong>{label}</strong> changed in two places.
        </p>
        <div className="field-inline" style={{ margin: 0 }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onKeepAllLocal} title="Keep all fields from this device">
            Keep this device
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onKeepAllRemote} title="Keep all fields from cloud">
            Keep cloud
          </button>
        </div>
      </div>
      {values.map((value) => {
        const isLongText =
          typeof value.local === "string" &&
          (value.local.includes("\n") || value.local.length > 60);

        return (
          <div key={value.field} style={{ margin: "8px 0" }}>
            <div className="field-inline">
              <span className="muted">{value.field}</span>
              <button
                type="button"
                className={picks[value.field] === "local" ? "btn-secondary" : "link-btn"}
                onClick={() => setPicks((p) => ({ ...p, [value.field]: "local" }))}
              >
                This device: {show(value.local)}
              </button>
              <button
                type="button"
                className={picks[value.field] !== "local" ? "btn-secondary" : "link-btn"}
                onClick={() => setPicks((p) => ({ ...p, [value.field]: "remote" }))}
              >
                Cloud: {show(value.remote)}
              </button>
              {isLongText && (
                <>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      setExpandedDiff(expandedDiff === value.field ? null : value.field)
                    }
                  >
                    {expandedDiff === value.field ? "Hide diff" : "Compare"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => onResolveWithMarkers(value.field)}
                    title="Insert git-style conflict markers into the note body for in-editor resolution"
                  >
                    Use Git markers
                  </button>
                </>
              )}
            </div>
            {expandedDiff === value.field && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  margin: "8px 0",
                  padding: "8px",
                  background: "var(--bg-muted, rgba(0,0,0,0.05))",
                  borderRadius: "4px",
                  fontSize: "0.82rem",
                }}
              >
                <div>
                  <strong>This device (local):</strong>
                  <pre style={{ whiteSpace: "pre-wrap", maxHeight: "180px", overflowY: "auto", margin: "4px 0" }}>
                    {String(value.local)}
                  </pre>
                </div>
                <div>
                  <strong>Cloud (remote):</strong>
                  <pre style={{ whiteSpace: "pre-wrap", maxHeight: "180px", overflowY: "auto", margin: "4px 0" }}>
                    {String(value.remote)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="btn-secondary" onClick={() => onKeep(picks)} disabled={fields.length === 0}>
        Keep these selections
      </button>
    </div>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 35 ? `${text.slice(0, 35)}…` : text;
}
