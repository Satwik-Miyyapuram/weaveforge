"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { setImageWidth } from "@/lib/markdown-image-width";

/**
 * Resizing a picture from the read view.
 *
 * A click on a rendered image opens a small control under it: a slider for
 * the width as a share of the column, and a reset. The slider previews on the
 * image itself as it moves and writes `![alt|NN%](…)` into the source when it
 * is let go — the same suffix the renderer reads, so the picture stays that
 * size in every view and in any other tool that reads the note.
 *
 * Which reference to rewrite is found by alt text and position, because by the
 * time a picture is on screen its target is a blob URL that says nothing about
 * the markdown behind it (`markdown-image-width.ts`).
 */

interface Target {
  img: HTMLImageElement;
  alt: string;
  ordinal: number;
  /** The width the slider started at, so Escape can put it back. */
  initial: number;
}

/** A percentage from an image's current rendered width against its column. */
function currentPercent(img: HTMLImageElement): number {
  const column = img.parentElement?.clientWidth ?? 0;
  if (!column) return 100;
  return Math.max(10, Math.min(100, Math.round((img.getBoundingClientRect().width / column) * 100)));
}

export function ImageSizeControl({
  body,
  onSave,
  children,
}: {
  body: string;
  /** Writes the rewritten source. Absent on a document that cannot be edited. */
  onSave?: (body: string) => Promise<void>;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [percent, setPercent] = useState(100);
  const hostRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restore: boolean) => {
    setTarget((current) => {
      if (current && restore) current.img.style.width = current.initial < 100 ? `${current.initial}%` : "";
      return null;
    });
  }, []);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSave) return;
      const el = event.target as HTMLElement;
      if (!(el instanceof HTMLImageElement) || !el.classList.contains("md-image")) {
        // A click anywhere else in the document dismisses the control.
        if (!(el.closest(".image-size") instanceof HTMLElement)) close(false);
        return;
      }
      const alt = el.dataset.mdAlt ?? el.alt;
      const siblings = Array.from(
        hostRef.current?.querySelectorAll<HTMLImageElement>("img.md-image") ?? [],
      ).filter((img) => (img.dataset.mdAlt ?? img.alt) === alt);
      const ordinal = siblings.indexOf(el);
      const initial = currentPercent(el);
      setTarget({ img: el, alt, ordinal, initial });
      setPercent(initial);
    },
    [close, onSave],
  );

  // Escape puts the picture back; a body change from elsewhere drops a stale
  // control rather than rewriting a reference that may have moved.
  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, target]);

  useEffect(() => {
    setTarget(null);
  }, [body]);

  const preview = (next: number) => {
    setPercent(next);
    if (target) target.img.style.width = `${next}%`;
  };

  const commit = (next: number | null) => {
    if (!target || !onSave) return;
    const width = next === null || next >= 100 ? null : `${next}%`;
    const rewritten = setImageWidth(body, target.alt, target.ordinal, width);
    if (rewritten !== body) void onSave(rewritten);
    if (next === null) target.img.style.width = "";
    setTarget(null);
  };

  // Anchored under the picture, inside the scrolling document so it moves with it.
  const anchor = target
    ? {
        top: target.img.offsetTop + target.img.offsetHeight + 6,
        left: target.img.offsetLeft,
      }
    : undefined;

  return (
    <div ref={hostRef} className="image-size-host" onClick={onClick}>
      {children}
      {target && anchor ? (
        <div className="image-size" role="group" aria-label="Image size" style={anchor}>
          <label className="image-size-label">
            Width
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={percent}
              aria-label="Image width, percent of column"
              onChange={(event) => preview(Number(event.target.value))}
              onPointerUp={() => commit(percent)}
              onKeyUp={(event) => {
                if (event.key === "Enter") commit(percent);
              }}
            />
            <span className="image-size-value">{percent}%</span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => commit(null)}>
            Reset
          </button>
        </div>
      ) : null}
    </div>
  );
}
