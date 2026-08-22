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
export function SyncIssuesPanel() {
  const { issues, keep, retry, discard } = useSyncIssues();
  const { conflicts, dead } = issues;
  if (conflicts.length === 0 && dead.length === 0) return null;

  return (
    <div className="settings-group">
      <h3>Needs you</h3>
      {conflicts.map((conflict) => (
        <ConflictRow
          key={conflict.id}
          fields={conflict.fields.map((field) => field.field)}
          label={`${conflict.table} · ${conflict.rowId.slice(0, 8)}`}
          values={conflict.fields}
          onKeep={(picks) => void keep(conflict.id, picks)}
        />
      ))}
      {dead.map((entry) => (
        <div key={entry.opId} className="settings-group">
          <p>
            <strong>{entry.table}</strong> — {entry.op} refused after {entry.attempts} tries.
          </p>
          <p className="muted">{entry.lastError ?? "No reason given."}</p>
          <div className="field-inline">
            <button type="button" className="btn-secondary" onClick={() => void retry(entry.opId)}>
              Try again
            </button>
            <button type="button" className="link-btn" onClick={() => void discard(entry.opId)}>
              Discard
            </button>
          </div>
        </div>
      ))}
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
    <div className="settings-group">
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
