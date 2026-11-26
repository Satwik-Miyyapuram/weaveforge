"use client";

import { useCallback, useRef, useState } from "react";
import { EditorBases } from "@/lib/editor-bases";

/** True for the error a store throws when the file changed on disk and the save was refused. */
function isConflict(err: unknown): boolean {
  return err instanceof Error && err.name === "ConflictError";
}

/**
 * The save base of one editor that keeps its own text across a reload (a report section's notes, a
 * paper's summary). `text` is what the page holds now; the editor mounts with it and `key` is its React key.
 *
 * Saves run one after another, each based on what the one before stored, never on text a reload brought in
 * meanwhile. After a refused save (ConflictError) the editor is reseeded at once, so it remounts on the text
 * the page holds even when the reload that `onConflict` asks for brings nothing new; when that reload does
 * bring new text, the editor is reseeded once more, on it. The rule is `EditorBases`'.
 */
export function useEditorBase(
  id: string,
  text: string,
  onConflict: () => void,
): { key: string; run: (write: (base: string) => Promise<string>) => Promise<string> } {
  const basesRef = useRef<EditorBases | null>(null);
  basesRef.current ??= new EditorBases();
  const bases = basesRef.current;
  const [, setReseeds] = useState(0);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  /** After a conflict: the id and the text the page held then; a reload with other text reseeds again. */
  const pending = useRef<{ id: string; text: string } | null>(null);
  if (pending.current && (pending.current.id !== id || pending.current.text !== text)) {
    if (pending.current.id === id) bases.reseed(id);
    pending.current = null;
  }
  const key = bases.slot(id, text);
  const textRef = useRef(text);
  textRef.current = text;
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback(
    (write: (base: string) => Promise<string>) =>
      bases.saves.run(key, undefined, (base) => write(base ?? "")).catch((err: unknown) => {
        // A save the replaced editor still had queued is refused too; the editor on screen is already new.
        if (isConflict(err) && keyRef.current === key) {
          bases.reseed(id);
          pending.current = { id, text: textRef.current };
          setReseeds((n) => n + 1);
          onConflictRef.current();
        }
        throw err;
      }),
    [bases, id, key],
  );
  return { key, run };
}
