"use client";

import { Fragment, useState } from "react";
import {
  diffBody,
  hasConflictMarkers,
  MARKER_OURS,
  MARKER_THEIRS,
  mergeHunks,
  writeConflictMarkers,
  type DiffLine,
  type HunkPick,
} from "@weaveforge/core";
import type { OpenConflict } from "../domain/conflicts";
import { sameValue } from "../domain/merge";
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
  const { issues, keep, keepAllConflicts, retry, discard } = useSyncIssues();
  const [showAll, setShowAll] = useState(false);
  const { dead } = issues;
  // A conflict with no cloud copy yet has nothing to choose between; the next pull settles or fills it.
  const conflicts = issues.conflicts.filter((c) => c.fields.length > 0);
  const waiting = issues.conflicts.length - conflicts.length;
  const shown = showAll ? dead : dead.slice(0, DEAD_SHOWN);
  if (conflicts.length === 0 && dead.length === 0 && waiting === 0) return null;

  const summary = [
    conflicts.length > 0 && plural(conflicts.length, "conflict"),
    dead.length > 0 && plural(dead.length, "refused write"),
    waiting > 0 && `${waiting} waiting`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="card settings-block sync-issues">
      <div className="sync-issues-head">
        <div>
          <h3 className="settings-group">Needs you</h3>
          <p className="muted">{summary}</p>
        </div>
        {conflicts.length > 1 && (
          <div className="field-inline">
            <button type="button" className="btn-secondary btn-sm" onClick={() => void keepAllConflicts("local")}>
              Keep all mine
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void keepAllConflicts("remote")}>
              Take all cloud
            </button>
          </div>
        )}
      </div>
      {waiting > 0 && (
        <p className="muted">
          {waiting === 1 ? "One edit was" : `${waiting} edits were`} refused as out of date. Waiting for the
          cloud copy to compare against.
        </p>
      )}
      {conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          onResolve={(picks, overrides) => keep(conflict.id, picks, overrides)}
        />
      ))}
      {dead.length > 0 && (
        <section className="sync-dead">
          <div className="sync-issues-head">
            <h4>Refused writes</h4>
            {dead.length > 1 && (
              <div className="field-inline">
                <button type="button" className="btn-secondary btn-sm" onClick={() => dead.forEach((e) => void retry(e.opId))}>
                  Try all again
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => dead.forEach((e) => void discard(e.opId))}>
                  Discard all
                </button>
              </div>
            )}
          </div>
          {shown.map((entry) => (
            <div key={entry.opId} className="sync-issue">
              <div>
                <p>
                  <span className="sync-chip">{kindOf(entry.table)}</span> {entry.op} refused after{" "}
                  {plural(entry.attempts, "try", "tries")}
                </p>
                <p className="muted">{entry.lastError ?? "No reason given."}</p>
              </div>
              <div className="field-inline">
                <button type="button" className="btn-secondary btn-sm" onClick={() => void retry(entry.opId)}>
                  Try again
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void discard(entry.opId)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
          {dead.length > shown.length && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAll(true)}>
              Show the other {dead.length - shown.length}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** How one field gets settled: a whole side, a pick per hunk, or hand-edited text. */
type Choice =
  | { kind: "local" }
  | { kind: "remote" }
  | { kind: "hunks"; picks: Record<number, HunkPick> }
  | { kind: "edit"; text: string };

type Field = OpenConflict["fields"][number];

function ConflictCard({
  conflict,
  onResolve,
}: {
  conflict: OpenConflict;
  onResolve: (picks: Record<string, "local" | "remote">, overrides: Record<string, unknown>) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  // Fields equal on both sides need no choice; showing them hid the real difference.
  const fields = conflict.fields.filter((f) => !sameValue(f.local ?? null, f.remote ?? null));
  const equal = conflict.fields.filter((f) => !fields.includes(f));
  const settled = fields.filter((f) => isSettled(f, choices[f.field])).length;
  const all = (kind: "local" | "remote") => setChoices(Object.fromEntries(fields.map((f) => [f.field, { kind }])));

  const resolve = async () => {
    const picks: Record<string, "local" | "remote"> = Object.fromEntries(equal.map((f) => [f.field, "local"]));
    const overrides: Record<string, unknown> = {};
    for (const f of fields) {
      const c = choices[f.field]!;
      if (c.kind === "local" || c.kind === "remote") picks[f.field] = c.kind;
      else if (c.kind === "edit") overrides[f.field] = c.text;
      else overrides[f.field] = mergeHunks(text(f.local), text(f.remote), c.picks);
    }
    setBusy(true);
    try {
      await onResolve(picks, overrides);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="sync-conflict">
      <header className="sync-conflict-head">
        <span className="sync-chip">{kindOf(conflict.table)}</span>
        <strong className="sync-conflict-name">{nameOf(conflict)}</strong>
        <span className="muted">changed on both sides: {fields.map((f) => humanize(f.field)).join(", ")}</span>
      </header>
      {fields.map((f) => (
        <FieldMerge
          key={f.field}
          field={f}
          choice={choices[f.field]}
          onChoose={(c) => setChoices((prev) => ({ ...prev, [f.field]: c }))}
        />
      ))}
      <footer className="sync-conflict-foot">
        <span className="muted">
          {settled} of {fields.length} chosen
        </span>
        <span className="sync-conflict-actions">
          {fields.length > 1 && (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={() => all("local")}>
                All mine
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => all("remote")}>
                All cloud
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy || settled < fields.length}
            onClick={() => void resolve()}
          >
            Resolve
          </button>
        </span>
      </footer>
    </article>
  );
}

function FieldMerge({ field, choice, onChoose }: { field: Field; choice?: Choice; onChoose: (c: Choice) => void }) {
  const long = isLong(field.local) || isLong(field.remote);
  // Values that read the same once formatted leave nothing to choose between.
  const show = format(field.local) === format(field.remote) ? raw : format;
  return (
    <div className="sync-field">
      <div className="sync-field-label">
        <span>{humanize(field.field)}</span>
        {/* Both sides created the row: there was no earlier value to show. */}
        {field.base !== undefined && <span className="muted">was {format(field.base)}</span>}
      </div>
      {long ? (
        <TextMerge field={field} choice={choice} onChoose={onChoose} />
      ) : (
        <div className="sync-sides" role="radiogroup" aria-label={humanize(field.field)}>
          {(["local", "remote"] as const).map((side) => (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={choice?.kind === side}
              className="sync-side"
              data-side={side}
              onClick={() => onChoose({ kind: side })}
            >
              <span className="sync-side-tag">{side === "local" ? "This device" : "Cloud"}</span>
              <span className="sync-side-value">{show(field[side])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Long text merges the way git does: a diff, a pick per hunk, or the markers to edit by hand. */
function TextMerge({ field, choice, onChoose }: { field: Field; choice?: Choice; onChoose: (c: Choice) => void }) {
  const ours = text(field.local);
  const theirs = text(field.remote);
  const { lines, hunks } = diffBody(ours, theirs);
  const hunkPicks = choice?.kind === "hunks" ? choice.picks : {};
  const pickHunk = (index: number, pick: HunkPick) => onChoose({ kind: "hunks", picks: { ...hunkPicks, [index]: pick } });
  const bothAll = hunks.length > 0 && hunks.every((h) => hunkPicks[h.index] === "both");
  const modes: { label: string; checked: boolean; choose: () => void }[] = [
    { label: "Mine", checked: choice?.kind === "local", choose: () => onChoose({ kind: "local" }) },
    { label: "Cloud", checked: choice?.kind === "remote", choose: () => onChoose({ kind: "remote" }) },
    {
      label: "Both",
      checked: choice?.kind === "hunks" && bothAll,
      choose: () => onChoose({ kind: "hunks", picks: Object.fromEntries(hunks.map((h) => [h.index, "both"])) }),
    },
    {
      label: "Edit",
      checked: choice?.kind === "edit",
      choose: () => onChoose({ kind: "edit", text: deviceMarkers(ours, theirs) }),
    },
  ];

  return (
    <div className="sync-text">
      <div className="sync-seg" role="radiogroup" aria-label={humanize(field.field)}>
        {modes.map((m) => (
          <button key={m.label} type="button" role="radio" aria-checked={m.checked} onClick={m.choose}>
            {m.label}
          </button>
        ))}
      </div>
      {choice?.kind === "edit" ? (
        <>
          <textarea
            className="sync-edit"
            value={choice.text}
            spellCheck={false}
            rows={Math.min(16, choice.text.split("\n").length + 1)}
            onChange={(e) => onChoose({ kind: "edit", text: e.target.value })}
          />
          {hasConflictMarkers(choice.text) && (
            <p className="muted">Remove the &lt;&lt;&lt;&lt;&lt;&lt;&lt; / ======= / &gt;&gt;&gt;&gt;&gt;&gt;&gt; lines to resolve.</p>
          )}
        </>
      ) : (
        <div className="sync-diff">
          {groupHunks(lines).map((group, i) =>
            group.hunk === null ? (
              <Fragment key={i}>
                {group.lines.map((l, j) => (
                  <DiffRow key={j} line={l} />
                ))}
              </Fragment>
            ) : (
              <div key={i} className="sync-hunk">
                <div className="sync-hunk-pick" role="group" aria-label={`Change ${group.hunk + 1}`}>
                  {(["ours", "theirs", "both"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={hunkPicks[group.hunk!] === p}
                      onClick={() => pickHunk(group.hunk!, p)}
                    >
                      {p === "ours" ? "Mine" : p === "theirs" ? "Cloud" : "Both"}
                    </button>
                  ))}
                </div>
                {group.lines.map((l, j) => (
                  <DiffRow key={j} line={l} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const sign = line.op === "ours" ? "−" : line.op === "theirs" ? "+" : " ";
  return (
    <div className="sync-diff-line" data-op={line.op}>
      <span aria-hidden>{sign}</span>
      <code>{line.text || " "}</code>
    </div>
  );
}

/** Runs of unchanged lines, and each changed run tagged with its hunk index, as `diffBody` numbers them. */
function groupHunks(lines: DiffLine[]): { hunk: number | null; lines: DiffLine[] }[] {
  const groups: { hunk: number | null; lines: DiffLine[] }[] = [];
  let next = 0;
  for (const line of lines) {
    const changed = line.op !== "same";
    const last = groups[groups.length - 1];
    if (last && (last.hunk !== null) === changed) last.lines.push(line);
    else groups.push({ hunk: changed ? next++ : null, lines: [line] });
  }
  return groups;
}

function isSettled(field: Field, choice?: Choice): boolean {
  if (!choice) return false;
  if (choice.kind === "edit") return !hasConflictMarkers(choice.text);
  if (choice.kind === "hunks") {
    return diffBody(text(field.local), text(field.remote)).hunks.every((h) => choice.picks[h.index] !== undefined);
  }
  return true;
}

/** Markers named for the two sides of a sync, not the folder import they were written for. */
function deviceMarkers(ours: string, theirs: string): string {
  return writeConflictMarkers(ours, theirs)
    .split("\n")
    .map((l) => (l === MARKER_OURS ? "<<<<<<< this device" : l === MARKER_THEIRS ? ">>>>>>> cloud" : l))
    .join("\n");
}

function kindOf(table: string): string {
  const kind = table.replace(/_/g, " ").replace(/s$/, "");
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The row's own title rather than a uuid. */
function nameOf({ local, remote }: OpenConflict): string {
  const name = [local, remote ?? {}]
    .flatMap((row) => [row.title, row.name, row.label])
    .find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!name) return "Untitled";
  return name.length > 70 ? `${name.slice(0, 70)}…` : name;
}

function humanize(field: string): string {
  const words = field.replace(/_id$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isLong(value: unknown): boolean {
  return typeof value === "string" && (value.includes("\n") || value.length > 80);
}

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && ISO.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return value.length > 10 ? d.toLocaleString() : d.toLocaleDateString();
  }
  const out = typeof value === "string" ? value : JSON.stringify(value);
  return out.length > 80 ? `${out.slice(0, 80)}…` : out;
}

function raw(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
