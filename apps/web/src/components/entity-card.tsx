"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { tagTone } from "@/lib/tag-tone";

/**
 * Shared entity list card chrome — papers, report sections, notes, experiments,
 * milestones. Fill slots; don't fork the layout per screen.
 *
 * Layout: [leading?] title ……… badge · status · actions · menu
 *         meta
 *         tags / body
 */
const MAX_CARD_TAGS = 3;

export function EntityCard({
  as: Tag = "div",
  id,
  className,
  nested = false,
  onActivate,
  leading,
  title,
  badge,
  status,
  tone,
  meta,
  tags,
  tintTag,
  children,
  actions,
  menu,
}: {
  as?: "div" | "li";
  id?: string;
  className?: string;
  nested?: boolean;
  onActivate?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  /** Who shared it, on a card from someone else. Status still shows, locked. */
  badge?: ReactNode;
  status?: ReactNode;
  /** The status key that colours the card, from the shared map in brutal.css. */
  tone?: string;
  meta?: ReactNode;
  tags?: string[];
  /** Colours a card that has no status by this tag's tone (notes). */
  tintTag?: string;
  children?: ReactNode;
  /** Live controls beside the menu (a comment count). */
  actions?: ReactNode;
  /** The overflow menu: share, delete and the occasional actions. */
  menu?: ReactNode;
}) {
  const interactive = Boolean(onActivate);
  const shell = [
    "card",
    "entity-card",
    nested ? "entity-card--nested" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const hasControls = Boolean(badge != null || status != null || actions || menu);
  const hasMeta = meta != null && meta !== "";

  function stop(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!onActivate) return;
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  }

  return (
    <Tag
      id={id}
      className={shell}
      data-status={tone}
      data-tag-tone={tintTag ? tagTone(tintTag) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="entity-card-head">
        {leading}
        {/* Controls float right so a long title wraps beside them, then runs full width. */}
        <div className="entity-card-heading">
          {hasControls && (
            <div className="entity-card-actions" onClick={stop} onKeyDown={stop}>
              {badge}
              {status != null && <div className="entity-card-status">{status}</div>}
              {actions}
              {menu}
            </div>
          )}
          <h3 className="entity-card-title">{title}</h3>
        </div>
      </div>

      {hasMeta && <p className="entity-card-meta">{meta}</p>}

      {tags && tags.length > 0 && (
        // A heavily tagged entity would otherwise wrap to three rows and push
        // the body off-screen on a phone. One line, then a count.
        <div className="tag-chips chip-row--capped">
          {tags.slice(0, MAX_CARD_TAGS).map((t) => (
            <span key={t} className="tag-chip">
              #{t}
            </span>
          ))}
          {tags.length > MAX_CARD_TAGS && (
            <span className="tag-chip chip-more">+{tags.length - MAX_CARD_TAGS}</span>
          )}
        </div>
      )}

      {children}
    </Tag>
  );
}
