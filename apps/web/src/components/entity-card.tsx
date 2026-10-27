"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { tagTone } from "@/lib/tag-tone";
import { Button } from "./button";
import { Chip } from "./controls";

/**
 * Shared entity list card chrome — papers, report sections, notes, experiments,
 * milestones. Fill slots; don't fork the layout per screen.
 *
 * Layout: [leading?] title ……… badge · status · actions · menu
 *         meta
 *         tags / body
 * The controls float top-right and the title's text wraps around them, so a
 * long title uses the full width below the controls (D09, E42).
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

  // The card is a click surface, not a button: keyboard and screen readers reach
  // the title button, which opens it the same way.
  return (
    <Tag
      id={id}
      className={shell}
      data-status={tone}
      data-tag-tone={tintTag ? tagTone(tintTag) : undefined}
      role={interactive ? "presentation" : undefined}
      onClick={onActivate}
    >
      <div className="entity-card-head">
        {leading != null && <div className="entity-card-lead">{leading}</div>}
        {/* Before the title: a float only wraps text that comes after it. */}
        {hasControls && (
          <div className={menu ? "entity-card-controls entity-card-controls--menu" : "entity-card-controls"} onClick={stop} onKeyDown={stop}>
            {badge}
            {status != null && <div className="entity-card-status">{status}</div>}
            {actions}
            {menu}
          </div>
        )}
        <h3 className="entity-card-title">
          {onActivate ? <Button variant="link" onClick={(e) => { stop(e); onActivate(); }}>{title}</Button> : title}
        </h3>
      </div>

      {hasMeta && <p className="entity-card-meta">{meta}</p>}

      {tags && tags.length > 0 && (
        // A heavily tagged entity would otherwise wrap to three rows and push
        // the body off-screen on a phone. A few tags, then a count.
        <div className="tag-chips chip-row--capped">
          {tags.slice(0, MAX_CARD_TAGS).map((t) => (
            <Chip key={t} title={`#${t}`}>
              #{t}
            </Chip>
          ))}
          {tags.length > MAX_CARD_TAGS && (
            <span className="chip-more">+{tags.length - MAX_CARD_TAGS}</span>
          )}
        </div>
      )}

      {children}
    </Tag>
  );
}
