"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  parseImagePlacement,
  setImagePlacement,
} from "@/lib/markdown-image-width";
import type { MdAlign, MdCrop } from "@/lib/markdown-figure-alt";

/**
 * Placing a picture from the read view.
 *
 * A click on a rendered image opens a small control under it: a slider for
 * the width as a share of the column, buttons for its side, and a crop as
 * four typed insets, one field per edge. The slider previews on the image itself as it moves; a
 * side moves it at once; a crop previews when its four numbers parse. Every
 * change writes `![alt left c=0,0,10,10|NN%]` into the source in one write —
 * the same tokens the renderer reads, so the picture keeps its placement in
 * every view and in any other tool that reads the note.
 *
 * Which reference to rewrite is found by alt text and position, because by
 * the time a picture is on screen its target is a blob URL that says nothing
 * about the markdown behind it (`markdown-image-width.ts`).
 */

interface Target {
  img: HTMLImageElement;
  alt: string;
  ordinal: number;
  /** The placement the control started at, so Escape can put it back. */
  placement: { crop?: MdCrop; align?: MdAlign; initial: number };
}

const SIDE_LABELS: Record<MdAlign, string> = { left: "Left", center: "Centre", right: "Right" };

/** The crop's four fields, in the order the source writes them. */
const EDGES = [
  { key: "L", label: "Left" },
  { key: "T", label: "Top" },
  { key: "R", label: "Right" },
  { key: "B", label: "Bottom" },
] as const;
const NO_CROP = ["", "", "", ""];

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
  const [cropEdges, setCropEdges] = useState<string[]>(NO_CROP);
  const hostRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restore: boolean) => {
    setTarget((current) => {
      if (current && restore) {
        current.img.style.width =
          current.placement.initial < 100 ? `${current.placement.initial}%` : "";
        current.img.style.clipPath = "";
      }
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
      // The placement the source carries, read back out of the body the way
      // the renderer read it: the alt as the source wrote it.
      const raw = rawAltFor(body, alt, ordinal);
      const parsed = raw ? parseImagePlacement(raw) : { alt };
      setTarget({
        img: el,
        alt,
        ordinal,
        placement: {
          crop: parsed.crop,
          align: parsed.align,
          initial,
        },
      });
      setPercent(initial);
      setCropEdges(parsed.crop ? parsed.crop.map(String) : NO_CROP);
    },
    [body, close, onSave],
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

  /** A crop preview: the clip-path the renderer writes, live on the picture. */
  const previewCrop = (edges: string[]) => {
    setCropEdges(edges);
    if (!target) return;
    const parts = cropParts(edges);
    target.img.style.clipPath = parts
      ? `inset(${parts[1]}% ${parts[2]}% ${parts[3]}% ${parts[0]}%)`
      : "";
  };

  const commit = (next: {
    width?: number | null;
    crop?: MdCrop | null;
    align?: MdAlign | null;
  }) => {
    if (!target || !onSave) return;
    // The slider's value is what the user set, whatever the picture started
    // at; a full-width picture dragged to 40% used to snap back because the
    // starting width decided whether the drag counted.
    const chosen = next.width === undefined ? percent : next.width;
    const width = chosen === null || chosen >= 100 ? null : `${chosen}%`;
    const crop =
      next.crop !== undefined
        ? next.crop
        : (cropParts(cropEdges) as MdCrop | null);
    const rewritten = setImagePlacement(body, target.alt, target.ordinal, {
      crop,
      align: next.align !== undefined ? next.align : target.placement.align ?? null,
      width,
    });
    if (rewritten !== body) void onSave(rewritten);
    if (!crop) target.img.style.clipPath = "";
    if (!width || width === "100%") target.img.style.width = "";
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
          <span className="image-size-heading">This image</span>
          <label className="image-size-row">
            <span className="image-size-key">Width</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={percent}
              aria-label="Image width, percent of column"
              onChange={(event) => preview(Number(event.target.value))}
              onPointerUp={() => commit({})}
              onKeyUp={(event) => {
                if (event.key === "Enter") commit({});
              }}
            />
            <span className="image-size-value">{percent}%</span>
          </label>
          <div className="image-size-row">
            <span className="image-size-key">Side</span>
            <div className="seg image-size-sides" role="group" aria-label="Image side">
              {(["left", "center", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={target.placement.align === side ? "seg-on" : undefined}
                  aria-pressed={target.placement.align === side}
                  onClick={() => commit({ align: side })}
                >
                  {SIDE_LABELS[side]}
                </button>
              ))}
            </div>
          </div>
          <div className="image-size-row">
            <span className="image-size-key">Crop %</span>
            <div className="image-size-crop" role="group" aria-label="Crop, percent off each edge">
              {EDGES.map((edge, index) => (
                <label key={edge.key} className="image-size-edge" title={edge.label}>
                  <span aria-hidden="true">{edge.key}</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    inputMode="numeric"
                    value={cropEdges[index]}
                    placeholder="0"
                    aria-label={`${edge.label}, percent`}
                    onChange={(event) =>
                      previewCrop(cropEdges.map((value, at) => (at === index ? event.target.value : value)))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commit({ crop: cropParts(cropEdges) as MdCrop | null });
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="image-size-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => commit({ width: null, crop: null, align: null })}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The alt text of the `ordinal`-th image whose bare alt is `alt`, as written. */
function rawAltFor(body: string, alt: string, ordinal: number): string | null {
  let seen = 0;
  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^\s)]+)\)/g)) {
    const raw = match[1] ?? "";
    if (parseImagePlacement(raw).alt !== alt) continue;
    if (seen++ === ordinal) return raw;
  }
  return null;
}

/**
 * Four crop insets out of the four fields, or `null` for no crop: every field
 * empty or zero, or one that does not parse. An empty field is a zero, so a
 * crop off one edge is one number, not four.
 */
function cropParts(edges: string[]): [number, number, number, number] | null {
  const parts = edges.map((edge) => (edge.trim() === "" ? 0 : Math.round(Number(edge))));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n >= 100)) return null;
  if (parts.every((n) => n === 0)) return null;
  return parts as [number, number, number, number];
}
