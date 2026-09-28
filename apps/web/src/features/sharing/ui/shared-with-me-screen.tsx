"use client";

import { useCallback, useMemo, useState } from "react";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import type { SharedItemDetail } from "@/features/sharing/application/load-shared-details";
import { buildMemberNameMap } from "@/features/sharing/application/member-labels";
import { SharedItemRenderer } from "@/features/sharing/ui/shared-item-renderer";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { LoadSharedWithMeScreenData } from "@/features/sharing/application/load-shared-with-me-screen.use-case";
import { FormError } from "@/components/form-error";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import Link from "next/link";
import { ScreenHead } from "@/components/screen-head";
import { sharedItemTypeLabel } from "@/features/sharing/ui/shared-item-routes";
import { Modal } from "@/components/modal";
import { ShareButton } from "@/features/sharing/ui/share-button";
import { useProfile } from "@/features/org";
import type { ShareableType } from "@weaveforge/core";

/** Blanket shares: every item of a type you own, including later ones. */
const SHARE_ALL: { type: ShareableType; title: string; desc: string }[] = [
  { type: "vault_page", title: "All notes", desc: "Every note, now and later." },
  { type: "paper", title: "All papers", desc: "Every paper in your library." },
  { type: "experiment", title: "All experiments", desc: "Every experiment run." },
  { type: "report_section", title: "Whole report", desc: "Every report section." },
  { type: "milestone", title: "Whole plan", desc: "Every milestone." },
  { type: "reading_list", title: "All reading lists", desc: "Every reading list." },
];

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

  const { data, loading, error } = useScreenData("shared-with-me", loadScreen);
  const { profile } = useProfile();
  const canSupervise = !!profile && profile.role !== "masters";
  const [hubOpen, setHubOpen] = useState(false);
  const [shareType, setShareType] = useState<ShareableType | null>(null);
  const items = data?.items ?? emptyArray<LoadSharedWithMeScreenData["items"][number]>();
  const nameOf = data?.nameOf ?? emptyMap<string, string>();

  const [kindFilter, setKindFilter] = useState<SharedItemDetail["kind"] | "all">("all");
  const kinds = useMemo(() => [...new Set(items.map((it) => it.kind))], [items]);
  const ownerCount = useMemo(() => new Set(items.map((it) => it.ownerId)).size, [items]);

  const byOwner = useMemo(() => {
    const groups = new Map<string, SharedItemDetail[]>();
    for (const it of items) {
      if (kindFilter !== "all" && it.kind !== kindFilter) continue;
      const arr = groups.get(it.ownerId) ?? [];
      arr.push(it);
      groups.set(it.ownerId, arr);
    }
    return [...groups.entries()];
  }, [items, kindFilter]);

  if (loading) {
    return <ScreenLoading status="Loading shared items…" />;
  }

  return (
    <section className="screen shared-screen">
      <ScreenHead
        title="Shared with me"
        eyebrow={items.length > 0 ? `${items.length} ${items.length === 1 ? "item" : "items"} from ${ownerCount} ${ownerCount === 1 ? "person" : "people"}` : undefined}
      >
        {kinds.length > 1 && (
          <div className="shared-filter" role="group" aria-label="Filter by type">
            {(["all", ...kinds] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={kindFilter === k ? "active" : undefined}
                aria-pressed={kindFilter === k}
                onClick={() => setKindFilter(k)}
              >
                {k === "all" ? "All" : pluralLabel(k)}
              </button>
            ))}
          </div>
        )}
        {canSupervise && (
          <Link className="btn-secondary" href="/supervision">
            Supervision
          </Link>
        )}
        <button className="btn-primary" type="button" onClick={() => setHubOpen(true)}>
          Share my work
        </button>
      </ScreenHead>

      {hubOpen && (
        <Modal title="Share my work" onClose={() => setHubOpen(false)}>
          <div className="org-modal-choices">
            {SHARE_ALL.map((c) => (
              <button
                key={c.type}
                type="button"
                className="org-choice-card"
                onClick={() => {
                  setHubOpen(false);
                  setShareType(c.type);
                }}
              >
                <span className="org-choice-title">{c.title}</span>
                <p className="org-choice-desc">{c.desc}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {shareType && (
        <ShareButton
          resourceType={shareType}
          resourceId={null}
          title={`Share ${SHARE_ALL.find((c) => c.type === shareType)?.title.toLowerCase() ?? "all"}`}
          hideTrigger
          open
          onOpenChange={(open) => {
            if (!open) setShareType(null);
          }}
        />
      )}
      {error && <FormError>{error}</FormError>}
      {!error && items.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="book" />}
          title="Nothing shared with you yet"
          body="When someone shares a paper, a note or a reading list with you, it lands here grouped by who sent it. You can comment on what they share; the edits stay theirs."
          action={
            <Link className="btn-secondary" href="/papers">
              Go to your papers
            </Link>
          }
        />
      )}

      {byOwner.map(([ownerId, list]) => (
        <div key={ownerId} className="shared-group">
          <h3 className="settings-group shared-group-head">
            <span className="superv-avatar" aria-hidden>{initialsOf(nameOf.get(ownerId) ?? "Member")}</span>
            <span>{nameOf.get(ownerId) ?? "Member"}</span>
            <span className="shared-group-count">
              {list.length} {list.length === 1 ? "item" : "items"}
            </span>
          </h3>
          <ul className="exp-list shared-grid">
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

function pluralLabel(kind: SharedItemDetail["kind"]): string {
  const label = sharedItemTypeLabel(kind);
  return label.charAt(0).toUpperCase() + label.slice(1) + "s";
}

function initialsOf(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
