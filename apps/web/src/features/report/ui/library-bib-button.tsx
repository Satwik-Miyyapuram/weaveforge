"use client";

import { useState } from "react";
import { getContainer } from "@/bootstrap";
import { Button } from "@/components/button";
import { libraryBibtex } from "@/features/overleaf/application/bibtex-export";
import type { UploadResult } from "@/features/overleaf/infrastructure/overleaf-upload";

export const LIBRARY_BIB = "weaveforge.bib";

/**
 * Writes the paper library into the open Overleaf project as `weaveforge.bib`,
 * then tells Overleaf to re-read its .bib files so `\cite{` offers every paper.
 * `upload` is null until the project has joined (or when it is read-only).
 */
export function LibraryBibButton({ upload }: { upload: ((name: string, text: string) => Promise<UploadResult>) | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!upload) return null;

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const papers = await getContainer().papers.listPapers();
      const result = await upload(LIBRARY_BIB, libraryBibtex(papers));
      if (!result.ok) return setNote(result.message);
      window.dispatchEvent(new CustomEvent("reference:added"));
      setNote(`${papers.length} papers in ${LIBRARY_BIB}. Cite them with \\addbibresource{${LIBRARY_BIB}}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The library could not be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title={`Write your paper library into this project as ${LIBRARY_BIB}; replaces the file if it is there`}
        onClick={() => void run()}
      >
        {busy ? "Saving…" : "Library → .bib"}
      </Button>
      {note && <span className="muted" role="status">{note}</span>}
    </>
  );
}
