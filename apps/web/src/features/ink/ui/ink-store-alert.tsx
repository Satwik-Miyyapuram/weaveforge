"use client";

import Link from "next/link";

import { INK_NEEDS_FOLDER } from "./use-ink-note-store";

/**
 * Why this note's ink is not loaded or not saved, shown over the sheet.
 *
 * The text layer is collapsed while writing, so a message kept only there was
 * never seen: a page that could not save showed nothing but "Unsaved".
 * With no workspace folder open, it links to where one is chosen.
 */
export function InkStoreAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error ink-store-alert" role="alert">
      {message}
      {message === INK_NEEDS_FOLDER && (
        <>
          {" "}
          <Link href="/settings#settings-workspace">Open folder</Link>
        </>
      )}
    </p>
  );
}
