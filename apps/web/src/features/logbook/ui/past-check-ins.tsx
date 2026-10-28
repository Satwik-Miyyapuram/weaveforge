"use client";

import type { LabSnapshot } from "@weaveforge/core";
import { CommentsToggle } from "@/features/sharing";

/** Latest first, without touching the caller's list. */
export function newestFirst(snapshots: readonly LabSnapshot[]): LabSnapshot[] {
  return [...snapshots].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/**
 * The check-ins this student has sent (design S-15), each with the comments
 * the supervisor left on it (D-23). A sent check-in never changes, so a
 * comment always reads against what the supervisor saw.
 */
export function PastCheckIns({ snapshots, error }: { snapshots: readonly LabSnapshot[]; error: string | null }) {
  return (
    <div className="card log-check-ins">
      <h2>Past check-ins</h2>
      {snapshots.length === 0 ? (
        <p className="muted">{error ? "Past check-ins show when you are online." : "No check-ins sent yet."}</p>
      ) : (
        <ul>
          {newestFirst(snapshots).map((s) => (
            <li key={s.id} className="log-check-in">
              <span className="log-check-in-title">{s.title}</span>
              <time dateTime={s.publishedAt} className="muted">{s.publishedAt.slice(0, 10)}</time>
              <CommentsToggle resourceType="lab_snapshot" resourceId={s.id} canComment isOwner />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
