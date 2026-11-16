"use client";

import { useMemo } from "react";
import { linkGroupOf } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import type { Document } from "../application/parts";

/** The wikilink targets and `#tag` completions of the documents the workspace loaded. */
export function useLinkTargets(documents: readonly Document[] | null) {
  // Where Read mode's wikilinks can go. The same three lists `/notes` hands
  // `VaultMarkdown`, built from the documents this screen already loaded. Which
  // kind resolves against which list is `kind.ts`'s `linkGroup`, so a kind that
  // cannot be linked to is left out rather than filtered by name here.
  const links = useMemo(() => {
    const rows = documents ?? [];
    const inGroup = (group: "notes" | "papers" | "sections") =>
      rows
        .filter((doc) => linkGroupOf(doc.kind) === group)
        .map((doc) => ({ id: doc.id, title: doc.title }));
    return {
      notes: inGroup("notes"),
      papers: inGroup("papers"),
      sections: inGroup("sections"),
    };
  }, [documents]);

  // Every `#tag` the project uses, for completion: the ones written inline in
  // any document plus the ones a paper carries as a field. Sorted so the list
  // is stable between keystrokes.
  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const doc of documents ?? []) {
      for (const tag of readyCore().extractHashtags(doc.body)) all.add(tag);
      for (const tag of doc.tags ?? []) all.add(tag);
    }
    return [...all].sort();
  }, [documents]);

  return { links, tags };
}
