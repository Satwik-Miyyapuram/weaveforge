"use client";

import { useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { ImageIcon } from "@/components/view-icons";
import { formatError } from "@/lib/format-error";
import type { Experiment } from "@weaveforge/core";

/**
 * Attach a file to a run from the app.
 *
 * Until now artifacts only arrived through the SDK, so a plot drawn after the
 * run finished — the one that actually explains the result — had nowhere to
 * live. Any file is accepted, not only images: the panel already renders
 * non-images as links, and a metrics dump beside its figure is the point.
 */
export function AttachArtifactsButton({
  experimentId,
  onAttached,
  onError,
}: {
  experimentId: string;
  onAttached: (experiment: Experiment) => void;
  onError: (message: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function attach(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    onError(null);
    try {
      onAttached(await getContainer().experiments.attachArtifacts(experimentId, files));
    } catch (err) {
      onError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="entity-icon-btn"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label="Attach artifact"
        title={busy ? "Uploading…" : "Attach"}
      >
        <ImageIcon />
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void attach([...(e.target.files ?? [])]);
          // Cleared so choosing the same file twice fires again.
          e.target.value = "";
        }}
      />
    </>
  );
}
