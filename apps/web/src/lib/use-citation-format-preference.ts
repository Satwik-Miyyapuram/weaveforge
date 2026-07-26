"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import {
  citationFormatStorageKey,
  parseEditorCitationFormat,
  type EditorCitationFormat,
} from "./citation-format-preference";

/**
 * Per-project cite-format memory (Phase C2). Reads the stored choice for the
 * active project on mount and persists on change. SSR-safe: first render uses
 * the wikilink default until the effect applies the stored value.
 */
export function useCitationFormatPreference(): [
  EditorCitationFormat,
  (value: EditorCitationFormat) => void,
] {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [format, setFormat] = useState<EditorCitationFormat>("wikilink");

  useEffect(() => {
    const id = getContainer().projects.context.projectId ?? null;
    setProjectId(id);
    try {
      setFormat(parseEditorCitationFormat(localStorage.getItem(citationFormatStorageKey(id))));
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

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
