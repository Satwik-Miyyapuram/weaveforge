"use client";

import { useEffect, useRef, useState } from "react";
import { showToast } from "@/lib/toast";
import { formatError } from "@/lib/format-error";
import type { PdfDropOutcome } from "../application/paper-from-pdf";
import { addPdfFiles } from "./pdf-drop";

/**
 * Drop PDFs anywhere on Papers to add them (design D-21). Nothing shows until
 * a file is dragged over the window, so the screen keeps its space.
 */
export function PdfDropZone({ onDropped }: { onDropped: (outcomes: PdfDropOutcome[]) => void }) {
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child crossed; count them.
  const depth = useRef(0);
  const dropped = useRef(onDropped);
  dropped.current = onDropped;

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
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      showToast(files.length === 1 ? "Adding paper…" : `Adding ${files.length} files…`);
      addPdfFiles(files).then((out) => dropped.current(out), (err) => showToast(formatError(err)));
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
        <div className="pdf-drop-overlay" aria-hidden>
          <p className="pdf-drop-label">Drop PDFs to add them as papers</p>
        </div>
      )}
    </>
  );
}
