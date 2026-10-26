"use client";

/**
 * Edit · Split · Read · Ink · PDF: the one View control a document shows, in
 * the Editor's pane header and on a note's own page alike, so the two offer
 * the same modes under the same names. Split is Edit with the live preview
 * beside or below it (DA-103); which of the two lives in the ⋯ next to it.
 *
 * Here rather than in the editor workspace because the Notes page uses it too,
 * and a feature reaching into another's `ui/` fails `check:solid`.
 */

import { shortcutLabel } from "@/lib/shortcut-label";
import {
  readMdSplitSide,
  setMdSplitSide,
  useMdPreviewMode,
  type MdPreviewMode,
  type MdSplitSide,
} from "@/lib/hooks/use-md-preview-mode";
import { CardMenu } from "./card-menu";
import { SegmentedControl } from "./segmented-control";

export type DocumentModeName = "edit" | "read" | "ink" | "pdf";
type ViewName = DocumentModeName | "split";

const VIEW_LABELS: Record<ViewName, string> = { edit: "Edit", split: "Split", read: "Read", ink: "Ink", pdf: "PDF" };
const VIEW_TITLES: Record<ViewName, string> = {
  edit: `Edit source (${shortcutLabel("⌘E")})`,
  split: "Edit with the preview beside or below",
  read: `Read view (${shortcutLabel("⌘E")})`,
  ink: "Ink — write by hand",
  pdf: "The paper's PDF",
};

const canSplit = (modes: readonly DocumentModeName[]) => modes.includes("edit") && modes.includes("read");

/** The View control's choices: the modes, with Split after Edit when there is a Read to preview. */
export function viewOptions(modes: readonly DocumentModeName[]) {
  const views = modes.flatMap((each): ViewName[] => (each === "edit" && canSplit(modes) ? ["edit", "split"] : [each]));
  return views.map((each) => ({ value: each, label: VIEW_LABELS[each], title: VIEW_TITLES[each] }));
}

/** What the control shows as chosen. */
export function viewValue(modes: readonly DocumentModeName[], mode: DocumentModeName, preview: MdPreviewMode): ViewName {
  return mode === "edit" && preview !== "off" && canSplit(modes) ? "split" : mode;
}

/** What choosing a view does: the document mode, and for Edit or Split the preview. */
export function viewChoice(view: ViewName, side: MdSplitSide): { mode: DocumentModeName; preview?: MdPreviewMode } {
  if (view === "split") return { mode: "edit", preview: side };
  if (view === "edit") return { mode: "edit", preview: "off" };
  return { mode: view };
}

export function DocumentModeSwitch<M extends DocumentModeName>({
  modes,
  mode,
  onMode,
}: {
  modes: readonly M[];
  mode: M;
  onMode: (mode: M) => void;
}) {
  const [preview, setPreview] = useMdPreviewMode();
  if (modes.length <= 1) return null;
  const value = viewValue(modes, mode, preview);
  const choose = (view: ViewName) => {
    const next = viewChoice(view, readMdSplitSide());
    if (next.preview) setPreview(next.preview);
    onMode(next.mode as M);
  };
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
        label="View"
        size="sm"
        className="pane-mode"
        value={value}
        onChange={choose}
        options={viewOptions(modes)}
      />
      {value === "split" && (
        <CardMenu label="Split options" items={[side("side", "Preview beside"), side("below", "Preview below")]} />
      )}
    </span>
  );
}
