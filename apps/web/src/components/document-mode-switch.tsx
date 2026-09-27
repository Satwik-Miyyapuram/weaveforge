"use client";

/**
 * Edit / Read / Ink / PDF: the one mode switch a document shows, in the
 * Editor's pane header and on a note's own page alike, so the two offer the
 * same modes under the same names.
 *
 * Here rather than in the editor workspace because the Notes page uses it too,
 * and a feature reaching into another's `ui/` fails `check:solid`.
 */

export type DocumentModeName = "edit" | "read" | "ink" | "pdf";

const MODE_LABELS: Record<DocumentModeName, string> = { edit: "Edit", read: "Read", ink: "Ink", pdf: "PDF" };
const MODE_TITLES: Record<DocumentModeName, string> = {
  edit: "Edit source (⌘E)",
  read: "Read view (⌘E)",
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
  return (
    <div className="pane-mode" role="group" aria-label="Document mode">
      {modes.map((each) => (
        <button
          key={each}
          type="button"
          className={`pane-mode-btn${mode === each ? " is-on" : ""}`}
          aria-pressed={mode === each}
          title={MODE_TITLES[each]}
          onClick={() => onMode(each)}
        >
          {MODE_LABELS[each]}
        </button>
      ))}
    </div>
  );
}
