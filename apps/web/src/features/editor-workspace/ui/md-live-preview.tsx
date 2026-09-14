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
 * The choice is remembered the way the pen guard is (`weaveforge.ink.penOnly`),
 * because it is a preference about the person, not about a document.
 */

import { useEffect, useState } from "react";

import type { ReactNode } from "react";

/** The localStorage key, one per app like the pen guard's. */
export const MD_PREVIEW_KEY = "weaveforge.md.preview";

export type MdPreviewMode = "off" | "side" | "below";

/** The remembered choice, `off` for anything the key does not hold. */
export function readMdPreviewMode(): MdPreviewMode {
  if (typeof window === "undefined") return "off";
  const value = window.localStorage.getItem(MD_PREVIEW_KEY);
  return value === "side" || value === "below" ? value : "off";
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
  onModeChange,
  liveBody,
  savedBody,
  preview,
  children,
}: {
  mode: MdPreviewMode;
  onModeChange: (mode: MdPreviewMode) => void;
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
    return (
      <div className="md-live">
        <PreviewToggle mode={mode} onModeChange={onModeChange} />
        {children}
      </div>
    );
  }
  return (
    <div className={`md-live md-live--${mode}`}>
      <div className="md-live-editor">
        <PreviewToggle mode={mode} onModeChange={onModeChange} />
        {children}
      </div>
      <div
        className="md-live-pane"
        role="complementary"
        aria-label="Preview, rendered as you type"
      >
        {preview(liveBody ?? savedBody)}
      </div>
    </div>
  );
}

/**
 * The choice itself: three states, told apart by icon-free words, because a
 * glyph for "below" versus "side" is a riddle and a word is not.
 */
function PreviewToggle({
  mode,
  onModeChange,
}: {
  mode: MdPreviewMode;
  onModeChange: (mode: MdPreviewMode) => void;
}) {
  const choices: { value: MdPreviewMode; label: string; hint: string }[] = [
    { value: "off", label: "source", hint: "The editor alone" },
    { value: "side", label: "side", hint: "The preview in a column beside the editor" },
    { value: "below", label: "below", hint: "The preview under the editor, one column" },
  ];
  return (
    <div className="md-live-choice" role="group" aria-label="Live preview">
      <span className="md-live-choice-label">preview</span>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className={`md-live-option${mode === choice.value ? " is-on" : ""}`}
          aria-pressed={mode === choice.value}
          title={choice.hint}
          onClick={() => onModeChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** The toggle's own state, remembered across sessions (the pen guard's trick). */
export function useMdPreviewMode(): [MdPreviewMode, (mode: MdPreviewMode) => void] {
  const [mode, setMode] = useState<MdPreviewMode>("off");
  useEffect(() => {
    setMode(readMdPreviewMode());
  }, []);
  const choose = (next: MdPreviewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MD_PREVIEW_KEY, next);
    } catch {
      // A private window that refuses: the choice lasts the session, which is
      // still a choice.
    }
  };
  return [mode, choose];
}
