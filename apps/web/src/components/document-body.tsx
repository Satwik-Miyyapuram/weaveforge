"use client";

import dynamic from "next/dynamic";
import type { DocumentHostProps } from "@/features/editor-workspace/ui/document-host";

/**
 * The Editor's document engine — Edit, Read and Ink for every kind — for a
 * record page (a note's, a paper's) to mount under its own mode switch.
 *
 * The same `DocumentHost` the Editor's panes mount, imported rather than
 * rebuilt, so a note or a paper reads, edits and inks here exactly as it does
 * in a tab. Here, in the composition layer, because the host itself imports
 * the notes and papers features: a feature importing it back would be a cycle.
 * Lazy, because the host carries the editor, the ink surface and the reader,
 * none of which a record page needs until its body is on screen.
 */
const LazyDocumentHost = dynamic(
  () => import("@/features/editor-workspace/ui/document-host").then((m) => m.DocumentHost),
  {
    ssr: false,
    loading: () => <p className="muted">Loading…</p>,
  },
);

export function DocumentBody(props: DocumentHostProps) {
  return <LazyDocumentHost {...props} />;
}
