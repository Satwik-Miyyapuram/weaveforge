"use client";

import { useState } from "react";
import { useSubmit } from "@/lib/hooks/use-submit";
import { LOG_KINDS, type LogKind } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { bestEffort } from "../application/log-side-effects";
import { Button } from "@/components/button";
import { MarkdownField } from "@/components/markdown-field";
import { logImageUpload } from "./log-image-upload";

/**
 * Add-log-entry form. UI only: it collects input and delegates to the
 * AddLogEntry use-case via the container. No persistence or business rules
 * live here (SRP).
 */
export function AddLogEntryForm({ onAdded }: { onAdded?: () => void }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<LogKind>("daily");
  const [imageError, setImageError] = useState<string | null>(null);
  // The entry has no id until Create, so its images go under a folder of
  // their own, made once per form.
  const [imagePaste] = useState(() => logImageUpload(crypto.randomUUID(), setImageError));

  const { busy, error, submit } = useSubmit(async () => {
    const logbook = getContainer().logbook;
    const entry = await logbook.addLogEntry.add({ body, kind });
    await bestEffort("Git push", () => logbook.pushLog(entry));
    await bestEffort("Chat post", () => logbook.notifyNewLog(entry));
    setBody("");
    onAdded?.();
  });

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field">
        <label id="log-new-body">What did you do?</label>
        <MarkdownField
          value={body}
          onChange={setBody}
          placeholder="Today I… (markdown supported)"
          labelledBy="log-new-body"
          className="log-body-editor"
          imagePaste={imagePaste}
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
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      {(error ?? imageError) && <FormError>{error ?? imageError}</FormError>}
      <Button type="submit" variant="primary" disabled={busy || !body.trim()}>
        {busy ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
