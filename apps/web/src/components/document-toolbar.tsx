"use client";

/**
 * The one bar for a document outside the Editor (a vault note, a paper note, a
 * report section): its mode switch, then the same bar the Editor's toolbar
 * shows, in one strip that sticks to the top while the document scrolls.
 *
 * A live ink sheet portals its bar into the slot, as it does in the Editor, and
 * the greyed bar after it gives way (editor-workspace.css). In ink focus the
 * sheet keeps its bar with it, so the strip steps aside.
 */

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { type InkMenuAction, type InkMenuSection } from "@/features/ink";
import {
  EDITOR_CITATION_FORMATS,
  EDITOR_CITATION_FORMAT_LABELS,
  type EditorCitationFormat,
} from "@/lib/citation-format-preference";
import type { EditorHandleRef } from "./editor-handle";
import { ToolbarSlotContext } from "./toolbar-slot";

/*
 * The ink feature is loaded on demand: a note, paper or report section that is
 * not inking should not carry the pen, the renderer and the text layer on its
 * first load (the bundle budget). Until it arrives the greyed bar stands in.
 */
const LazyInkIdleBar = dynamic(
  () => import("@/features/ink").then((m) => m.InkIdleBar),
  {
    ssr: false,
    loading: () => <span className="workspace-toolbar-doc workspace-toolbar-idle" />,
  },
);

export interface DocumentToolbarProps {
  /** Before the bar: the mode switch and the focus button. */
  lead?: ReactNode;
  /** The text editor a picture goes into; absent, Insert offers no picture. */
  editor?: EditorHandleRef;
  /** Where the screen shows errors; `null` clears it once a picture is taken. */
  onError: (message: string | null) => void;
  insertItems?: readonly InkMenuAction[];
  moreSections?: readonly InkMenuSection[];
  /** Ink focus is on: the sheet keeps its bar, so no strip. */
  focus?: boolean;
  children: ReactNode;
}

export function DocumentToolbar({ lead, editor, onError, insertItems, moreSections, focus = false, children }: DocumentToolbarProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  function insertImage(file: File) {
    const handle = editor?.current;
    // Null only in the moment before the lazily-loaded editor has mounted.
    if (!handle) {
      onError("The editor is still loading — try that again in a moment.");
      return;
    }
    onError(null);
    handle.insertFiles([file]);
  }

  return (
    <>
      {!focus && (
        <div className="document-toolbar" role="toolbar" aria-label="Document">
          {lead}
          <span className="workspace-toolbar-doc" ref={setSlot} />
          <LazyInkIdleBar onInsertImage={editor ? insertImage : undefined} insertItems={insertItems} moreSections={moreSections} />
        </div>
      )}
      <ToolbarSlotContext.Provider value={focus ? undefined : slot}>{children}</ToolbarSlotContext.Provider>
    </>
  );
}

/** More → Cite as: how an @-cite is written into the note. */
export function citeAsSection(value: EditorCitationFormat, onChange: (value: EditorCitationFormat) => void): InkMenuSection {
  return {
    label: "Cite as",
    items: EDITOR_CITATION_FORMATS.map((format) => ({
      label: EDITOR_CITATION_FORMAT_LABELS[format],
      checked: value === format,
      onSelect: () => onChange(format),
    })),
  };
}
