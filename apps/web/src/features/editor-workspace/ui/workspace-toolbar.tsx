"use client";

import type { ReactNode } from "react";

import { IconButton } from "@/components/button";
import { DocumentModeSwitch, type DocumentModeName } from "@/components/document-mode-switch";
import { FocusGlyph } from "@/components/focus-glyph";
import { shortcutLabel } from "@/lib/shortcut-label";
import {
  activeTabRef,
  isPreviewTab,
  previewOpen,
  tabMode,
  type DocumentMode,
  type PaneLayout,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";
import { modesFor } from "./kind";
import { SplitGlyph } from "./split-glyph";

/**
 * The Editor's one toolbar, over every pane: the mode of the focused document,
 * its tools, then the layout (preview, split, focus). It acts on the focused
 * pane, so a split screen has one set of controls rather than one per pane,
 * and a control the document cannot use is greyed rather than gone.
 */
export function WorkspaceToolbar({
  layout,
  renderTools,
  onSetMode,
  onTogglePreview,
  onSplit,
  onToggleFocus,
}: {
  layout: PaneLayout;
  /** The document's tools (the image button); `enabled` is false outside Text. */
  renderTools?: (tab: TabRef | undefined, enabled: boolean) => ReactNode;
  onSetMode: (tab: TabRef, mode: DocumentMode) => void;
  onTogglePreview: () => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  onToggleFocus?: () => void;
}) {
  const focused = activeTabRef(layout);
  // The preview pane is not a document: with it focused, the modes are greyed.
  const tab = focused && !isPreviewTab(focused) ? focused : undefined;
  const mode = (tab ? tabMode(tab) : "edit") as DocumentModeName;
  const modes = (tab ? modesFor(tab.kind) : []) as readonly DocumentModeName[];
  const pane = layout.focusedPaneId;
  return (
    <div className="workspace-toolbar" role="toolbar" aria-label="Document">
      <DocumentModeSwitch
        modes={modes}
        mode={mode}
        onMode={(next) => tab && onSetMode(tab, next)}
        split={{ on: previewOpen(layout), onToggle: onTogglePreview }}
      />
      {renderTools ? <span className="pane-tools">{renderTools(tab, mode === "edit" && !!tab)}</span> : null}
      <span className="workspace-toolbar-end">
        <IconButton size="sm" label="Split right" onClick={() => onSplit(pane, "row")}>
          <SplitGlyph direction="row" />
        </IconButton>
        <IconButton size="sm" label="Split down" onClick={() => onSplit(pane, "column")}>
          <SplitGlyph direction="column" />
        </IconButton>
        {onToggleFocus ? (
          <IconButton size="sm" label="Focus" tip={`Focus: only the document (${shortcutLabel("⌘⇧F")})`} onClick={onToggleFocus}>
            <FocusGlyph on={false} />
          </IconButton>
        ) : null}
      </span>
    </div>
  );
}
