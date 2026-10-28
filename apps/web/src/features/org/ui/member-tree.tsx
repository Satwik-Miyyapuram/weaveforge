"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ROLE_RANK, memberRoleLabel, type Member } from "@weaveforge/core";

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
