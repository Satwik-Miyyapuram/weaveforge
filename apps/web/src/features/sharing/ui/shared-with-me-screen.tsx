"use client";

import { useCallback, useMemo, useState } from "react";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import type { SharedItemDetail } from "@/features/sharing/application/load-shared-details";
import { buildMemberNameMap } from "@/features/sharing/application/member-labels";
import { SharedItemRenderer } from "@/features/sharing/ui/shared-item-renderer";
import { useScreenData } from "@/lib/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { LoadSharedWithMeScreenData } from "@/features/sharing/application/load-shared-with-me-screen.use-case";

type SharedWithMeView = {
  items: SharedItemDetail[];
  nameOf: Map<string, string>;
};

/**
 * Everything other people have shared with me, grouped by who shared it.
 * Read-only (writes stay owner-only); each item opens a feedback thread so I can
 * comment where the share grants it.
 */
export function SharedWithMeScreen() {
  const loadScreen = useCallback(async (): Promise<SharedWithMeView> => {
    const data = await getContainer().sharing.loadSharedWithMeScreen();
    return { items: data.items, nameOf: buildMemberNameMap(data.members) };
  }, []);

  const { data, loading, error, reload: load } = useScreenData("shared-with-me", loadScreen);
  const items = data?.items ?? emptyArray<LoadSharedWithMeScreenData["items"][number]>();
  const nameOf = data?.nameOf ?? emptyMap<string, string>();

  const byOwner = useMemo(() => {
    const groups = new Map<string, SharedItemDetail[]>();
    for (const it of items) {
      const arr = groups.get(it.ownerId) ?? [];
      arr.push(it);
      groups.set(it.ownerId, arr);
    }
    return [...groups.entries()];
  }, [items]);

  if (loading) {
    return <ScreenLoading status="Loading shared items…" />;
  }

  return (
    <section className="screen">
      {error && <p className="error">{error}</p>}
      {!error && byOwner.length === 0 && (
        <div className="empty"><p>Nothing shared with you yet.</p></div>
      )}

      {byOwner.map(([ownerId, list]) => (
        <div key={ownerId} className="shared-group">
          <h3 className="settings-group">{nameOf.get(ownerId) ?? "Member"}</h3>
          <ul className="exp-list">
            {list.map((it) => (
              <SharedItemRenderer
                key={`${it.kind}:${it.id}`}
                item={it}
                ownerName={nameOf.get(ownerId) ?? "Member"}
                canComment={it.canComment}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
