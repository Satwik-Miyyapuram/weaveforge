"use client";

import type { ReactNode } from "react";

/**
 * The two empty states, composed rather than one grey sentence.
 *
 * `.empty` used to be all fifteen of them: a centred paragraph in `--muted`,
 * with nothing to click. That conflates two screens that mean opposite things.
 * A first-run empty state is the moment a new user decides whether the product
 * is for them, and it should say what the screen is *for* and offer the action
 * that starts it. A filtered-to-nothing state is a dead end the user created a
 * keystroke ago, and all it needs is the way back.
 *
 * Both variants keep the `.empty` class, so anything positioning them still
 * does, and add a modifier the stylesheet keys on.
 */
export function EmptyState({
  variant,
  body,
  /** First run: the screen's own icon, shown in a tile above the heading. */
  icon,
  /** First run: what this screen is for, in a few words. */
  title,
  /**
   * The action, as a real element rather than a sentence pointing at a toolbar
   * control the user has to go and find. First run: the screen's primary
   * action. No results: "Clear filters".
   */
  action,
}: {
  variant: "first-run" | "no-results";
  body: string;
  icon?: ReactNode;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`empty empty--${variant}`}>
      {variant === "first-run" && icon ? (
        <span className="empty-mark" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {variant === "first-run" && title ? <h3 className="empty-title">{title}</h3> : null}
      <p className="empty-body">{body}</p>
      {action ? <div className="empty-actions">{action}</div> : null}
    </div>
  );
}

/**
 * The "Clear filters" button every filtered-to-nothing state needs.
 *
 * Its own component because the eight sites that use it would otherwise each
 * write the same four lines — and because a screen with more than one filter
 * can clear them all in one call by clearing the state it already owns.
 */
export function ClearFiltersButton({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" className="btn-secondary btn-sm" onClick={onClear}>
      Clear filters
    </button>
  );
}
