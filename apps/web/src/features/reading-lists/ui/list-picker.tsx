"use client";

import { useEffect, useState } from "react";
import type { ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";

/** The one thing this picker files: a paper, or a note. */
export type PickerTarget = { kind: "paper" | "note"; id: string };

/**
 * The lists, as a column of checkboxes, for filing the item you are looking at.
 *
 * This is what "Add to list" opens — beside the card's menu, not a modal over the
 * screen. Filing is a small, reversible act on one item, and a dialog for it put
 * a full-screen interruption in front of the grid you were scanning.
 *
 * Managing lists — making, naming, nesting, deleting — stays on the Lists screen.
 * This only ever answers "which of my lists is this in".
 */
export function ListPicker({ target }: { target: PickerTarget }) {
  const [lists, setLists] = useState<ReadingList[] | null>(null);
  const [member, setMember] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const container = getContainer();
      const [all, mine] = await Promise.all([
        container.readingLists.allLists(),
        target.kind === "paper"
          ? container.readingLists.listsForPaper(target.id)
          : container.readingLists.listsForNote(target.id),
      ]);
      if (cancelled) return;
      setLists(all);
      setMember(new Set(mine.map((item) => item.listId)));
    })().catch((err) => {
      if (cancelled) return;
      setLists([]);
      setError(formatError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.id]);

  async function toggle(list: ReadingList) {
    const inList = member.has(list.id);
    // Flip first, then write. Filing resolves the list's ancestors and writes a
    // row per list, so awaiting before the checkbox moved left it dead for the
    // whole round trip — which read as the picker being slow rather than the
    // database being a database. Undone below if the write fails.
    setMember((prev) => {
      const next = new Set(prev);
      if (inList) next.delete(list.id);
      else next.add(list.id);
      return next;
    });
    setBusy(list.id);
    setError(null);
    try {
      const manage = getContainer().readingLists.manageReadingList;
      if (target.kind === "paper") {
        if (inList) await manage.removePaperFromList(list.id, target.id);
        else await manage.addPaperToList(list.id, target.id);
      } else if (inList) await manage.removeNoteFromList(list.id, target.id);
      else await manage.addNoteToList(list.id, target.id);
    } catch (err) {
      setMember((prev) => {
        const next = new Set(prev);
        if (inList) next.add(list.id);
        else next.delete(list.id);
        return next;
      });
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  if (lists === null) return <p className="card-menu-note">Loading…</p>;
  if (lists.length === 0) {
    return <p className="card-menu-note">{error ?? "No lists yet — make one on the Lists screen."}</p>;
  }

  return (
    <>
      <ul className="add-to-list-choices">
        {lists.map((list) => (
          <li key={list.id}>
            <label className="add-to-list-choice">
              <input
                type="checkbox"
                className="themed-check"
                checked={member.has(list.id)}
                disabled={busy === list.id}
                onChange={() => void toggle(list)}
              />
              <span>{list.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="card-menu-note error">{error}</p>}
    </>
  );
}