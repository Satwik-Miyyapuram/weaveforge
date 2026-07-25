"use client";

import { useState } from "react";
import { downloadUserDataExport } from "@/features/export/application/export-user-data";

/** Settings → "Your data": one-click ZIP export of the account. */
export function ExportDataPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await downloadUserDataExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="settings-data" className="card export-data-panel settings-anchor">
      <h3>Your data</h3>
      <p className="muted">
        Download everything in your account as a ZIP — notes, papers, reading lists, report
        outline, experiments, milestones, log entries, and embedded images. Content is plain
        text inside the archive, so store it somewhere safe.
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn-secondary" type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Preparing…" : "Download my data (ZIP)"}
      </button>
    </section>
  );
}
