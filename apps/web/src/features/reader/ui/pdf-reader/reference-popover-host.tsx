"use client";

import { useEffect, useState } from "react";
import { PopoverLayer } from "../reference-popover-layer";
import { ReferencePopover } from "../reference-popover";
import { Select } from "@/components/select";
import type { useReaderReferences } from "./use-reader-references";

interface ReferencePopoverHostProps {
  refs: ReturnType<typeof useReaderReferences>;
  onOpenInReader: (paperId: string) => void;
}

/**
 * The one popover the reader shows: the mention that was clicked, its
 * resolution, and the actions. The list picker lives here rather than in the
 * presentational popover so that component stays free of container access.
 */
export function ReferencePopoverHost({ refs, onOpenInReader }: ReferencePopoverHostProps) {
  const { open, close, resolutions, actions, lists, linked, notice } = refs;
  const [picking, setPicking] = useState(false);
  const [listId, setListId] = useState("");
  useEffect(() => { setPicking(false); }, [open?.hit.key]);
  useEffect(() => {
    if (picking && lists === null) void actions.loadLists();
    if (picking && lists?.length && !listId) setListId(lists[0]!.id);
  }, [picking, lists, listId, actions]);
  if (!open) return null;
  const { entry, hit, anchor } = open;
  const resolution = resolutions.get(entry.index) ?? { status: "pending" as const };
  const paper = resolution.status === "resolved" ? resolution.inLibrary : undefined;
  return (
    <PopoverLayer anchorKey={hit.key} anchor={anchor} onRequestClose={close}>
      <ReferencePopover
        entry={entry}
        resolution={resolution}
        onClose={close}
        onReadLater={() => void actions.readLater(entry)}
        onAddToList={() => setPicking(true)}
        onOpenInReader={paper ? () => onOpenInReader(paper.id) : undefined}
        onLinkPapers={paper ? () => void actions.linkPapers(paper.id) : undefined}
        onCite={() => void actions.cite(resolution, entry)}
        onAddManually={() => void actions.addManually(entry)}
        onJumpToEntry={() => actions.jumpToEntry(entry)}
        alreadyLinked={paper ? linked.has(paper.id) : false}
        confidence={open.confidence}
      />
      {picking && (
        <div className="pdf-reader-ref-actions pdf-reader-ref-picker">
          {lists === null ? (
            <span role="status">Loading lists…</span>
          ) : lists.length === 0 ? (
            <span role="status">No reading lists yet</span>
          ) : (
            <>
              <Select
                aria-label="Reading list"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              >
                {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
              </Select>
              <button
                type="button"
                className="pdf-reader-ref-action"
                disabled={!listId}
                onClick={() => { void actions.addToList(entry, listId); setPicking(false); }}
              >
                Add
              </button>
            </>
          )}
        </div>
      )}
      {notice && <p role="status" className="pdf-reader-ref-skeleton">{notice}</p>}
    </PopoverLayer>
  );
}
