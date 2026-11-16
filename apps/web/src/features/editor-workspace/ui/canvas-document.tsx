"use client";

import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { resolveCanvasFile } from "@/features/canvas/application/canvas-files";
import type { Document } from "../application/parts";

/** Loaded on first use: React Flow stays out of the bundle until a canvas opens. */
const CanvasEditor = dynamic(() => import("@/features/canvas/ui/canvas-editor"), {
  ssr: false,
  loading: () => <ScreenLoader status="Loading canvas…" showTips={false} compact />,
});

/** Whether a workspace document is a canvas note (its path is `notes/<title>.canvas`). */
export function isCanvasDocument(doc: Pick<Document, "kind" | "path">): boolean {
  return doc.kind === "vault_page" && doc.path.endsWith(".canvas");
}

/** A canvas note in a pane: the canvas editor, its file nodes resolved against the workspace. */
export function CanvasDocument({
  doc,
  documents,
  onSave,
  onOpen,
}: {
  doc: Document;
  documents: readonly Document[];
  onSave: (body: string) => unknown;
  onOpen: (doc: Document) => void;
}) {
  const filePaths = useMemo(() => documents.filter((d) => d !== doc).map((d) => d.path), [documents, doc]);
  const onOpenFile = useCallback(
    (path: string) => {
      const target = resolveCanvasFile(documents, path);
      if (target) onOpen(target);
      return target !== undefined;
    },
    [documents, onOpen],
  );
  return <CanvasEditor body={doc.body} onSave={onSave} filePaths={filePaths} onOpenFile={onOpenFile} />;
}
