"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { MarkdownCodeEditor as MarkdownCodeEditorType } from "./markdown-code-editor";

type Props = ComponentProps<typeof MarkdownCodeEditorType>;

/**
 * Lazy boundary for the markdown editor. CodeMirror (+ @codemirror/language-data)
 * is heavy and only needed once the user actually edits, so it is code-split out
 * of each screen's first-load bundle and fetched on first use. Preview/read paths
 * use Shiki instead and never pull this chunk.
 */
const LazyEditor = dynamic(
  () => import("./markdown-code-editor").then((m) => m.MarkdownCodeEditor),
  {
    ssr: false,
    loading: () => (
      <div className="markdown-code-editor markdown-code-editor--loading" aria-busy="true">
        Loading editor…
      </div>
    ),
  },
);

export function MarkdownCodeEditor(props: Props) {
  return <LazyEditor {...props} />;
}
