"use client";

import { useState } from "react";
import { useSubmit } from "@/lib/hooks/use-submit";
import { LOG_KINDS, type LogKind } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";

/**
 * Add-log-entry form. UI only: it collects input and delegates to the
 * AddLogEntry use-case via the container. No persistence or business rules
 * live here (SRP).
 */
export function AddLogEntryForm({ onAdded }: { onAdded?: () => void }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<LogKind>("daily");

  const { busy, error, submit } = useSubmit(async () => {
    const logbook = getContainer().logbook;
    const entry = await logbook.addLogEntry.add({ body, kind });
    try { await logbook.pushLog(entry); } catch { /* git sync best-effort */ }
    setBody("");
    onAdded?.();
  });

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="body">What did you do?</label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Today I… (markdown supported)"
          rows={3}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="kind">Kind</label>
        <Select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as LogKind)}
        >
          {LOG_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Add log entry"}
      </button>
    </form>
  );
}
