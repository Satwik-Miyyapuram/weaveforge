"use client";

import dynamic from "next/dynamic";
import type { MarkdownFieldProps } from "@/components/markdown/markdown-field-editor";

/**
 * Lazy boundary for the note editor as a form field, so a screen that shows
 * it behind a button does not carry CodeMirror in its first load.
 */
const LazyMarkdownField = dynamic(
  () => import("@/components/markdown/markdown-field-editor").then((m) => m.MarkdownFieldEditor),
  {
    ssr: false,
    loading: () => (
      <div className="vault-body-input markdown-code-editor--loading" aria-busy="true">
        Loading editor…
      </div>
    ),
  },
);

export function MarkdownField(props: MarkdownFieldProps) {
  return <LazyMarkdownField {...props} />;
}
