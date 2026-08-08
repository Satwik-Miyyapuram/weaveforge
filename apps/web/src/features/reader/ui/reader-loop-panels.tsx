"use client";

import Link from "next/link";
import type { ActivityLogEntry } from "../application/batch-annotation-ops";

interface ActivityCenterProps {
  entries: ActivityLogEntry[];
  onClear?: () => void;
}

/** Lightweight sync/task log for the reader loop (R4 stub). */
export function ActivityCenter({ entries, onClear }: ActivityCenterProps) {
  return (
    <aside className="reader-activity" aria-label="Activity center">
      <div className="reader-activity-head">
        <strong>Activity</strong>
        {onClear && entries.length > 0 && (
          <button type="button" className="link-btn" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="muted">No recent reader tasks yet.</p>
      ) : (
        <ul className="reader-activity-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="muted">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="reader-activity-kind">{e.kind}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface ReaderSplitPanelProps {
  kind: "report" | "vault";
  title: string;
  bodyPreview: string;
  href: string;
  onClose: () => void;
}

export function ReaderSplitPanel({ kind, title, bodyPreview, href, onClose }: ReaderSplitPanelProps) {
  return (
    <aside className="reader-split-panel" aria-label={kind === "report" ? "Report section" : "Vault note"}>
      <div className="reader-split-head">
        <div>
          <p className="eyebrow">{kind === "report" ? "Report" : "Vault"}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="reader-split-body">{bodyPreview || "Nothing to preview yet."}</pre>
      <Link className="btn-secondary" href={href}>
        Open full {kind === "report" ? "section" : "note"}
      </Link>
    </aside>
  );
}
