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

export interface SyncIssues {
  conflicts: OpenConflict[];
  dead: OutboxEntry[];
}

const NONE: SyncIssues = { conflicts: [], dead: [] };

export interface SyncIssuesHandle {
  issues: SyncIssues;
  refresh: () => void;
  keep: (id: string, picks: Record<string, "local" | "remote">) => Promise<void>;
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

  return {
    issues,
    refresh,
    keep: (id, picks) => act((sql) => new ConflictStore(sql).resolveWith(id, picks)),
    retry: (opId) => act((sql) => new Outbox(sql).revive(opId)),
    discard: (opId) => act((sql) => new Outbox(sql).settle(opId)),
  };
}
