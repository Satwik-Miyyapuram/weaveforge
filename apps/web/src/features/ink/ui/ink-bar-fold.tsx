"use client";

/**
 * The one toolbar's fold (priority+): it never wraps. As it narrows, stages go
 * on one at a time — the pills shrink, then page, zoom, Recognise, Insert,
 * Find and Undo move into More, Preview and Split into Layout ▾, the quick
 * colours into the pen's swatch, and last Focus into Layout ▾ too.
 *
 * The toolbar measures and writes the stages to its `data-fold`; CSS hides
 * what each stage folds (editor-workspace.css), and More reads the attribute
 * back to list what moved. An attribute, not React state, because the live
 * bar is portalled into the toolbar from another tree.
 */

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { MenuItemButton } from "@/components/controls";
import { shortcutLabel } from "@/lib/shortcut-label";

export const FOLD_STAGES = [
  "zoom",
  "pages",
  "zoom-out",
  "pages-out",
  "recognise",
  "insert",
  "find",
  "layout",
  "history",
  "colours",
  "focus",
] as const;
export type FoldStage = (typeof FOLD_STAGES)[number];

/** The stages that move a control into More, so More shows a dot. */
const MOVES: ReadonlySet<FoldStage> = new Set(["zoom-out", "pages-out", "recognise", "insert", "find", "history"]);

export function foldMoves(on: readonly FoldStage[]): boolean {
  return on.some((stage) => MOVES.has(stage));
}

export function parseFold(value: string | null | undefined): FoldStage[] {
  return (value ?? "").split(/\s+/).filter((stage): stage is FoldStage => (FOLD_STAGES as readonly string[]).includes(stage));
}

/**
 * Reset, then put stages on in order while the bar still overflows. `apply`
 * writes a stage list to the bar; `overflows` measures it as it now stands.
 */
export function fitFold(apply: (on: readonly FoldStage[]) => void, overflows: () => boolean): FoldStage[] {
  const on: FoldStage[] = [];
  apply(on);
  for (const stage of FOLD_STAGES) {
    if (!overflows()) break;
    on.push(stage);
    apply(on);
  }
  return on;
}

/** Fit the toolbar's fold to its width, and again whenever it or its contents change. */
export function useToolbarFold(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const overflows = () => {
      if (bar.scrollWidth > bar.clientWidth + 0.5) return true;
      const ink = bar.querySelector(".ink-bar");
      return Boolean(ink && ink.scrollWidth > ink.clientWidth + 0.5);
    };
    const fit = () => {
      const on = fitFold((stages) => {
        bar.dataset.fold = stages.join(" ");
      }, overflows);
      if (foldMoves(on)) bar.dataset.moved = "";
      else delete bar.dataset.moved;
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(bar);
    // A live bar portalled in, a mode switch, the search opening: new contents.
    // Text too: the page number or the zoom growing a digit widens the bar.
    const mutate = new MutationObserver(schedule);
    mutate.observe(bar, { childList: true, characterData: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [ref]);
}

/** The fold of the toolbar `element` sits in, kept current; [] outside one. */
export function useFoldOf(ref: RefObject<HTMLElement | null>): FoldStage[] {
  const [fold, setFold] = useState("");
  useEffect(() => {
    const bar = ref.current?.closest<HTMLElement>(".workspace-toolbar");
    if (!bar) return;
    const read = () => setFold(bar.dataset.fold ?? "");
    read();
    const watch = new MutationObserver(read);
    watch.observe(bar, { attributes: true, attributeFilter: ["data-fold"] });
    return () => watch.disconnect();
  }, [ref]);
  return parseFold(fold);
}

/** The click on the toolbar's own (hidden) Find, so the reader's search opens in place. */
export function foldedFind(from: Element | null): (() => void) | undefined {
  const find = from?.closest(".workspace-toolbar")?.querySelector<HTMLButtonElement>('button[aria-label="Find in document"]');
  return find && !find.disabled ? () => find.click() : undefined;
}

/**
 * What the fold moved into More, at the top of it: a row each for the
 * controls (undo and redo, the page, the zoom), an item each for the rest.
 */
export function FoldedItems({
  on,
  history,
  page,
  zoom,
  onFind,
  onInsert,
  onRecognise,
  choose,
}: {
  on: readonly FoldStage[];
  history: ReactNode;
  page: ReactNode;
  zoom: ReactNode;
  onFind?: () => void;
  /** Opens Insert's entries in place of More's. */
  onInsert?: () => void;
  onRecognise?: () => void;
  choose: (run: () => void) => () => void;
}) {
  if (!foldMoves(on)) return null;
  const has = (stage: FoldStage) => on.includes(stage);
  return (
    <>
      <div className="ink-menu-section ink-menu-folded" role="group" aria-label="Moved from the bar">
        {has("history") ? <FoldRow label="Undo · Redo">{history}</FoldRow> : null}
        {has("pages-out") ? <FoldRow label="Page">{page}</FoldRow> : null}
        {has("zoom-out") ? <FoldRow label="Zoom">{zoom}</FoldRow> : null}
        {has("find") ? (
          <MenuItemButton disabled={!onFind} onClick={onFind ? choose(onFind) : undefined}>
            <span>Find</span>
            <kbd>{shortcutLabel("⌘F")}</kbd>
          </MenuItemButton>
        ) : null}
        {has("insert") ? (
          <MenuItemButton disabled={!onInsert} onClick={onInsert} aria-haspopup="menu">
            <span>Insert</span>
            <span className="card-menu-more menu-more" aria-hidden="true">›</span>
          </MenuItemButton>
        ) : null}
        {has("recognise") ? (
          <MenuItemButton disabled={!onRecognise} onClick={onRecognise ? choose(onRecognise) : undefined}>
            <span>Recognise handwriting</span>
          </MenuItemButton>
        ) : null}
      </div>
      <hr className="ink-menu-rule" />
    </>
  );
}

function FoldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ink-menu-fold-row" role="group" aria-label={label}>
      <span className="ink-menu-heading">{label}</span>
      {children}
    </div>
  );
}
