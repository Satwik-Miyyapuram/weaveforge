"use client";

/**
 * Why this note's ink is not loaded or not saved, shown over the sheet.
 *
 * The text layer is collapsed while writing, so a message kept only there was
 * never seen: a page that could not save showed nothing but "Unsaved".
 */
export function InkStoreAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error ink-store-alert" role="alert">
      {message}
    </p>
  );
}
