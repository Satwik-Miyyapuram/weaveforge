"use client";

import type { ReactNode } from "react";

import { IconButton } from "@/components/button";
import { DocumentModeSwitch, canSplit, type DocumentModeName } from "@/components/document-mode-switch";
import { FocusGlyph } from "@/components/focus-glyph";
import { PreviewIcon } from "@/components/view-icons";
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
 * The Editor's one toolbar, over every pane: the focused document's tools, then
 * the layout (preview, split, focus). It acts on the focused pane, so a split
 * screen has one set of controls rather than one per pane, and a control the
 * document cannot use is greyed rather than gone. The mode (Text · Ink) is not
 * here: it sits in each note's path row (`PaneModeSwitch`), the same place in
 * every mode, so switching never moves it.
 */
export function WorkspaceToolbar({
  slotRef,
  layout,
  renderTools,
  onTogglePreview,
  onSplit,
  onToggleFocus,
}: {
  /** Receives the element the focused document's own tools (the ink bar) render into. */
  slotRef?: (element: HTMLElement | null) => void;
  layout: PaneLayout;
  /** The document's tools (the image button); `enabled` is false outside Text. */
  renderTools?: (tab: TabRef | undefined, enabled: boolean) => ReactNode;
  onTogglePreview: () => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  onToggleFocus?: () => void;
}) {
  const focused = activeTabRef(layout);
  // The preview pane is not a document; with it focused, Preview still closes it.
  const tab = focused && !isPreviewTab(focused) ? focused : undefined;
  const mode = (tab ? tabMode(tab) : "edit") as DocumentModeName;
  const pane = layout.focusedPaneId;
  const preview = previewOpen(layout);
  return (
    <div className="workspace-toolbar" role="toolbar" aria-label="Document">
      {/* The text tools; a sheet brings its own bar into the slot instead. */}
      {renderTools && mode !== "ink" ? (
        <span className="pane-tools">{renderTools(tab, mode === "edit" && !!tab)}</span>
      ) : null}
      <span className="workspace-toolbar-doc" ref={slotRef} />
      <span className="workspace-toolbar-end">
        <IconButton
          size="sm"
          label="Preview"
          tip={`Preview beside the text (${shortcutLabel("⌘E")})`}
          aria-pressed={preview && canSplit(mode)}
          disabled={!focused || !canSplit(mode)}
          onClick={onTogglePreview}
        >
          <PreviewIcon />
        </IconButton>
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

/** Text · Ink for a document, at the end of its path row; its Preview is the toolbar's. */
export function PaneModeSwitch({ tab, onSetMode }: { tab: TabRef; onSetMode: (tab: TabRef, mode: DocumentMode) => void }) {
  return (
    <DocumentModeSwitch
      modes={modesFor(tab.kind) as readonly DocumentModeName[]}
      mode={tabMode(tab) as DocumentModeName}
      onMode={(next) => onSetMode(tab, next)}
      split={false}
    />
  );
}
