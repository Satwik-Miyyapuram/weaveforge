"use client";

/**
 * Text · Ink, then Preview: the one mode control a document shows, in the
 * Editor's path row and on a note's own page alike, so both offer the same
 * modes under the same icons. A mode the document cannot take is greyed, not
 * hidden, so the control keeps its shape from one document to the next.
 *
 * There is no PDF mode: a PDF is read and inked in one place, so it is Ink,
 * with Text greyed beside it.
 *
 * Preview is the rendered Markdown beside the text. In the Editor it is a tab of
 * its own, toggled from the toolbar (the caller passes `split={false}`); on a
 * page it is inline, beside or below the editor, and which of the two lives in
 * the ⋯ next to it.
 *
 * Here rather than in the editor workspace because the Notes page uses it too,
 * and a feature reaching into another's `ui/` fails `check:solid`.
 */

import type { ReactNode } from "react";

import { shortcutLabel } from "@/lib/shortcut-label";
import { readMdSplitSide, setMdSplitSide, useMdPreviewMode, type MdSplitSide } from "@/lib/hooks/use-md-preview-mode";
import { CardMenu } from "./card-menu";
import { ToggleButton } from "./controls";
import { toolIcon } from "./ink-tool-icons";
import { SegmentedControl } from "./segmented-control";
import { TextIcon } from "./view-icons";

export type DocumentModeName = "edit" | "ink";

const NAMES: Record<DocumentModeName, string> = { edit: "Text", ink: "Ink" };
const ICONS: Record<DocumentModeName, () => ReactNode> = { edit: () => <TextIcon />, ink: () => toolIcon("pen") };
const TITLES: Record<DocumentModeName, string> = {
  edit: "Edit the text",
  ink: "Ink — write by hand",
};

/** The mode segments: Text and Ink, always; each greyed when `modes` lacks it. */
export function modeOptions(modes: readonly DocumentModeName[]) {
  const shown: DocumentModeName[] = ["edit", "ink"];
  return shown.map((each) => ({
    value: each,
    label: ICONS[each](),
    ariaLabel: NAMES[each],
    title: TITLES[each],
    disabled: !modes.includes(each),
  }));
}

/** Preview renders Markdown, so only Text has one. */
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
  /** `false`: no Preview here (the Editor's toolbar has it). Otherwise Preview is inline on this page. */
  split?: false;
}) {
  const [preview, setPreview] = useMdPreviewMode();
  const inline = split === undefined;
  const on = preview !== "off";
  const toggle = () => setPreview(on ? "off" : readMdSplitSide());
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
      {split !== false && (
      <span className="wf-seg pane-split">
        <ToggleButton
          pressed={on && canSplit(mode)}
          disabled={!canSplit(mode)}
          title={`Preview beside the text (${shortcutLabel("⌘E")})`}
          onClick={toggle}
        >
          Preview
        </ToggleButton>
      </span>
      )}
      {inline && on && canSplit(mode) && (
        <CardMenu label="Split options" items={[side("side", "Preview beside"), side("below", "Preview below")]} />
      )}
    </span>
  );
}
