"use client";

import {
  REPORT_STATUSES,
  type ReportSection,
  type ReportSectionTreeNode,
  type ReportStatus,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { PinnedPaperBadge } from "@/features/sharing";
import { ChevronIcon } from "@/components/chevron-icon";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { editedLabel } from "../lib/edited-label";
import { countSectionSources } from "../lib/section-sources";
import { sectionProgress, type SectionProgress } from "../lib/section-progress";
import { Markdown } from "@/components/markdown/markdown";
import { StatusSelect } from "@/components/status-select";
import { runReported } from "@/lib/run-reported";
import { useHiddenKeys } from "@/lib/toast";
import { removeSectionLater, sectionKey } from "./remove-section";
import { useRef, useState } from "react";
import { IconButton } from "@/components/button";

export function SectionRow({
  node,
  depth = 0,
  readOnly = false,
  sharedByName,
  collapsed,
  onToggleCollapse,
  onOpen,
  onChanged,
  onError,
}: {
  node: ReportSectionTreeNode;
  depth?: number;
  readOnly?: boolean;
  sharedByName?: string;
  collapsed: Set<string>;
  onToggleCollapse: (sectionId: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const s = node.section;
  const hiddenKeys = useHiddenKeys();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(s.id);
  const isRoot = depth === 0;

  async function changeStatus(status: ReportStatus) {
    // Reload either way so the select shows the stored status.
    await runReported(() => getContainer().report.manageReportSection.setStatus(s.id, status), onError, onChanged);
  }

  async function rename(title: string) {
    await runReported(() => getContainer().report.manageReportSection.setTitle(s.id, title), onError, onChanged);
  }

  function remove() {
    removeSectionLater(s, node.children.length, { onDeleted: onChanged });
  }

  const collapse =
    hasChildren
      ? { open: !isCollapsed, onToggle: () => onToggleCollapse(s.id) }
      : undefined;

  if (hiddenKeys.has(sectionKey(s.id))) return null;

  return (
    <li id={`section-${s.id}`} className="section-node">
      <SectionCard
        section={s}
        progress={sectionProgress(node)}
        readOnly={readOnly}
        sharedByName={sharedByName}
        collapse={collapse}
        inTree
        nested={!isRoot}
        onStatusChange={readOnly ? undefined : changeStatus}
        onRename={readOnly ? undefined : rename}
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
              onError={onError}
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

export function SectionCard({
  section: s,
  progress: rolled,
  readOnly = false,
  isPinned = false,
  sharedByName,
  busy = false,
  collapse,
  inTree = false,
  nested = false,
  onStatusChange,
  onRename,
  onRemove,
  onUnpin,
  onOpen,
}: {
  section: ReportSection;
  /** Words under this section, subsections included; its own text when absent. */
  progress?: SectionProgress;
  readOnly?: boolean;
  isPinned?: boolean;
  sharedByName?: string;
  busy?: boolean;
  collapse?: { open: boolean; onToggle: () => void };
  /** In the outline tree: a leaf keeps a chevron-wide gap so every title starts at one x. */
  inTree?: boolean;
  nested?: boolean;
  onStatusChange?: (status: ReportStatus) => void;
  onRename?: (title: string) => void | Promise<void>;
  onRemove?: () => void;
  onUnpin?: () => void | Promise<void>;
  onOpen?: (id: string) => void;
}) {
  const hasNotes = Boolean(s.notes?.trim());
  const sources = countSectionSources(s.notes);
  const { words, target, pct: progress } = rolled ?? sectionProgress({ section: s, children: [] });
  const meta = [
    target ? `${words.toLocaleString()} / ${target.toLocaleString()} words` : `${words.toLocaleString()} words`,
    s.deadline ? `due ${s.deadline}` : null,
    sources > 0 ? `${sources} source${sources === 1 ? "" : "s"}` : null,
    editedLabel(s.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const [renaming, setRenaming] = useState(false);
  const cancelled = useRef(false);

  function finishRename(value: string) {
    setRenaming(false);
    const title = value.trim();
    if (cancelled.current || !title || title === s.title) return;
    void onRename?.(title);
  }

  const extraItems = [
    ...(onOpen ? [{ id: "open", label: "Open", onSelect: () => onOpen(s.id) }] : []),
    ...(onRename ? [{ id: "rename", label: "Rename", onSelect: () => setRenaming(true) }] : []),
  ];

  return (
    <EntityCard
      className={`section-item section-item--${s.status}${nested ? " section-item--nested" : ""}`}
      nested={nested}
      onActivate={onOpen ? () => onOpen(s.id) : undefined}
      leading={
        collapse ? (
          <span className="section-head-toggle">
            <IconButton
              size="sm"
              label={collapse.open ? "Collapse section" : "Expand section"}
              aria-expanded={collapse.open}
              onClick={(e) => {
                e.stopPropagation();
                collapse.onToggle();
              }}
            >
              <ChevronIcon open={collapse.open} variant="expand" size={16} />
            </IconButton>
          </span>
        ) : inTree ? <span className="section-head-toggle-spacer" aria-hidden /> : undefined
      }
      title={
        <>
          {s.status === "done" && <span className="section-done-check" aria-hidden>✓ </span>}
          {s.sectionNo && <span className="muted">{s.sectionNo} </span>}
          {renaming ? (
            <input
              className="section-rename-input"
              aria-label={`Rename ${s.title}`}
              defaultValue={s.title}
              autoFocus
              onFocus={() => {
                cancelled.current = false;
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
              onKeyUp={(e) => e.stopPropagation()}
              onBlur={(e) => finishRename(e.currentTarget.value)}
            />
          ) : (
            s.title
          )}
        </>
      }
      badge={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
      status={
        <StatusSelect
          value={s.status}
          statuses={REPORT_STATUSES}
          disabled={readOnly}
          onChange={(st) => onStatusChange?.(st)}
          label={`Status for ${s.title}`}
        />
      }
      meta={meta}
      menu={
        <EntityCardMenu
          resourceType="report_section"
          resourceId={s.id}
          title={`Share: ${s.title}`}
          name={s.title}
          onDelete={isPinned ? onUnpin : (readOnly || !onRemove ? undefined : onRemove)}
          deleteLabel={isPinned ? "Remove from report" : "Delete section"}
          deleteDisabled={busy}
          extraItems={extraItems}
        />
      }
    >
      {progress !== null && (
        <div className="progress-bar section-item-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {hasNotes ? (
        <div className="section-note-md-preview">
          <Markdown className="summary">{sectionCardPreviewMd(s.notes!)}</Markdown>
        </div>
      ) : null}
    </EntityCard>
  );
}
