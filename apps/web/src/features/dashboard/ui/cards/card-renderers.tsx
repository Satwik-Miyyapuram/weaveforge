"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { DashboardCardType, DashboardLayoutItem, Member } from "@thesis/core";
import { Select } from "@/components/select";
import { ScreenLoader } from "@/components/thesis-loader";
import type { DashboardStats } from "../../application/build-dashboard-stats";
import type { SupervisionStats } from "../../application/build-supervision-stats";
import { isStatCard } from "../../application/card-registry";

export interface CardRenderProps {
  stats: DashboardStats;
  supervision: SupervisionStats | null;
  item: DashboardLayoutItem;
  supervisees: Member[];
  onSuperviseeConfig?: (memberId: string) => void;
  contentReady?: boolean;
}

function ProgressTile({
  done,
  total,
  pct,
  href,
  short,
  animateProgress,
}: {
  done: number;
  total: number;
  pct: number;
  href: string;
  short?: boolean;
  animateProgress?: boolean;
}) {
  const [barWidth, setBarWidth] = useState(animateProgress ? 0 : pct);
  useEffect(() => {
    if (!animateProgress) {
      setBarWidth(pct);
      return;
    }
    setBarWidth(0);
    const id = requestAnimationFrame(() => setBarWidth(pct));
    return () => cancelAnimationFrame(id);
  }, [animateProgress, pct]);

  return (
    <Link href={href} className="dashboard-stat-link">
      <div className="dashboard-stat-row">
        <span className="dashboard-stat-count">
          {done} / {total}
        </span>
        <strong className="dashboard-stat-pct">{pct}%</strong>
      </div>
      {!short && (
        <div className="progress-bar dashboard-stat-bar" aria-hidden>
          <span style={{ width: `${barWidth}%` }} />
        </div>
      )}
    </Link>
  );
}

function listItemLimit(height: number): number {
  return Math.max(1, height - 1);
}

function AttentionList({
  items,
  limit,
}: {
  items: DashboardStats["attention"];
  limit: number;
}) {
  const visible = items.slice(0, limit);
  const hidden = items.length - visible.length;
  return (
    <ul className="dashboard-list">
      {visible.map((a) => (
        <li key={`${a.href}:${a.label}`}>
          <Link href={a.href} className="dashboard-list-row">
            <span>{a.label}</span>
            <span className="dashboard-list-arrow" aria-hidden>→</span>
          </Link>
        </li>
      ))}
      {hidden > 0 && (
        <li className="muted dashboard-list-more">+{hidden} more</li>
      )}
    </ul>
  );
}

type CardRenderer = (props: CardRenderProps) => ReactNode;

/** OCP: new cards register one renderer entry + one CardDef. */
const CARD_RENDERERS: Record<DashboardCardType, CardRenderer> = {
  "reading-progress": ({ stats, item, contentReady }) => (
    <ProgressTile
      done={stats.reading.done}
      total={stats.reading.total}
      pct={stats.reading.pct}
      href="/papers"
      short={item.h < 2}
      animateProgress={contentReady}
    />
  ),
  "report-progress": ({ stats, item, contentReady }) => (
    <ProgressTile
      done={stats.report.done}
      total={stats.report.total}
      pct={stats.report.pct}
      href="/report"
      short={item.h < 2}
      animateProgress={contentReady}
    />
  ),
  "plan-progress": ({ stats, item, contentReady }) => (
    <ProgressTile
      done={stats.plan.done}
      total={stats.plan.total}
      pct={stats.plan.pct}
      href="/plan"
      short={item.h < 2}
      animateProgress={contentReady}
    />
  ),
  "experiments-summary": ({ stats, item }) => (
    <Link href="/experiments" className="dashboard-stat-link">
      <div className="dashboard-stat-row">
        <span className="dashboard-stat-count">
          {stats.experiments.running} running
        </span>
        <strong className="dashboard-stat-pct">{stats.experiments.done}</strong>
      </div>
      {item.h >= 2 && (
        <span className="dashboard-stat-caption dashboard-stat-footer">
          experiments done
        </span>
      )}
    </Link>
  ),
  "needs-attention": ({ stats, item }) =>
    stats.attention.length === 0 ? (
      <p className="muted dashboard-card-empty">Nothing needs attention.</p>
    ) : (
      <AttentionList items={stats.attention} limit={listItemLimit(item.h)} />
    ),
  "recent-log": ({ stats, item }) =>
    stats.recentLog.length === 0 ? (
      <p className="muted dashboard-card-empty">No log entries yet.</p>
    ) : (
      <ul className="dashboard-list">
        {stats.recentLog.slice(0, listItemLimit(item.h)).map((e) => (
          <li key={e.id}>
            <Link href={e.href} className="dashboard-list-row dashboard-log-row">
              <span className="dashboard-log-date">{e.date}</span>
              <span className="dashboard-log-preview">{e.preview}</span>
            </Link>
          </li>
        ))}
      </ul>
    ),
  "library-snapshot": ({ stats }) => (
    <Link href={stats.library.href} className="dashboard-stat-link">
      <div className="dashboard-stat-pct dashboard-stat-pct--solo">
        {stats.library.papers}
      </div>
      <span className="dashboard-stat-caption dashboard-stat-footer">
        papers · {stats.library.edges} edges · {stats.library.lists} lists
      </span>
    </Link>
  ),
  "top-tags": ({ stats, item }) =>
    stats.topTags.length === 0 ? (
      <p className="muted dashboard-card-empty">No tags yet.</p>
    ) : (
      <ul className="dashboard-list">
        {stats.topTags.slice(0, listItemLimit(item.h)).map((t) => (
          <li key={t.name}>
            <Link href="/graph" className="dashboard-list-row">
              <span>{t.name}</span>
              <span className="muted">{t.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    ),
  "team-roster": ({ supervision }) =>
    !supervision || supervision.roster.length === 0 ? (
      <p className="muted dashboard-card-empty">Nobody to supervise.</p>
    ) : (
      <ul className="dashboard-list">
        {supervision.roster.map((s) => (
          <li key={s.member.id}>
            <Link href={`/supervision?member=${s.member.id}`} className="dashboard-list-row">
              <span className="dashboard-roster-name">
                {s.member.fullName || s.member.email}
              </span>
              <span className="muted">{s.statusLabel}</span>
            </Link>
          </li>
        ))}
      </ul>
    ),
  "team-attention": ({ supervision, item }) =>
    !supervision || supervision.teamAttention.length === 0 ? (
      <p className="muted dashboard-card-empty">No team issues.</p>
    ) : (
      <ul className="dashboard-list">
        {supervision.teamAttention.slice(0, listItemLimit(item.h)).map((a) => (
          <li key={`${a.memberId}:${a.label}`}>
            <Link href={a.href} className="dashboard-list-row">
              <span>{a.label}</span>
              <span className="dashboard-list-arrow" aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
    ),
  "supervisee-snapshot": ({ supervision, item, supervisees, onSuperviseeConfig }) => {
    const memberId =
      (item.config?.memberId as string | undefined) ?? supervisees[0]?.id;
    const member = supervisees.find((m) => m.id === memberId);
    const summary = supervision?.roster.find((r) => r.member.id === memberId);
    if (!member || !summary) {
      return <p className="muted dashboard-card-empty">Select a supervisee.</p>;
    }
    return (
      <div className="dashboard-supervisee">
        {supervisees.length > 1 && onSuperviseeConfig ? (
          <div
            className="dashboard-supervisee-select-wrap"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Select
              className="dashboard-supervisee-select"
              value={memberId}
              onChange={(e) => onSuperviseeConfig(e.target.value)}
              aria-label="Select supervisee"
            >
              {supervisees.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName || m.email}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <p className="dashboard-supervisee-name">
            {member.fullName || member.email}
          </p>
        )}
        <p className="dashboard-card-meta">
          Milestones: {summary.milestonesDone}/{summary.milestonesTotal}
        </p>
        {summary.lastLogDate && (
          <p className="muted dashboard-supervisee-meta">Last log: {summary.lastLogDate}</p>
        )}
        <Link
          href={`/supervision?member=${member.id}`}
          className="link-btn dashboard-view-full"
          onClick={(e) => e.stopPropagation()}
        >
          View full →
        </Link>
      </div>
    );
  },
};

export function renderDashboardCard(
  type: DashboardCardType,
  props: CardRenderProps,
): ReactNode {
  const render = CARD_RENDERERS[type];
  if (!render) {
    return <p className="muted dashboard-card-empty">Unknown card type.</p>;
  }
  return render(props);
}

/**
 * Cards fill from one shared stats load, so every card resolves at the same
 * moment. Tips are off and the mark is compact: a grid of cards each rotating
 * its own feature tip would be noise, and the cards are too small for it.
 */
export function DashboardCardSkeleton() {
  return (
    <div className="dashboard-card-skeleton">
      <ScreenLoader status="" showTips={false} compact />
    </div>
  );
}
