"use client";

/**
 * The ink keyboard, per §6.5: tools, undo, recognise, print and export, the
 * selection — and the wheel that zooms.
 *
 * A bare `p` is still the pen — only the shifted form prints. The listener is
 * on the window rather than on the canvas, because a keypress arrives wherever
 * focus sits inside the pane, and a canvas is not a focusable thing.
 */

import { useEffect } from "react";
import type { InkColour } from "@weaveforge/core";

import type { InkWorkerMessage } from "../application/capture-protocol";
import type { InkBarTool } from "./ink-bar";

/** What the shortcuts need from the host. */
export interface InkShortcutsDeps {
  /** Tell the worker something (undo, clear the selection). */
  send: (message: InkWorkerMessage) => void;
  /** The late, coalesced save. */
  scheduleSave: () => void;
  /** Choose the tool. */
  setTool: (tool: InkBarTool | "shape") => void;
  /** Choose a colour, the way the bar's swatch does. */
  onColourChange: (colour: InkColour) => void;
  /** How many strokes the lasso holds. */
  selectionCount: number;
  /** Clear the selection's state, after the worker was told. */
  clearSelection: () => void;
  /** Delete the lassoed strokes. */
  onDeleteSelection: () => void;
  /** Recognise this page. */
  recognise: () => void;
  /** Print the page. */
  onPrint: () => void;
  /** Export the page as a PNG. */
  onExportPng: () => void;
  /** Export the page as an SVG. */
  onExportSvg: () => void;
  /** The scroller the wheel zooms inside. */
  scrollRef: { current: HTMLDivElement | null };
  /** Zoom by a factor, clamped. */
  setZoom: (next: (value: number) => number) => void;
}

export function useInkShortcuts(deps: InkShortcutsDeps) {
  const {
    send,
    scheduleSave,
    setTool,
    onColourChange,
    selectionCount,
    clearSelection,
    onDeleteSelection,
    recognise,
    onPrint,
    onExportPng,
    onExportSvg,
    scrollRef,
    setZoom,
  } = deps;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          send({ type: event.shiftKey ? "redo" : "undo" });
          scheduleSave();
        } else if (event.shiftKey && key === "r") {
          event.preventDefault();
          recognise();
        } else if (event.shiftKey && key === "p") {
          event.preventDefault();
          onPrint();
        } else if (event.shiftKey && key === "e") {
          event.preventDefault();
          onExportPng();
        } else if (event.shiftKey && key === "g") {
          event.preventDefault();
          onExportSvg();
        }
        return;
      }
      switch (event.key.toLowerCase()) {
        case "p":
          setTool("pen");
          break;
        case "h":
          setTool("highlighter");
          break;
        case "e":
          setTool("eraser");
          break;
        case "l":
          setTool("lasso");
          break;
        case "s":
          setTool("shape");
          break;
        case "delete":
        case "backspace":
          if (selectionCount > 0) {
            event.preventDefault();
            onDeleteSelection();
          }
          break;
        case "escape":
          if (selectionCount > 0) {
            send({ type: "select-clear" });
            clearSelection();
          }
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const palette: InkColour[] = [
            "text",
            "accent",
            "warn",
            "good",
            "info",
            "danger",
          ];
          const chosen = palette[Number(event.key) - 1];
          if (chosen) onColourChange(chosen);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    send,
    scheduleSave,
    setTool,
    onColourChange,
    selectionCount,
    clearSelection,
    onDeleteSelection,
    recognise,
    onPrint,
    onExportPng,
    onExportSvg,
  ]);

  /** Zoom without plumbing a gesture: ⌘/Ctrl and the wheel, or the buttons. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value: number) =>
        Math.min(4, Math.max(0.5, value * (event.deltaY < 0 ? 1.1 : 0.9))),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // The scroller is what it zooms inside; it is measured once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
