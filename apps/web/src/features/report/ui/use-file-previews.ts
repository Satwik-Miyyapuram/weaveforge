"use client";

import { useEffect, useState } from "react";
import { fetchLiveFile, type LiveDocEntry } from "@/features/overleaf/infrastructure/workshop-live-client";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import { previewableFiles, previewResolver } from "../lib/graphics-file";
import type { PreviewByPath } from "../vendor/overleaf/extensions/file-preview";

/** Downloads at a time, so a project with many figures does not flood the shell. */
const PARALLEL = 4;

const NONE: PreviewByPath = () => null;

/**
 * Fetches a project's images and PDFs once, as object URLs, and returns
 * Overleaf's `previewByPath` for them. It resolves nothing until every file is
 * in, then changes once; the URLs are freed when the project changes or closes.
 */
export function useFilePreviews(
  client: WorkshopClientDeps,
  sessionId: string,
  projectId: string,
  files: readonly LiveDocEntry[] | undefined,
): PreviewByPath {
  const [resolve, setResolve] = useState<PreviewByPath>(() => NONE);

  useEffect(() => {
    setResolve(() => NONE);
    if (!files) return;
    let stopped = false;
    const urls = new Map<string, string>();
    const queue = previewableFiles(files);
    const worker = async () => {
      for (let file = queue.shift(); file && !stopped; file = queue.shift()) {
        const blob = await fetchLiveFile(client, sessionId, projectId, file.id);
        if (!blob || stopped) continue;
        // The shell sends octet-stream; <img> needs the SVG type to draw one.
        const typed = file.path.toLowerCase().endsWith(".svg") ? new Blob([blob], { type: "image/svg+xml" }) : blob;
        urls.set(file.id, URL.createObjectURL(typed));
      }
    };
    void Promise.all(Array.from({ length: PARALLEL }, worker)).then(() => {
      if (!stopped && urls.size > 0) setResolve(() => previewResolver(files, urls));
    });
    return () => {
      stopped = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [client, sessionId, projectId, files]);

  return resolve;
}
