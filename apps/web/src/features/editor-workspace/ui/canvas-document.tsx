"use client";

import { useCallback, useMemo } from "react";
import { LazyCanvasEditor as CanvasEditor } from "@/features/canvas";
import { resolveCanvasFile } from "@/features/canvas/application/canvas-files";
import { canvasImages } from "@/features/canvas/application/canvas-images";
import type { Document } from "../application/parts";

/** A canvas note in a pane: the canvas editor, its file nodes resolved against the workspace. */
export function CanvasDocument({
  doc,
  documents,
  onSave,
  onOpen,
}: {
  doc: Document;
  documents: readonly Document[];
  onSave: (body: string, base: string | undefined) => unknown;
  onOpen: (doc: Document) => void;
}) {
  const filePaths = useMemo(() => documents.filter((d) => d !== doc).map((d) => d.path), [documents, doc]);
  const images = useMemo(() => canvasImages(doc.id), [doc.id]);
  const onOpenFile = useCallback(
    (path: string) => {
      const target = resolveCanvasFile(documents, path);
      if (target) onOpen(target);
      return target !== undefined;
    },
    [documents, onOpen],
  );
  return <CanvasEditor body={doc.body} onSave={onSave} filePaths={filePaths} onOpenFile={onOpenFile} images={images} />;
}
