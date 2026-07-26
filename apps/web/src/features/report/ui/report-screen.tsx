"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  REPORT_STATUSES,
  type ReportSection,
  type ReportSectionTreeNode,
  type ReportStatus,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { AddSectionForm, type ReportParentOption } from "./add-section-form";
import { Select } from "@/components/select";
import { ChevronIcon } from "@/components/chevron-icon";
import { EntityCard } from "@/components/entity-card";
import { useScreenData } from "@/lib/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { SectionNote } from "./section-note";
import { Markdown } from "@/components/markdown";
import { rememberRecentTarget } from "@/lib/recent-targets";

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
  const { setPushed, consumePushed } = useDetailPushFlag();
  const goBackToList = useDetailBack("/report", "section", consumePushed);

  const openSectionById = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", id);
      setPushed();
      router.push(`/report?${params.toString()}`);
    },
    [router, searchParams, setPushed],
  );

  const loadScreen = useCallback(async (): Promise<ReportViewData> => {
    const data = await getContainer().report.loadScreenData();
    const ownerNames = await loadPinnedOwnerNames(data.pinnedSharedBy);
    return { ...data, ownerNames };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("report", loadScreen);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const tree = data?.tree ?? emptyArray<import("@thesis/core").ReportSectionTreeNode>();
  const flat = data?.flat ?? emptyArray<import("@thesis/core").ReportSection>();
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
    if (appliedSectionFromUrl.current === sectionFromUrl) return;
    if (flat.some((s) => s.id === sectionFromUrl)) {
      appliedSectionFromUrl.current = sectionFromUrl;
      setOpenId(sectionFromUrl);
      return;
    }
    if (isSharedView || pinnedSharedBy.has(sectionFromUrl)) {
      const requestedId = sectionFromUrl;
      let cancelled = false;
      void getContainer()
        .report.getSection(requestedId)
        .then((s) => {
          if (cancelled) return;
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
          if (cancelled) return;
          appliedSectionFromUrl.current = null;
          setGuestSection(null);
          setOpenId(null);
        });
      return () => {
        cancelled = true;
      };
    }
    appliedSectionFromUrl.current = null;
    setGuestSection(null);
    setOpenId(null);
  }, [sectionFromUrl, flat, isSharedView, pinnedSharedBy]);

  const closeSection = useCallback(() => {
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

  const isReadOnlySection = useCallback(
    (id: string) => (isSharedView || pinnedSharedBy.has(id)) && !reportCanEdit.get(id),
    [isSharedView, pinnedSharedBy, reportCanEdit],
  );

  const sharedOwnerName = useCallback(
    (id: string) => {
      const ownerId = pinnedSharedBy.get(id);
      return ownerId ? ownerNames.get(ownerId) : undefined;
    },
    [pinnedSharedBy, ownerNames],
  );

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
          readOnly={isReadOnlySection(openSection.id)}
          sharedByName={sharedOwnerName(openSection.id)}
          canComment={reportCanComment.get(openSection.id) ?? false}
          onBack={closeSection}
          onReplace={replaceSection}
          onChanged={() => {
            closeSection();
            void load();
          }}
        />
      </section>
    );
  }

  if (loading) {
    return <ScreenLoading status="Loading report…" />;
  }

  return (
    <section className="screen report-screen">
      <header className="screen-head">
        <div className="head-row">
          <h1 className="screen-title">Sections</h1>
          <div className="screen-actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => setComposeOpen(true)}
            >
              + Section
            </button>
          </div>
        </div>
      </header>

      {composeOpen && (
        <Modal
          title="Add a section"
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
            <span>{done} / {ownedFlat.length} sections done</span>
            <strong>{pct}%</strong>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!error && tree.length === 0 && pinnedSections.length === 0 && (
        <div className="empty">
          <p>No sections yet. Use “+ Report” to sketch your outline.</p>
        </div>
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
            />
          ))}
        </ul>
      )}

      {pinnedSections.length > 0 && (
        <>
          <h4 className="settings-group vault-pinned-label">Shared with you</h4>
          <ul className="section-tree">
            {pinnedSections.map((s) => (
              <li key={s.id} id={`section-${s.id}`} className="section-node">
                <SectionCard
                  section={s}
                  readOnly
                  sharedByName={sharedOwnerName(s.id)}
                  onOpen={openSectionById}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function collectSectionIds(node: ReportSectionTreeNode): string[] {
  return [node.section.id, ...node.children.flatMap(collectSectionIds)];
}

function patchSectionInTree(
  nodes: ReportSectionTreeNode[],
  section: ReportSection,
): ReportSectionTreeNode[] {
  return nodes.map((n) =>
    n.section.id === section.id
      ? { ...n, section }
      : { ...n, children: patchSectionInTree(n.children, section) },
  );
}

/** Outline-order list of every section that can be a parent (any depth). */
function flattenParentOptions(nodes: ReportSectionTreeNode[]): ReportParentOption[] {
  const out: ReportParentOption[] = [];
  const walk = (list: ReportSectionTreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ section: node.section, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

function SectionRow({
  node,
  depth = 0,
  readOnly = false,
  sharedByName,
  collapsed,
  onToggleCollapse,
  onOpen,
  onChanged,
}: {
  node: ReportSectionTreeNode;
  depth?: number;
  readOnly?: boolean;
  sharedByName?: string;
  collapsed: Set<string>;
  onToggleCollapse: (sectionId: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const s = node.section;
  const [busy, setBusy] = useState(false);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(s.id);
  const isRoot = depth === 0;

  async function changeStatus(status: ReportStatus) {
    await getContainer().report.manageReportSection.setStatus(s.id, status);
    onChanged();
  }

  async function remove() {
    const msg = node.children.length > 0
      ? `Delete "${s.title}" and its ${node.children.length} subsection(s)?`
      : `Delete "${s.title}"?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      async function removeTree(n: ReportSectionTreeNode) {
        for (const child of n.children) {
          await removeTree(child);
        }
        await getContainer().report.removeSection(n.section);
      }
      await removeTree(node);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const collapse =
    hasChildren
      ? { open: !isCollapsed, onToggle: () => onToggleCollapse(s.id) }
      : undefined;

  return (
    <li id={`section-${s.id}`} className="section-node">
      <SectionCard
        section={s}
        readOnly={readOnly}
        sharedByName={sharedByName}
        busy={busy}
        collapse={collapse}
        nested={!isRoot}
        onStatusChange={readOnly ? undefined : changeStatus}
        onRemove={readOnly ? undefined : () => void remove()}
        onOpen={onOpen}
      />
      {hasChildren && !isCollapsed && (
        <ul className="section-tree nested">
          {node.children.map((child) => (
            <SectionRow
              key={child.section.id}
              node={child}
              depth={depth + 1}
              readOnly={readOnly}
              sharedByName={sharedByName}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onOpen={onOpen}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Card preview: drop images so outline stays cheap; prose still renders as HTML. */
function sectionCardPreviewMd(body: string): string {
  return body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

function SectionCard({
  section: s,
  readOnly = false,
  sharedByName,
  busy = false,
  collapse,
  nested = false,
  onStatusChange,
  onRemove,
  onOpen,
}: {
  section: ReportSection;
  readOnly?: boolean;
  sharedByName?: string;
  busy?: boolean;
  collapse?: { open: boolean; onToggle: () => void };
  nested?: boolean;
  onStatusChange?: (status: ReportStatus) => void;
  onRemove?: () => void;
  onOpen?: (id: string) => void;
}) {
  const hasNotes = Boolean(s.notes?.trim());
  const meta = [
    s.targetWords ? `${s.wordCount} / ${s.targetWords} words` : `${s.wordCount} words`,
    s.deadline ? `due ${s.deadline}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <EntityCard
      className={`section-item${nested ? " section-item--nested" : ""}`}
      nested={nested}
      onActivate={onOpen ? () => onOpen(s.id) : undefined}
      leading={
        collapse ? (
          <button
            type="button"
            className="list-toggle section-head-toggle"
            aria-expanded={collapse.open}
            aria-label={collapse.open ? "Collapse section" : "Expand section"}
            onClick={(e) => {
              e.stopPropagation();
              collapse.onToggle();
            }}
          >
            <ChevronIcon open={collapse.open} variant="expand" size={16} />
          </button>
        ) : undefined
      }
      title={
        <>
          {s.sectionNo && <span className="muted">{s.sectionNo} </span>}
          {s.title}
        </>
      }
      status={
        readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <Select
            className="status-select"
            value={s.status}
            onChange={(e) => onStatusChange?.(e.target.value as ReportStatus)}
            aria-label={`Status for ${s.title}`}
          >
            {REPORT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st.replace("_", " ")}
              </option>
            ))}
          </Select>
        )
      }
      meta={meta}
      onDelete={readOnly || !onRemove ? undefined : onRemove}
      deleteDisabled={busy}
      deleteAriaLabel="Delete section"
      actions={
        !readOnly ? (
          <ShareButton resourceType="report_section" resourceId={s.id} title={`Share: ${s.title}`} />
        ) : undefined
      }
      onOpen={onOpen ? () => onOpen(s.id) : undefined}
      openLabel={hasNotes ? "Open section" : "Write section"}
    >
      {hasNotes ? (
        <div className="section-note-md-preview">
          <Markdown className="summary">{sectionCardPreviewMd(s.notes!)}</Markdown>
        </div>
      ) : null}
    </EntityCard>
  );
}
