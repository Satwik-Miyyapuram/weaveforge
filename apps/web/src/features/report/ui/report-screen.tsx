"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReportSection,
  type ReportSectionTreeNode,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { usePinnedOwnerNames } from "@/features/sharing";
import { AddSectionForm } from "./add-section-form";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { SectionNote } from "./section-note";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { navTransition } from "@/lib/view-transition";
import { SectionRow, SectionCard } from "./section-card";
import { progressOf, collectSectionIds, patchSectionInTree, flattenParentOptions, sectionsEyebrow } from "./report-section-tree";
import { Button } from "@/components/button";
import { deferDelete, useHiddenKeys } from "@/lib/toast";
import { sectionKey } from "./remove-section";

type ReportViewData = ReportScreenData & {
  ownerNames: Map<string, string>;
};

/**
 * Report sections outline. Overleaf link/export lives on `/report/overleaf`.
 */
export function ReportScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [guestSection, setGuestSection] = useState<ReportSection | null>(null);

  const isSharedView = searchParams.get("shared") === "1";
  const sectionFromUrl = searchParams.get("section");
  const appliedSectionFromUrl = useRef<string | null>(null);
  const sectionOpenGeneration = useRef(0);
  const { setPushed, consumePushed } = useDetailPushFlag();
  const goBackToList = useDetailBack("/report", "section", consumePushed);

  const openSectionById = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", id);
      setPushed();
      navTransition("forward", () => router.push(`/report?${params.toString()}`));
    },
    [router, searchParams, setPushed],
  );

  const loadScreen = useCallback(async (): Promise<ReportViewData> => {
    const data = await getContainer().report.loadScreenData();
    // Owner labels arrive separately — see usePinnedOwnerNames. Awaiting the
    // lab directory here delayed the whole screen by ~1.8s.
    return { ...data, ownerNames: emptyMap<string, string>() };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("report", loadScreen);

  usePinnedOwnerNames(data, setData);
  const hiddenKeys = useHiddenKeys();

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const tree = data?.tree ?? emptyArray<ReportSectionTreeNode>();
  const flat = data?.flat ?? emptyArray<ReportSection>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const reportCanComment = data?.reportCanComment ?? emptyMap<string, boolean>();
  const reportCanEdit = data?.reportCanEdit ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  const ownedIds = useMemo(
    () => new Set(tree.flatMap((n) => collectSectionIds(n))),
    [tree],
  );

  const pinnedSections = useMemo(
    () => flat.filter((s) => pinnedSharedBy.has(s.id) && !ownedIds.has(s.id)),
    [flat, pinnedSharedBy, ownedIds],
  );

  const toggleCollapse = useCallback((sectionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const ownedFlat = useMemo(() => flat.filter((s) => ownedIds.has(s.id)), [flat, ownedIds]);

  useEffect(() => {
    if (!sectionFromUrl) {
      appliedSectionFromUrl.current = null;
      setGuestSection(null);
      setOpenId(null);
      return;
    }
    const owned = flat.some((s) => s.id === sectionFromUrl);
    const shared = isSharedView || pinnedSharedBy.has(sectionFromUrl);
    if (!owned && !shared) {
      appliedSectionFromUrl.current = null;
      setGuestSection(null);
      setOpenId(null);
      return;
    }
    if (appliedSectionFromUrl.current === sectionFromUrl) {
      setOpenId(sectionFromUrl);
      return;
    }
    const requestedId = sectionFromUrl;
    const generation = ++sectionOpenGeneration.current;
    let cancelled = false;
    setOpenId(requestedId);
    void getContainer()
      .report.getSection(requestedId)
      .then((s) => {
        if (cancelled || generation !== sectionOpenGeneration.current) return;
        if (!s) {
          appliedSectionFromUrl.current = null;
          setGuestSection(null);
          setOpenId(null);
          return;
        }
        appliedSectionFromUrl.current = requestedId;
        setGuestSection(s);
        setOpenId(requestedId);
      })
      .catch(() => {
        if (cancelled || generation !== sectionOpenGeneration.current) return;
        appliedSectionFromUrl.current = null;
        setGuestSection(null);
        setOpenId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sectionFromUrl, flat, isSharedView, pinnedSharedBy]);

  const closeSection = useCallback(() => {
    sectionOpenGeneration.current += 1;
    setOpenId(null);
    setGuestSection(null);
    appliedSectionFromUrl.current = null;
    goBackToList();
  }, [goBackToList]);

  const replaceSection = useCallback(
    (s: ReportSection) => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              flat: prev.flat.map((x) => (x.id === s.id ? s : x)),
              tree: patchSectionInTree(prev.tree, s),
            }
          : prev,
      );
      setGuestSection((g) => (g?.id === s.id ? s : g));
    },
    [setData],
  );

  const { isReadOnly: isReadOnlySection, sharedOwnerName } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames, canEdit: reportCanEdit });

  const done = ownedFlat.filter((s) => s.status === "done").length;
  const pct = ownedFlat.length ? Math.round((done / ownedFlat.length) * 100) : 0;
  const parentOptions = useMemo(() => flattenParentOptions(tree), [tree]);

  const openSection = openId
    ? flat.find((s) => s.id === openId) ?? (guestSection?.id === openId ? guestSection : null)
    : null;

  useEffect(() => {
    if (!openSection) return;
    rememberRecentTarget(getContainer().projects.context.projectId, {
      kind: "section",
      id: openSection.id,
      title: openSection.title,
      href: `/report?section=${encodeURIComponent(openSection.id)}`,
    });
  }, [openSection]);

  if (openSection) {
    return (
      <section className="screen report-screen">
        <SectionNote
          key={openSection.id}
          section={openSection}
          progress={progressOf(tree, openSection.id)}
          readOnly={isReadOnlySection(openSection.id)}
          sharedByName={sharedOwnerName(openSection.id)}
          sharedContent={isSharedView || pinnedSharedBy.has(openSection.id)}
          canComment={reportCanComment.get(openSection.id) ?? false}
          onBack={closeSection}
          onReplace={replaceSection}
          onChanged={() => void load()}
        />
      </section>
    );
  }

  if (loading) {
    return <ScreenLoading status="Loading report…" />;
  }

  return (
    <section className="screen report-screen">
      <ScreenHead title="Report" eyebrow={sectionsEyebrow(ownedFlat.length, tree.filter((n) => ownedIds.has(n.section.id)))}>
        <Button
          variant="primary"
         
          onClick={() => setComposeOpen(true)}
        >
          New section
        </Button>
      </ScreenHead>

      {composeOpen && (
        <Modal
          title="New section"
          onClose={() => setComposeOpen(false)}
        >
          <AddSectionForm
            parentOptions={parentOptions}
            onAdded={() => {
              setComposeOpen(false);
              void load();
            }}
          />
        </Modal>
      )}

      {ownedFlat.length > 0 && (
        <div className="card progress-card">
          <div className="progress-top">
            <span>{done} of {ownedFlat.length} sections done</span>
            <strong>{pct}%</strong>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {error && <FormError>{error}</FormError>}
      {!error && tree.length === 0 && pinnedSections.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="doc" />}
          title="No sections yet"
          body="The report is the outline your thesis gets written into. Add the sections you already know — introduction, method, results — and the notes and runs you have made start having somewhere to go."
          action={
            <Button
              variant="primary"
              onClick={() => setComposeOpen(true)}
            >
              New section
            </Button>
          }
        />
      )}

      {tree.length > 0 && (
        <ul className="section-tree">
          {tree.map((node) => (
            <SectionRow
              key={node.section.id}
              node={node}
              depth={0}
              readOnly={isReadOnlySection(node.section.id)}
              sharedByName={sharedOwnerName(node.section.id)}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              onOpen={openSectionById}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {pinnedSections.length > 0 && (
        <>
          <h4 className="settings-group vault-pinned-label">Shared with you</h4>
          <ul className="section-tree">
            {pinnedSections.filter((s) => !hiddenKeys.has(sectionKey(s.id))).map((s) => (
              <li key={s.id} id={`section-${s.id}`} className="section-node">
                <SectionCard
                  section={s}
                  readOnly
                  isPinned
                  sharedByName={sharedOwnerName(s.id)}
                  onOpen={openSectionById}
                  onUnpin={() =>
                    deferDelete({
                      keys: [sectionKey(s.id)],
                      message: `"${s.title}" removed from your report`,
                      commit: async () => {
                        await getContainer().sharing.unpinShared("report_section", s.id);
                        await load();
                      },
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

