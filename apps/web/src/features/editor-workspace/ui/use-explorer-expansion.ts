"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  readExpanded,
  readMigrated,
  readSections,
  writeExpanded,
  writeMigrated,
  type ExplorerSection,
  type SectionState,
} from "../application/explorer-state";

/**
 * Which rows and which sections of the explorer are open, read from storage
 * after mount and migrated once for roots the stored record has never seen.
 */
export function useExplorerExpansion(sections: readonly ExplorerSection[]) {
  // Read after mount: the server render has no `localStorage`, and deciding
  // there would ship a tree that jumps open on hydration. The roots the tree
  // actually has are what "start open" means — see `defaultExpanded`.
  const rootKeys = useMemo(
    () => sections.flatMap((section) => section.tree.map((node) => node.key)),
    [sections],
  );
  /** The same keys as one string, so the read effect has a stable dependency. */
  const rootKeyList = rootKeys.join("\u0000");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
    readExpanded(undefined, rootKeys),
  );
  const [openSections, setOpenSections] = useState<SectionState>(() =>
    readSections(undefined, sections),
  );
  /**
   * Whether the "a root the record has never heard of" migration may still run
   * in this session.
   *
   * Read once from storage on the first pass, and marked done as soon as a read
   * has had roots to compare against. A ref rather than component state because
   * it is not rendered and must not cause one; a *stored* flag rather than only
   * a ref because a session boundary is exactly what the migration has to
   * survive — a fresh session cannot tell "this record predates the root" from
   * "the reader closed it", so a per-session flag reopens the Log on every
   * launch, which is how the first version of this behaved.
   */
  const migrateOnThisRead = useRef<boolean | null>(null);

  useEffect(() => {
    const store = typeof localStorage === "undefined" ? undefined : localStorage;
    // Read the stored flag once. After this, the answer is whatever it was.
    if (migrateOnThisRead.current === null) migrateOnThisRead.current = !readMigrated(store);
    const mayMigrate = migrateOnThisRead.current && rootKeys.length > 0;
    const next = readExpanded(store, rootKeys, mayMigrate);
    if (store && mayMigrate) {
      writeExpanded(store, next);
      writeMigrated(store);
      migrateOnThisRead.current = false;
    }
    setExpanded(next);
    setOpenSections(readSections(store, sections));
    // The sections arrive once their data has loaded. Re-reading on every
    // change would undo the expansion the user has just made as the tree fills
    // in, so this runs on the mount and once more when the roots arrive — the
    // second read is what lets "start open" mean the roots this workspace has
    // rather than a list hard-coded here. `rootKeyList` is the string form so
    // the effect does not re-run on a new array of the same keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKeyList]);

  return { expanded, setExpanded, openSections, setOpenSections };
}
