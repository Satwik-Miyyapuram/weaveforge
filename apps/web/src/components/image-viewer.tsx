"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const STEP = 1.25;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Full-screen viewer: wheel/pinch zoom at the cursor, drag to pan, arrows to step. */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: { src: string; label: string }[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(FIT);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const image = images[index];
  const many = images.length > 1;

  useEffect(() => setView(FIT), [index]);

  // Zoom keeping the point under (cx, cy) fixed; coordinates relative to stage centre.
  const zoomAt = useCallback((factor: number, cx = 0, cy = 0) => {
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const step = useCallback(
    (d: number) => onIndex((index + d + images.length) % images.length),
    [index, images.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) step(1);
      else if (e.key === "ArrowLeft" && many) step(-1);
      else if (e.key === "+" || e.key === "=") zoomAt(STEP);
      else if (e.key === "-") zoomAt(1 / STEP);
      else if (e.key === "0") setView(FIT);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, step, zoomAt, many]);

  // Non-passive so the page does not scroll or browser-zoom under the viewer.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { dist: spread() || 1, scale: view.scale };
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const scale = clamp(pinch.current.scale * (spread() / pinch.current.dist));
      setView((v) => ({ ...v, scale }));
      return;
    }
    setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (view.scale !== 1) return setView(FIT);
    const r = e.currentTarget.getBoundingClientRect();
    zoomAt(2.5, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  }

  if (!image) return null;
  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={image.label}>
      <div className="image-viewer-bar">
        <span className="image-viewer-title">
          {image.label}
          {many && <span className="image-viewer-count"> {index + 1} / {images.length}</span>}
        </span>
        <span className="image-viewer-zoom">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(1 / STEP)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => zoomAt(STEP)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setView(FIT)}>Fit</button>
        <a href={image.src} download target="_blank" rel="noreferrer">Open</a>
        <button type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div
        ref={stageRef}
        className="image-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.src}
          alt={image.label}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      {many && (
        <>
          <button type="button" className="image-viewer-nav prev" onClick={() => step(-1)} aria-label="Previous image">‹</button>
          <button type="button" className="image-viewer-nav next" onClick={() => step(1)} aria-label="Next image">›</button>
        </>
      )}
    </div>,
    document.body,
  );
}
