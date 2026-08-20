"use client";

import { useRef } from "react";
import { ImageIcon } from "@/components/view-icons";
import type { EditorHandleRef } from "./editor-handle";

/**
 * The toolbar button that puts a picture into the note being edited.
 *
 * A component rather than three copies of the same twenty lines. Vault notes,
 * report sections and paper notes each had their own button, their own hidden
 * `<input type="file">`, their own ref to click it with, and their own handler —
 * all identical, which is how the vault's version ended up clearing the file
 * input while the report's did not, so choosing the same file twice did nothing
 * there.
 *
 * The screen keeps only what actually differs: whether the button is shown at
 * all, whether it is disabled, and where its errors go.
 */
export function AttachImageButton({
  editor,
  onError,
  disabled,
}: {
  /** The editor to insert into; empty until it is on screen. */
  editor: EditorHandleRef;
  /**
   * Where this screen shows its errors. Called with `null` when a picture is
   * accepted, which clears whatever was showing — every screen did that before
   * inserting, and dropping it would leave a stale failure next to a picture
   * that arrived fine.
   */
  onError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(file: File | null) {
    if (!file) return;
    const handle = editor.current;
    // Null only in the moment before the lazily-loaded editor has mounted.
    // Saying so beats a button that appears to do nothing.
    if (!handle) {
      onError("The editor is still loading — try that again in a moment.");
      return;
    }
    onError(null);
    handle.insertFiles([file]);
  }

  return (
    <>
      <button
        type="button"
        className="entity-icon-btn"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        aria-label="Add image"
        title="Image"
      >
        <ImageIcon />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null);
          // Cleared so choosing the same file twice fires again.
          e.target.value = "";
        }}
      />
    </>
  );
}
