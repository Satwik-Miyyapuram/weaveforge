"use client";

import { useCallback, useMemo } from "react";
import { outlineOf, type WorkspaceTreeNode } from "@weaveforge/wasm";

/** The Outline section's rows for `body`, the text of the document on screen. */
export function useOutline(body: string) {
  // The Outline section: the headings of the document on screen, read from the
  // same parse Read mode renders. Collapsed by default, and empty for a
  // document with no headings. Tabs, not a second document: a heading row
  // scrolls the pane rather than opening anything.
  const outline = useMemo(() => {
    return outlineOf(body).map<WorkspaceTreeNode>((heading, index) => ({
      key: `outline:${index}:${heading.slug}`,
      kind: "folder",
      label: heading.text,
      // The slug is the id the Read view writes, so a click finds the heading
      // it names with no second parse and no offset table to keep in step.
      path: heading.slug,
      children: [],
      headingLevel: heading.level,
    }));
  }, [body]);

  /** A heading row scrolls the pane it belongs to; nothing opens. */
  const jumpToHeading = useCallback((node: WorkspaceTreeNode) => {
    if (!node.path) return;
    document.getElementById(node.path)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return { outline, jumpToHeading };
}
