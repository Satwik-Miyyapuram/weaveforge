"use client";

import { useState } from "react";
import type { ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { LIST_COLOR_PRESETS } from "./list-ui";
import { formatError } from "@/lib/format-error";

/**
 * Add-list form. UI only: collects input and delegates to the manage use-case.
 * `parents` allows nesting the new list under an existing one (sublist).
 */
export function AddListForm({
  parents,
  onAdded,
}: {
  parents: ReadingList[];
  onAdded?: () => void;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [color, setColor] = useState<string>(LIST_COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getContainer().readingLists.manageReadingList.createList({
        name,
        parentId: parentId || undefined,
        color,
      });
      setName("");
      onAdded?.();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="name">List name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Disentanglement"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="parent">Sublist of</label>
          <Select
            id="parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— top level —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="field">
        <span className="list-color-label">Color</span>
        <div className="list-color-picks" role="group" aria-label="List color">
          {LIST_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`list-color-pick${color === c ? " on" : ""}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add list"}
      </button>
    </form>
  );
}
