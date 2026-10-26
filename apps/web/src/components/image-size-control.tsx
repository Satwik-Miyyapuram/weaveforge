"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  parseImagePlacement,
  setImagePlacement,
} from "@/lib/markdown-image-width";
import type { MdAlign, MdCrop } from "@/lib/markdown-figure-alt";
import { Button } from "@/components/button";
import { SegmentedControl } from "./segmented-control";

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
  // Whether the slider moved since the control opened. Until it does, the
  // percent is only the rendered width, not a width to store.
  const [widthMoved, setWidthMoved] = useState(false);
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
      setWidthMoved(false);
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
    setWidthMoved(true);
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
    const { crop, align, width } = resolveCommit(next, {
      percent,
      widthMoved,
      cropEdges,
      storedCrop: target.placement.crop,
      storedAlign: target.placement.align,
    });
    const rewritten = setImagePlacement(body, target.alt, target.ordinal, { crop, align, width });
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
            <SegmentedControl
              label="Image side"
              className="image-size-sides"
              value={target.placement.align ?? null}
              onChange={(side) => commit({ align: side })}
              options={(["left", "center", "right"] as const).map((side) => ({ value: side, label: SIDE_LABELS[side] }))}
            />
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
                        commit({});
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="image-size-actions">
            <Button
              size="sm"
              onClick={() => commit({ width: null, crop: null, align: null })}
            >
              Reset
            </Button>
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
 * Four crop insets out of the four fields; `null` for no crop (every field
 * empty or zero) and `undefined` when a field does not parse or is out of
 * range. An empty field is a zero, so a crop off one edge is one number.
 */
export function cropParts(edges: string[]): MdCrop | null | undefined {
  const parts = edges.map((edge) => (edge.trim() === "" ? 0 : Math.round(Number(edge))));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n >= 100)) return undefined;
  if (parts.every((n) => n === 0)) return null;
  return parts as MdCrop;
}

/**
 * The placement a commit writes. `width` is `undefined` (keep the stored one)
 * unless the slider moved or the caller named one: the slider starts at the
 * rendered width, which is not a width the source asked for. An invalid crop
 * field keeps the stored crop instead of reading as "no crop".
 */
export function resolveCommit(
  next: { width?: number | null; crop?: MdCrop | null; align?: MdAlign | null },
  state: {
    percent: number;
    widthMoved: boolean;
    cropEdges: string[];
    storedCrop: MdCrop | undefined;
    storedAlign: MdAlign | undefined;
  },
): { crop: MdCrop | null; align: MdAlign | null; width: string | null | undefined } {
  const chosen = next.width !== undefined ? next.width : state.widthMoved ? state.percent : undefined;
  const width = chosen === undefined ? undefined : chosen === null || chosen >= 100 ? null : `${chosen}%`;
  const typed = cropParts(state.cropEdges);
  const crop = next.crop !== undefined ? next.crop : typed === undefined ? state.storedCrop ?? null : typed;
  const align = next.align !== undefined ? next.align : state.storedAlign ?? null;
  return { crop, align, width };
}
