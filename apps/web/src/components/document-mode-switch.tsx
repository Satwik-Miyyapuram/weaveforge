"use client";

/**
 * Edit / Read / Ink / PDF: the one mode switch a document shows, in the
 * Editor's pane header and on a note's own page alike, so the two offer the
 * same modes under the same names.
 *
 * Here rather than in the editor workspace because the Notes page uses it too,
 * and a feature reaching into another's `ui/` fails `check:solid`.
 */

import { shortcutLabel } from "@/lib/shortcut-label";
import { SegmentedControl } from "./segmented-control";

export type DocumentModeName = "edit" | "read" | "ink" | "pdf";

const MODE_LABELS: Record<DocumentModeName, string> = { edit: "Edit", read: "Read", ink: "Ink", pdf: "PDF" };
const MODE_TITLES: Record<DocumentModeName, string> = {
  edit: `Edit source (${shortcutLabel("⌘E")})`,
  read: `Read view (${shortcutLabel("⌘E")})`,
  ink: "Ink — write by hand",
  pdf: "The paper's PDF",
};

export function DocumentModeSwitch<M extends DocumentModeName>({
  modes,
  mode,
  onMode,
}: {
  modes: readonly M[];
  mode: M;
  onMode: (mode: M) => void;
}) {
  if (modes.length <= 1) return null;
  return (
    <SegmentedControl
      label="Document mode"
      size="sm"
      className="pane-mode"
      value={mode}
      onChange={onMode}
      options={modes.map((each) => ({ value: each, label: MODE_LABELS[each], title: MODE_TITLES[each] }))}
    />
  );
}
