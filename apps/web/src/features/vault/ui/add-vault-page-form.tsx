"use client";

import { useState } from "react";
import { useSubmit } from "@/lib/hooks/use-submit";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";

export function AddVaultPageForm({
  parents,
  onAdded,
  onClose,
}: {
  parents: { id: string; title: string }[];
  onAdded: (pageId: string) => void;
  onClose?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");

  const { busy, error, submit } = useSubmit(async () => {
    const page = await getContainer().vault.manageVaultPage.add({
      title,
      parentId: parentId || undefined,
    });
    onAdded(page.id);
    setTitle("");
    setParentId("");
  });

  return (
    <form className="add-form" onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="note-title">Title</label>
        <input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      {parents.length > 0 && (
        <div className="field">
          <label htmlFor="note-parent">Parent (optional)</label>
          <Select id="note-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Parent note">
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </Select>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="form-foot">
        {onClose && (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className="btn-primary" type="submit" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create note"}
        </button>
      </div>
    </form>
  );
}
