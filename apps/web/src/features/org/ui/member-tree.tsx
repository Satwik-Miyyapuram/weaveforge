"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { ROLE_LABELS, ROLE_RANK, memberRoleLabel, type Member } from "@weaveforge/core";

/** A member plus the people who report (transitively) to them. */
export interface MemberNode {
  member: Member;
  children: MemberNode[];
}

/** Display name for a member, with sensible fallbacks. */
function memberLabel(m: Member): string {
  return m.fullName || m.email || m.id;
}

/**
 * Build a forest from a flat member list using `supervisorId`. Anyone whose
 * supervisor isn't present in the list becomes a root, so the function works
 * whether or not the caller includes the top of the tree. Nodes are ordered by
 * role rank (senior first) then name, recursively.
 */
function buildMemberForest(members: Member[]): MemberNode[] {
  const byId = new Map<string, MemberNode>();
  for (const m of members) byId.set(m.id, { member: m, children: [] });

  const roots: MemberNode[] = [];
  for (const node of byId.values()) {
    const sup = node.member.supervisorId;
    const parent = sup ? byId.get(sup) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: MemberNode[]) => {
    nodes.sort(
      (a, b) =>
        ROLE_RANK[b.member.role] - ROLE_RANK[a.member.role] ||
        memberLabel(a.member).localeCompare(memberLabel(b.member)),
    );
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Every id in the forest — handy for "expand all" defaults. */
function collectIds(forest: MemberNode[], into: Set<string> = new Set()): Set<string> {
  for (const n of forest) {
    into.add(n.member.id);
    collectIds(n.children, into);
  }
  return into;
}

interface TreeProps {
  forest: MemberNode[];
  /** When set, rows are buttons and the chosen id is highlighted. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Marks the current user with a "(you)" tag. */
  meId?: string;
  /** When false, non-lab members show as Standalone. */
  inLab?: boolean;
}

/**
 * A file-tree-style rendering of a member forest: indented, with collapsible
 * parents. Used both as a static org chart and inside the supervisor picker.
 */
function MemberTree({ forest, selectedId, onSelect, meId, inLab = true }: TreeProps) {
  const allIds = useMemo(() => collectIds(forest), [forest]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNodes = (nodes: MemberNode[]) => (
    <ul className="member-tree-list">
      {nodes.map((n) => {
        const hasKids = n.children.length > 0;
        const isCollapsed = collapsed.has(n.member.id);
        const isSel = selectedId === n.member.id;
        return (
          <li key={n.member.id}>
            <div className={`member-tree-row${isSel ? " sel" : ""}`}>
              {hasKids ? (
                <button
                  type="button"
                  className="member-tree-toggle"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? "Expand" : "Collapse"}
                  onClick={() => toggle(n.member.id)}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className="member-tree-toggle-spacer" aria-hidden />
              )}

              {onSelect ? (
                <button
                  type="button"
                  className="member-tree-name as-button"
                  onClick={() => onSelect(n.member.id)}
                >
                  <span className="member-tree-title">
                    {memberLabel(n.member)}
                    {n.member.id === meId && " (you)"}
                  </span>
                  <span className="muted member-tree-role">
                    {memberRoleLabel(n.member, { inLab })}
                  </span>
                </button>
              ) : (
                <span className="member-tree-name">
                  <span className="member-tree-title">
                    {memberLabel(n.member)}
                    {n.member.id === meId && " (you)"}
                  </span>
                  <span className="muted member-tree-role">
                    {memberRoleLabel(n.member, { inLab })}
                  </span>
                </span>
              )}
            </div>
            {hasKids && !isCollapsed && renderNodes(n.children)}
          </li>
        );
      })}
    </ul>
  );

  if (forest.length === 0) return null;
  return <div className="member-tree">{renderNodes(forest)}</div>;
}

/**
 * A top-down org chart: each person is a node box, connected to the people they
 * supervise by lines (a real tree graph, not an indented list). Scrolls
 * horizontally when the tree is wide.
 */
export function OrgChart({
  members,
  meId,
  inLab = true,
}: {
  members: Member[];
  meId?: string;
  inLab?: boolean;
}) {
  const forest = useMemo(() => buildMemberForest(members), [members]);
  const chartRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const chart = chartRef.current;
    const tree = treeRef.current;
    if (!chart || !tree) return;

    const sync = () => {
      // Small tolerance avoids sub-pixel false positives on Windows.
      setScrollable(tree.scrollWidth > chart.clientWidth + 2);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(chart);
    ro.observe(tree);
    return () => ro.disconnect();
  }, [forest]);

  if (forest.length === 0) return null;

  const renderNodes = (nodes: MemberNode[]) => (
    <ul>
      {nodes.map((n) => (
        <li key={n.member.id}>
          <div className={`org-node${n.member.id === meId ? " me" : ""}`}>
            <span className="org-node-name">
              {memberLabel(n.member)}
              {n.member.id === meId && " (you)"}
            </span>
            <span className="org-node-role muted">{memberRoleLabel(n.member, { inLab })}</span>
          </div>
          {n.children.length > 0 && renderNodes(n.children)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`org-chart${scrollable ? " org-chart--scroll" : ""}`} ref={chartRef}>
      <div className="org-tree" ref={treeRef}>{renderNodes(forest)}</div>
    </div>
  );
}

interface SelectProps {
  members: Member[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  meId?: string;
  placeholder?: string;
}

/**
 * A dropdown whose menu is a {@link MemberTree} — pick a person to view by
 * navigating the hierarchy, like choosing a file in a file tree.
 */
export function MemberTreeSelect({ members, selectedId, onSelect, meId, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const forest = useMemo(() => buildMemberForest(members), [members]);
  const selected = members.find((m) => m.id === selectedId) ?? null;

  useDismissOnOutside(open, () => setOpen(false), ref);

  return (
    <div className="member-tree-select" ref={ref}>
      <button
        type="button"
        className="member-tree-trigger"
        aria-haspopup="tree"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="member-tree-trigger-label">
          {selected ? memberLabel(selected) : placeholder || "Select a person"}
        </span>
        <span className="member-tree-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="member-tree-menu card">
          <MemberTree
            forest={forest}
            selectedId={selectedId}
            meId={meId}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
