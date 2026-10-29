"use client";

/**
 * Live preview while editing: the markdown rendered beside or under the
 * source editor, re-rendering as the document changes.
 *
 * Two layouts, because two ways of writing suit two people (the ask): *side*
 * puts the rendered document in a column of its own next to the editor, and
 * *below* stacks the two in the one column, for a pane that is tall rather
 * than wide. Both are the same idea — the preview reads the editor's live
 * text, not the last save, so it is what the person is typing, not what they
 * typed half a minute ago — and both are the read view's own renderer,
 * reused, so a preview and a read never disagree about what a document means.
 *
 * Which one, if any, is the document's View control (Edit · Split · Read,
 * `DocumentModeSwitch`); the choice is shared app-wide (`useMdPreviewMode`).
 */

import type { ReactNode } from "react";

import type { MdPreviewMode } from "@/lib/hooks/use-md-preview-mode";

/** What the preview renders: the editor's text once it has reported, even emptied; the saved body before. */
export function previewBody(liveBody: string | null, savedBody: string): string {
  return liveBody ?? savedBody;
}

/**
 * The editor and its preview, laid out as the choice says.
 *
 * `liveBody` is the editor's own current text — the same stream the outline
 * reads — and `savedBody` is what renders before the editor has reported
 * anything, because a document that has just opened is worth previewing too.
 */
export function LivePreview({
  mode,
  liveBody,
  savedBody,
  preview,
  children,
}: {
  mode: MdPreviewMode;
  /** The editor's text as it stands, `null` before the editor has reported. */
  liveBody: string | null;
  /** The document's last saved body, the preview's opening text. */
  savedBody: string;
  /** The read view's renderer for this document, invoked with a body. */
  preview: (body: string) => ReactNode;
  /** The source editor. */
  children: ReactNode;
}) {
  if (mode === "off") {
    return <div className="md-live">{children}</div>;
  }
  return (
    <div className={`md-live md-live--${mode}`}>
      <div className="md-live-editor">{children}</div>
      <div
        className="md-live-pane"
        role="complementary"
        aria-label="Preview, rendered as you type"
      >
        {preview(previewBody(liveBody, savedBody))}
      </div>
    </div>
  );
}
