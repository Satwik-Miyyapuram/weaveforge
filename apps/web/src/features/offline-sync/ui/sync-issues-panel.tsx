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
  const { issues, keep, retry, discard } = useSyncIssues();
  const [showAll, setShowAll] = useState(false);
  const { conflicts, dead } = issues;
  const shown = showAll ? dead : dead.slice(0, DEAD_SHOWN);
  if (conflicts.length === 0 && dead.length === 0) return null;

  return (
    <div className="card settings-block">
      <h3 className="settings-group">Needs you</h3>
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
}

/**
 * One row, one field at a time.
 *
 * The choice is per field rather than per row because the alternative asks the
 * reader to throw away an edit they never disagreed with: two devices usually
 * touched different parts of the same thing.
 */
function ConflictRow({ label, fields, values, onKeep }: ConflictRowProps) {
  const [picks, setPicks] = useState<Record<string, "local" | "remote">>({});

  return (
    <div className="sync-conflict">
      <p>
        <strong>{label}</strong> changed in two places.
      </p>
      {values.map((value) => (
        <div key={value.field} className="field-inline">
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
            Other device: {show(value.remote)}
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onKeep(picks)} disabled={fields.length === 0}>
        Keep these
      </button>
    </div>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
