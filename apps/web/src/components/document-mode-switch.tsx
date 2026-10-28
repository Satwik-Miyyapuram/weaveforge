"use client";

/**
 * Text · Ink, then Split: the one mode control a document shows, in the
 * Editor's toolbar and on a note's own page alike, so both offer the same
 * modes under the same names. A mode the document cannot take is greyed, not
 * hidden, so the control keeps its shape from one document to the next.
 *
 * Split is the rendered preview beside the text. In the Editor it is a tab of
 * its own (the caller passes `split`); on a page it is inline, beside or below
 * the editor, and which of the two lives in the ⋯ next to it.
 *
 * Here rather than in the editor workspace because the Notes page uses it too,
 * and a feature reaching into another's `ui/` fails `check:solid`.
 */

import { shortcutLabel } from "@/lib/shortcut-label";
import { readMdSplitSide, setMdSplitSide, useMdPreviewMode, type MdSplitSide } from "@/lib/hooks/use-md-preview-mode";
import { CardMenu } from "./card-menu";
import { ToggleButton } from "./controls";
import { SegmentedControl } from "./segmented-control";

export type DocumentModeName = "edit" | "ink" | "pdf";

const LABELS: Record<DocumentModeName, string> = { edit: "Text", ink: "Ink", pdf: "PDF" };
const TITLES: Record<DocumentModeName, string> = {
  edit: "Edit the text",
  ink: "Ink — write by hand",
  pdf: "The paper's PDF",
};

/** The mode segments: Text and Ink always, PDF only where there is one; each greyed when `modes` lacks it. */
export function modeOptions(modes: readonly DocumentModeName[]) {
  const shown: DocumentModeName[] = modes.includes("pdf") ? ["edit", "ink", "pdf"] : ["edit", "ink"];
  return shown.map((each) => ({ value: each, label: LABELS[each], title: TITLES[each], disabled: !modes.includes(each) }));
}

/** Split previews Markdown, so only Text has one. */
export const canSplit = (mode: DocumentModeName) => mode === "edit";

export function DocumentModeSwitch<M extends DocumentModeName>({
  modes,
  mode,
  onMode,
  split,
}: {
  modes: readonly M[];
  mode: M;
  onMode: (mode: M) => void;
  /** The Editor's preview tab. Without it, Split is the inline preview on this page. */
  split?: { on: boolean; onToggle: () => void };
}) {
  const [preview, setPreview] = useMdPreviewMode();
  const inline = !split;
  const on = split ? split.on : preview !== "off";
  const toggle = split ? split.onToggle : () => setPreview(on ? "off" : readMdSplitSide());
  const side = (each: MdSplitSide, label: string) => ({
    id: each,
    label,
    kind: "check" as const,
    checked: preview === each,
    onSelect: () => setMdSplitSide(each),
  });
  return (
    <span className="view-control">
      <SegmentedControl
        label="Mode"
        className="pane-mode"
        value={mode}
        onChange={(next) => onMode(next as M)}
        options={modeOptions(modes)}
      />
      <span className="wf-seg pane-split">
        <ToggleButton
          pressed={on && canSplit(mode)}
          disabled={!canSplit(mode)}
          title={`Preview beside the text (${shortcutLabel("⌘E")})`}
          onClick={toggle}
        >
          Split
        </ToggleButton>
      </span>
      {inline && on && canSplit(mode) && (
        <CardMenu label="Split options" items={[side("side", "Preview beside"), side("below", "Preview below")]} />
      )}
    </span>
  );
}
