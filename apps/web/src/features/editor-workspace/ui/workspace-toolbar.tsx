"use client";


import { useRef } from "react";

import { IconButton } from "@/components/button";
import { MenuItemButton, ToolButton } from "@/components/controls";
import { DocumentModeSwitch, canSplit, type DocumentModeName } from "@/components/document-mode-switch";
import { FocusGlyph } from "@/components/focus-glyph";
import { PreviewIcon } from "@/components/view-icons";
import { BarMenuList, Caret, InkIdleBar, useBarMenu, useFoldOf, useToolbarFold } from "@/features/ink";
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
 * document cannot use is greyed rather than gone: the text tools in Ink, the
 * ink tools in Text, so the bar keeps one shape in every mode. The mode (Text · Ink) is not
 * here: it sits in each note's path row (`PaneModeSwitch`), the same place in
 * every mode, so switching never moves it.
 */
export function WorkspaceToolbar({
  slotRef,
  layout,
  onInsertImage,
  onTogglePreview,
  onSplit,
  onToggleFocus,
}: {
  /** Receives the element the focused document's own tools (the ink bar) render into. */
  slotRef?: (element: HTMLElement | null) => void;
  layout: PaneLayout;
  /** Insert ▾ → Picture in Text: a picture from disk at the caret of the focused editor. */
  onInsertImage?: (tab: TabRef, file: File) => void;
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
  const bar = useRef<HTMLDivElement>(null);
  // Too narrow for one row: stages fold away rather than the bar wrapping.
  useToolbarFold(bar);
  const previewOff = !focused || !canSplit(mode);
  return (
    <div className="workspace-toolbar" role="toolbar" aria-label="Document" ref={bar}>
      {/* A sheet or a paper brings its live bar into the slot; anywhere else the
          same bar shows greyed (CSS hides this one once the slot is filled). */}
      <span className="workspace-toolbar-doc" ref={slotRef} />
      {mode !== "ink" ? (
        <InkIdleBar onInsertImage={mode === "edit" && tab && onInsertImage ? (file) => onInsertImage(tab, file) : undefined} />
      ) : null}
      <span className="workspace-toolbar-end">
        <LayoutMenu
          previewOff={previewOff}
          onTogglePreview={onTogglePreview}
          onSplit={(direction) => onSplit(pane, direction)}
          onToggleFocus={onToggleFocus}
        />
        <IconButton
          size="sm"
          label="Preview"
          tip={`Preview beside the text (${shortcutLabel("⌘E")})`}
          aria-pressed={preview && canSplit(mode)}
          disabled={previewOff}
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

/**
 * Layout ▾: Preview and the splits once the fold takes them off the bar
 * (CSS shows it from the `layout` stage), and Focus too at the last stage.
 */
function LayoutMenu({
  previewOff,
  onTogglePreview,
  onSplit,
  onToggleFocus,
}: {
  previewOff: boolean;
  onTogglePreview: () => void;
  onSplit: (direction: PaneSplit["direction"]) => void;
  onToggleFocus?: () => void;
}) {
  const { open, setOpen, menuRef, listRef, pos, choose } = useBarMenu();
  const focusIn = useFoldOf(menuRef).includes("focus") && onToggleFocus;
  return (
    <div className="ink-menu workspace-toolbar-layout" ref={menuRef}>
      <ToolButton label="Layout" tip="Layout" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <SplitGlyph direction="row" />
        <Caret open={open} />
      </ToolButton>
      {open ? (
        <BarMenuList label="Layout" listRef={listRef} pos={pos}>
          <MenuItemButton disabled={previewOff} onClick={choose(onTogglePreview)}>
            <span>Preview</span>
            <kbd>{shortcutLabel("⌘E")}</kbd>
          </MenuItemButton>
          <MenuItemButton onClick={choose(() => onSplit("row"))}>Split right</MenuItemButton>
          <MenuItemButton onClick={choose(() => onSplit("column"))}>Split down</MenuItemButton>
          {focusIn ? (
            <MenuItemButton onClick={choose(focusIn)}>
              <span>Focus</span>
              <kbd>{shortcutLabel("⌘⇧F")}</kbd>
            </MenuItemButton>
          ) : null}
        </BarMenuList>
      ) : null}
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
