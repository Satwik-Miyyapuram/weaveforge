"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";

/** A note that can hold others — every note can; the tree nests by parent. */
export interface FolderOption {
  id: string;
  title: string;
  /** How deep it sits, for the indent in the list. */
  depth: number;
}

/**
 * Naming a new note, or a new folder.
 *
 * The same box as quick open, opened by the explorer's buttons and `⌘N`, so
 * making a note is a name and Enter rather than a trip to `/notes`. A folder
 * is a note with children — that is how the notes tree nests — so "New folder"
 * is the same dialog with the word changed, and a note created under a folder
 * is a note created with that parent.
 */
export function NewDocumentDialog({
  kind,
  folders,
  initialParentId,
  onCreate,
  onClose,
}: {
  kind: "note" | "ink" | "folder";
  folders: readonly FolderOption[];
  /** Pre-selected parent: the folder the document on screen sits in. */
  initialParentId?: string;
  onCreate: (input: { title: string; parentId?: string; ink?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState(initialParentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const label = kind === "folder" ? "New folder" : kind === "ink" ? "New ink note" : "New note";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: trimmed, parentId: parentId || undefined, ...(kind === "ink" ? { ink: true } : {}) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="quick-open-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="quick-open new-document"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <input
          ref={inputRef}
          className="quick-open-input search-input"
          value={title}
          placeholder={kind === "folder" ? "Folder name" : kind === "ink" ? "Ink note title" : "Note title"}
          aria-label={kind === "folder" ? "Folder name" : kind === "ink" ? "Ink note title" : "Note title"}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="new-document-row">
          <label className="new-document-parent">
            <span className="muted">In</span>
            <Select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="Parent folder">
              <option value="">Notes (top level)</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {`${"  ".repeat(folder.depth)}${folder.title || "Untitled"}`}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || busy}>
            {busy ? "Creating…" : label}
          </button>
        </div>
        {error ? <FormError>{error}</FormError> : null}
      </form>
    </div>
  );
}
