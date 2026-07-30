"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { DeleteIcon, OpenIcon } from "@/components/view-icons";

/**
 * Shared entity list card chrome — papers, report sections, notes, experiments,
 * milestones. Fill slots; don't fork the layout per screen.
 *
 * Layout: [leading?] title          (full width)
 *         meta
 *         tags / body
 *         delete ……… status · actions · open
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
  status,
  meta,
  tags,
  children,
  onDelete,
  deleteDisabled = false,
  deleteAriaLabel = "Delete",
  actions,
  onOpen,
  openLabel = "Open",
}: {
  as?: "div" | "li";
  id?: string;
  className?: string;
  nested?: boolean;
  onActivate?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  tags?: string[];
  children?: ReactNode;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteAriaLabel?: string;
  actions?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
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

  const showFoot = Boolean(onDelete || status || actions || onOpen);

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
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="entity-card-head">
        {leading}
        <h3 className="entity-card-title">{title}</h3>
      </div>

      {meta != null && meta !== "" && <p className="entity-card-meta">{meta}</p>}

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

      {showFoot && (
        <div className="card-foot entity-card-foot" onClick={stop} onKeyDown={stop}>
          {onDelete ? (
            <button
              type="button"
              className="entity-icon-btn danger card-del"
              onClick={onDelete}
              disabled={deleteDisabled}
              aria-label={deleteAriaLabel}
              title={deleteAriaLabel}
            >
              <DeleteIcon />
            </button>
          ) : (
            <span />
          )}
          <div className="card-foot-right">
            {status != null && (
              <div className="entity-card-status">{status}</div>
            )}
            {actions}
            {onOpen && (
              <button
                type="button"
                className="entity-icon-btn entity-open-icon"
                onClick={onOpen}
                aria-label={openLabel}
                title={openLabel}
              >
                <OpenIcon />
              </button>
            )}
          </div>
        </div>
      )}
    </Tag>
  );
}
