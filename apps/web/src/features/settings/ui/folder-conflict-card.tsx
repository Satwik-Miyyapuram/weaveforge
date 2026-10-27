"use client";

import { useState } from "react";
import { diffBody, type HunkPick, type ImportDiffEntry } from "@weaveforge/core";
import {
  keepBothTitle,
  type ConflictPicks,
  type ConflictResolution,
} from "@/features/workspace/application/workspace-folder";
import { Button } from "@/components/button";

/**
 * One conflicted file, settled the way git settles one.
 *
 * The three shortcuts stay at the top — take this app's copy, take the folder's,
 * keep both — because most of the time one side obviously wins and a per-hunk
 * table would be ceremony. Under them are the two things git gives you and the
 * shortcuts cannot: a choice per frontmatter key, three-way over the values the
 * sides last agreed on, and a per-hunk choice over the body, two-way because
 * there is no base text to show.
 *
 * Every choice here defaults to ours, and nothing is written until the import is
 * run — so an untouched card changes nothing.
 */
export function FolderConflictCard({
  entry,
  chosen,
  onChoose,
  onWriteMarkers,
}: {
  entry: ImportDiffEntry;
  chosen: ConflictResolution;
  onChoose: (resolution: ConflictResolution) => void;
  onWriteMarkers?: () => Promise<boolean>;
}) {
  const [fields, setFields] = useState<Record<string, "ours" | "theirs">>({});
  const [hunks, setHunks] = useState<Record<number, HunkPick>>({});
  const [markers, setMarkers] = useState<"idle" | "writing" | "written" | "failed">("idle");

  const detail = entry.merge;
  const unresolved = entry.kind === "markers";
  const body = detail?.bodySides ? diffBody(detail.bodySides.ours, detail.bodySides.theirs) : null;

  const pick = (next: Partial<ConflictPicks>) => {
    onChoose({ kind: "picks", fields, hunks, ...next });
  };

  return (
    <li data-severity="error">
      {entry.reason ?? entry.entity.path}

      {unresolved && (
        <p className="muted jump-to-meta">
          Nothing is imported from a file that still holds markers. Take them out in the folder
          and this becomes an ordinary edit.
        </p>
      )}

      {!unresolved && detail && detail.disputed.length > 0 && (
        <div className="field">
          <p className="muted jump-to-meta">Both sides changed these:</p>
          <ul className="wiki-lint-list">
            {detail.disputed.map((dispute) => (
              <li key={dispute.field}>
                <code>{dispute.field}</code>
                <p className="muted jump-to-meta">
                  was {show(dispute.base)} · this app {show(dispute.ours)} · folder{" "}
                  {show(dispute.theirs)}
                </p>
                <div className="screen-actions">
                  {(["ours", "theirs"] as const).map((side) => (
                    <Button
                      key={side}
                      variant={(fields[dispute.field] ?? "ours") === side ? "secondary" : "ghost"}
                      aria-pressed={(fields[dispute.field] ?? "ours") === side}
                      onClick={() => {
                        const next = { ...fields, [dispute.field]: side };
                        setFields(next);
                        pick({ fields: next });
                      }}
                    >
                      {side === "ours" ? "This app's" : "The folder's"}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!unresolved && body && body.hunks.length > 0 && (
        <div className="field">
          <p className="muted jump-to-meta">
            The body changed on both sides. Take it hunk by hunk — an untaken hunk keeps this
            app&apos;s copy:
          </p>
          <ul className="wiki-lint-list">
            {body.hunks.map((hunk) => (
              <li key={hunk.index}>
                <pre className="muted">
                  {[
                    ...hunk.ours.map((line) => `- ${line}`),
                    ...hunk.theirs.map((line) => `+ ${line}`),
                  ].join("\n")}
                </pre>
                <div className="screen-actions">
                  {(["ours", "theirs", "both"] as const).map((side) => (
                    <Button
                      key={side}
                      variant={(hunks[hunk.index] ?? "ours") === side ? "secondary" : "ghost"}
                      aria-pressed={(hunks[hunk.index] ?? "ours") === side}
                      onClick={() => {
                        const next = { ...hunks, [hunk.index]: side };
                        setHunks(next);
                        pick({ hunks: next });
                      }}
                    >
                      {side === "ours" ? "This app's" : side === "theirs" ? "The folder's" : "Both"}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="screen-actions">
        <Button
          variant={chosen === "keep" ? "secondary" : "ghost"}
          aria-pressed={chosen === "keep"}
          onClick={() => onChoose("keep")}
        >
          Keep this app&apos;s
        </Button>
        {/* Not offered for a type mismatch: the id in the file names a paper or an
            experiment, so there is no note to write over. */}
        {entry.kind !== "type-mismatch" && (
          <Button
            variant={chosen === "folder" ? "secondary" : "ghost"}
            aria-pressed={chosen === "folder"}
            onClick={() => onChoose("folder")}
          >
            Keep the folder&apos;s
          </Button>
        )}
        <Button
          variant={chosen === "both" ? "secondary" : "ghost"}
          aria-pressed={chosen === "both"}
          onClick={() => onChoose("both")}
        >
          Keep both
        </Button>
        {!unresolved && body && onWriteMarkers && (
          <Button
            variant={chosen === "markers" ? "secondary" : "ghost"}
            aria-pressed={chosen === "markers"}
            disabled={markers === "writing"}
            onClick={() => {
              setMarkers("writing");
              void onWriteMarkers()
                .then((ok) => {
                  setMarkers(ok ? "written" : "failed");
                  if (ok) onChoose("markers");
                })
                .catch(() => setMarkers("failed"));
            }}
          >
            {markers === "writing"
              ? "Writing…"
              : markers === "written"
                ? "Markers written"
                : "Mark both in the file"}
          </Button>
        )}
      </div>

      {markers === "written" && (
        <p className="muted jump-to-meta">
          Both copies are in the file now, marked two-way. Edit it in whatever you like; the
          markers going is what tells this app it is settled.
        </p>
      )}
      {markers === "failed" && (
        <p className="muted jump-to-meta">
          The file could not be written — it may have moved or the folder may be read-only.
        </p>
      )}
      {chosen === "both" && (
        <p className="muted jump-to-meta">
          Imported as “{keepBothTitle(entry.entity.title)}”, leaving this app&apos;s copy as it is.
        </p>
      )}
    </li>
  );
}

/** A frontmatter value as a person reads it, or a dash when the key was absent. */
function show(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json.length > 60 ? `${json.slice(0, 57)}…` : json;
}
