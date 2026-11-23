"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { type LinkedReport, api } from "./linked-overleaf-api";
import { Button } from "@/components/button";

/**
 * Edits this app's link row — title, which Overleaf project it points at, and
 * the entry file. Nothing here writes to Overleaf; changing the project id just
 * re-points the link, and the next fetch clones the new target.
 *
 * The connection (token) is deliberately not editable here: it belongs to the
 * account, not to one report.
 */
export function EditOverleafReportForm({ report, onSaved, onCancel, onError }: {
  report: LinkedReport;
  onSaved: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError("");
    const form = new FormData(event.currentTarget);
    try {
      const patch = {
        id: report.id,
        title: String(form.get("title") ?? ""),
        overleafProjectId: String(form.get("overleafProjectId") ?? ""),
        entryFile: String(form.get("entryFile") ?? ""),
      };
      await api("/api/overleaf/reports", { method: "PATCH", body: JSON.stringify(patch) });
      onSaved();
    } catch (err) { onError(formatError(err)); }
    finally { setBusy(false); }
  }
  return (
    <form className="linked-overleaf-form linked-overleaf-form--edit" onSubmit={(event) => void submit(event)}>
      <label>Report title<input name="title" required defaultValue={report.title} /></label>
      <label>Overleaf project ID<input name="overleafProjectId" required defaultValue={report.overleaf_project_id} /></label>
      <label>Entry file<input name="entryFile" required defaultValue={report.entry_file} /></label>
      <div className="linked-overleaf-form__actions">
        <Button variant="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</Button>
        <Button variant="cancel" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
