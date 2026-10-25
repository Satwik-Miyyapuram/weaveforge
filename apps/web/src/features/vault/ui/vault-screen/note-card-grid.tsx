"use client";

import type { VaultPage, VaultPageSummary } from "@weaveforge/core";
import { CardColumns } from "@/components/card-columns";
import { NoteCard } from "./note-card";

type Note = VaultPageSummary | VaultPage;

/** Long sections render offscreen cards lazily. */
const DEFER_AFTER = 20;

/**
 * The notes list: the owner's pinned notes, then the rest, then notes shared
 * with the viewer. Each section shows only when it has notes; the "All notes"
 * label shows only under a "Pinned" section.
 */
export function NoteCardGrid({
  mine,
  unpinned,
  shared,
  isPinned,
  sharedOwnerName,
  onOpen,
  onChanged,
}: {
  mine: readonly Note[];
  unpinned: readonly Note[];
  shared: readonly Note[];
  isPinned: (id: string) => boolean;
  sharedOwnerName: (id: string) => string | undefined;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const own = (p: Note) => <NoteCard page={p} onOpen={() => onOpen(p.id)} onChanged={onChanged} />;
  return (
    <>
      {mine.length > 0 && (
        <>
          <h4 className="settings-group vault-pinned-label">Pinned</h4>
          <CardColumns items={mine} getKey={(p) => p.id} renderItem={own} />
          {unpinned.length > 0 && <h4 className="settings-group vault-pinned-label">All notes</h4>}
        </>
      )}
      {unpinned.length > 0 && (
        <CardColumns
          items={unpinned}
          getKey={(p) => p.id}
          deferOffscreen={unpinned.length > DEFER_AFTER}
          renderItem={own}
        />
      )}
      {shared.length > 0 && (
        <>
          <h4 className="settings-group vault-pinned-label">Shared with you</h4>
          <CardColumns
            items={shared}
            getKey={(p) => p.id}
            deferOffscreen={shared.length > DEFER_AFTER}
            renderItem={(p) => (
              <NoteCard
                page={p}
                readOnly
                isPinned={isPinned(p.id)}
                sharedByName={sharedOwnerName(p.id)}
                onOpen={() => onOpen(p.id)}
                onChanged={onChanged}
              />
            )}
          />
        </>
      )}
    </>
  );
}
