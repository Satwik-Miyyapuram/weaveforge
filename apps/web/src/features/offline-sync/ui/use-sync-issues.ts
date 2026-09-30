"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { ConflictStore, type OpenConflict } from "../domain/conflicts";
import { Outbox, type OutboxEntry } from "../domain/outbox";

/**
 * The two things sync can leave for a person to decide: rows two devices
 * disagree about, and ops the server kept refusing.
 *
 * Both are read together because they are shown together, and because a
 * device with neither has nothing to say — the panel that reads this renders
 * nothing rather than an empty "all clear" the reader has to parse.
 */

import { writeConflictMarkers } from "@weaveforge/core";

export interface SyncIssues {
  conflicts: OpenConflict[];
  dead: OutboxEntry[];
}

const NONE: SyncIssues = { conflicts: [], dead: [] };

export interface SyncIssuesHandle {
  issues: SyncIssues;
  refresh: () => void;
  keep: (
    id: string,
    picks: Record<string, "local" | "remote">,
    overrides?: Record<string, unknown>,
  ) => Promise<void>;
  keepAllLocal: (id: string) => Promise<void>;
  keepAllRemote: (id: string) => Promise<void>;
  keepAllConflicts: (side: "local" | "remote") => Promise<void>;
  resolveWithMarkers: (id: string, field: string) => Promise<void>;
  retry: (opId: string) => Promise<void>;
  discard: (opId: string) => Promise<void>;
}

export function useSyncIssues(): SyncIssuesHandle {
  const [issues, setIssues] = useState<SyncIssues>(NONE);

  const refresh = useCallback(() => {
    if (!desktop()) {
      setIssues(NONE);
      return;
    }
    const sql = new LocalRunner();
    void Promise.all([new ConflictStore(sql).openConflicts(), new Outbox(sql).dead()])
      .then(([conflicts, dead]) => setIssues({ conflicts, dead }))
      // A local database that will not answer is not something the reader can
      // act on from here; it reads as nothing outstanding.
      .catch(() => setIssues(NONE));
  }, []);

  useEffect(refresh, [refresh]);

  const act = useCallback(
    (run: (sql: LocalRunner) => Promise<void>) => run(new LocalRunner()).then(refresh),
    [refresh],
  );

  const keep = useCallback(
    (id: string, picks: Record<string, "local" | "remote">, overrides?: Record<string, unknown>) =>
      act((sql) => new ConflictStore(sql).resolveWith(id, picks, overrides)),
    [act],
  );

  const keepAllLocal = useCallback(
    (id: string) => {
      const conflict = issues.conflicts.find((c) => c.id === id);
      if (!conflict) return Promise.resolve();
      const picks: Record<string, "local" | "remote"> = {};
      for (const f of conflict.fields) picks[f.field] = "local";
      return keep(id, picks);
    },
    [issues.conflicts, keep],
  );

  const keepAllRemote = useCallback(
    (id: string) => {
      const conflict = issues.conflicts.find((c) => c.id === id);
      if (!conflict) return Promise.resolve();
      const picks: Record<string, "local" | "remote"> = {};
      for (const f of conflict.fields) picks[f.field] = "remote";
      return keep(id, picks);
    },
    [issues.conflicts, keep],
  );

  const keepAllConflicts = useCallback(
    async (side: "local" | "remote") => {
      for (const conflict of issues.conflicts) {
        const picks: Record<string, "local" | "remote"> = {};
        for (const f of conflict.fields) picks[f.field] = side;
        await keep(conflict.id, picks);
      }
    },
    [issues.conflicts, keep],
  );

  const resolveWithMarkers = useCallback(
    (id: string, field: string) => {
      const conflict = issues.conflicts.find((c) => c.id === id);
      if (!conflict) return Promise.resolve();
      const localVal = String(conflict.local[field] ?? "");
      const remoteVal = String(conflict.remote ? conflict.remote[field] ?? "" : "");
      const marked = writeConflictMarkers(localVal, remoteVal);
      return keep(id, {}, { [field]: marked });
    },
    [issues.conflicts, keep],
  );

  return {
    issues,
    refresh,
    keep,
    keepAllLocal,
    keepAllRemote,
    keepAllConflicts,
    resolveWithMarkers,
    retry: (opId) => act((sql) => new Outbox(sql).revive(opId)),
    discard: (opId) => act((sql) => new Outbox(sql).settle(opId)),
  };
}
