"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import {
  downloadUserDataExport,
  downloadWorkspaceFolder,
} from "@/features/export/application/export-user-data";

/** Settings → "Your data": ZIP export of the account, as JSON or as markdown. */
export function ExportDataPanel() {
  const [busy, setBusy] = useState<"json" | "folder" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "json" | "folder") {
    setBusy(kind);
    setError(null);
    try {
      await (kind === "folder" ? downloadWorkspaceFolder() : downloadUserDataExport());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="settings-data" className="card export-data-panel settings-anchor">
      <h3>Your data</h3>
      <p className="muted">
        Download everything in your account — notes, papers, reading lists, report outline,
        experiments, milestones, log entries, and embedded images. Content is plain text inside
        the archive, so store it somewhere safe.
      </p>
      <p className="muted">
        The <strong>markdown folder</strong> opens directly in Obsidian or VS Code: one file per
        note, nested the way your notes are, with images alongside. Every file records its id, so
        renaming or moving files is safe. The <strong>JSON archive</strong> is the exact
        machine-readable shape, better for scripts and backups.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="field-row-equal">
        <button
          className="btn-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => void run("folder")}
        >
          {busy === "folder" ? "Preparing…" : "Download markdown folder (ZIP)"}
        </button>
        <button
          className="btn-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => void run("json")}
        >
          {busy === "json" ? "Preparing…" : "Download JSON archive (ZIP)"}
        </button>
      </div>
    </section>
  );
}
