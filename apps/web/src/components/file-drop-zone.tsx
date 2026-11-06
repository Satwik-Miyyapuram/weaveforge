"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drop files anywhere on a screen to hand them to `onFiles`. Nothing shows
 * until a file is dragged over the window, so the screen keeps its space.
 */
export function FileDropZone({ label, onFiles }: { label: string; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child crossed; count them.
  const depth = useRef(0);
  const dropped = useRef(onFiles);
  dropped.current = onFiles;

  useEffect(() => {
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overHandler = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current = 0;
      setOver(false);
      // An editor under the pointer already took it (an image into a note).
      if (e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) dropped.current(files);
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragleave", leave);
    document.addEventListener("dragover", overHandler);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("dragover", overHandler);
      document.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {over && (
        <div className="file-drop-overlay" aria-hidden>
          <p className="file-drop-label">{label}</p>
        </div>
      )}
    </>
  );
}
