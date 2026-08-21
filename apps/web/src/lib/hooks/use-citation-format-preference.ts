"use client";

import { useCallback, useEffect, useState } from "react";
import { useProject } from "@/features/projects";
import {
  citationFormatStorageKey,
  parseEditorCitationFormat,
  type EditorCitationFormat,
} from "@/lib/citation-format-preference";

/**
 * Per-project cite-format memory (Phase C2). Follows the active project from
 * {@link useProject} so switching projects loads/saves the correct key.
 * SSR-safe: first render uses the wikilink default until storage is read.
 */
export function useCitationFormatPreference(): [
  EditorCitationFormat,
  (value: EditorCitationFormat) => void,
] {
  const { current } = useProject();
  const projectId = current?.id ?? null;
  const [format, setFormat] = useState<EditorCitationFormat>("wikilink");

  useEffect(() => {
    try {
      setFormat(parseEditorCitationFormat(localStorage.getItem(citationFormatStorageKey(projectId))));
    } catch {
      setFormat("wikilink");
    }
  }, [projectId]);

  const update = useCallback(
    (value: EditorCitationFormat) => {
      setFormat(value);
      try {
        localStorage.setItem(citationFormatStorageKey(projectId), value);
      } catch {
        /* ignore */
      }
    },
    [projectId],
  );

  return [format, update];
}
