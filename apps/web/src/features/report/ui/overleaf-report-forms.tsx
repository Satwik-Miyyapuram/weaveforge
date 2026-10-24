"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { linkOverleafReport } from "../application/link-overleaf-report";
import { type LinkedReport, local, api } from "./linked-overleaf-api";

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
      const gateway = local();
      if (gateway) await gateway.patchReport(patch);
      else await api("/api/overleaf/reports", { method: "PATCH", body: JSON.stringify(patch) });
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
        <button className="btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button>
        <button className="btn-secondary btn-cancel" disabled={busy} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function LinkOverleafForm({ projectId, onLinked, onError }: { projectId: string; onLinked: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError("");
    const form = new FormData(event.currentTarget);
    try {
      const gateway = local();
      const link = {
        projectId,
        title: String(form.get("title") ?? ""),
        overleafProjectId: String(form.get("overleafProjectId") ?? ""),
        entryFile: String(form.get("entryFile") ?? "main.tex"),
      };
      const name = String(form.get("connectionName") ?? "");
      const token = String(form.get("token") ?? "");
      await linkOverleafReport(link, gateway
        ? {
            saveConnection: () => gateway.saveConnection(name, token),
            createReport: (input) => gateway.createReport(input),
          }
        : {
            saveConnection: async () => {
              const id = (await api("/api/overleaf/connections", { method: "POST", body: JSON.stringify({ name, token }) })).connection?.id;
              if (!id) throw new Error("The Overleaf connection was not saved.");
              return id;
            },
            createReport: (input) => api("/api/overleaf/reports", { method: "POST", body: JSON.stringify(input) }),
          });
      onLinked();
    } catch (err) { onError(formatError(err)); }
    finally { setBusy(false); }
  }
  return <form className="linked-overleaf-form" onSubmit={(event) => void submit(event)}><label>Connection name<input name="connectionName" required placeholder="My Overleaf account" /></label><label>Overleaf Git token<input name="token" type="password" required autoComplete="off" /></label><label>Report title<input name="title" required placeholder="MSc thesis" /></label><label>Overleaf project ID<input name="overleafProjectId" required placeholder="1234567" /></label><label>Entry file<input name="entryFile" defaultValue="main.tex" required /></label><button className="btn-primary" disabled={busy} type="submit">{busy ? "Linking…" : "Save and link report"}</button></form>;
}
