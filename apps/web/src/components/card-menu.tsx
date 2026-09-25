"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "./popover";

export interface CardMenuItem {
  id: string;
  label: string;
  /** Destructive: drawn in the danger colour, and the reason the menu exists. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /**
   * A panel that opens beside this row instead of an action. Selecting the row
   * opens the submenu rather than closing the menu: filing is a second step, not
   * a choice, and the lists belong next to the item they file.
   */
  submenu?: () => ReactNode;
}

/**
 * The card's overflow menu.
 *
 * The foot of an entity card carried three separate controls — a delete icon, a
 * share button and an open icon — on every card in a grid, beside the status
 * select. Two of those are occasional and one is destructive, and a grid of
 * forty cards was forty delete buttons one stray tap from a deletion. They sit
 * behind a single kebab now; the card itself is the open affordance, which it
 * already was (`EntityCard` is `role="button"` with the activation handler).
 *
 * Built on `Popover`, which owns placement, Esc, outside-click, focus entry and
 * focus return. A second implementation of those is how two menus in one app
 * start behaving differently.
 */
export function CardMenu({
  items,
  label = "More actions",
}: {
  items: CardMenuItem[];
  label?: string;
}) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <Popover
      align="right"
      iconOnly
      // Portalled: a card animates on hover, which makes it a containing block
      // for `position: fixed`, and the panel would otherwise open pinned to the
      // card rather than under the kebab that was pressed. See `Popover.portal`.
      portal
      ariaLabel={label}
      triggerClassName="entity-icon-btn card-menu-trigger"
      label={<KebabIcon />}
    >
      {(close) => (
        <ul className="card-menu-list">
          {items.map((item) => (
            <li key={item.id} className={item.submenu ? "card-menu-row" : undefined}>
              <button
                type="button"
                className={`card-menu-item${item.danger ? " danger" : ""}`}
                disabled={item.disabled}
                aria-haspopup={item.submenu ? "menu" : undefined}
                aria-expanded={item.submenu ? openSub === item.id : undefined}
                onClick={() => {
                  if (item.submenu) {
                    setOpenSub((prev) => (prev === item.id ? null : item.id));
                    return;
                  }
                  // Close first: Share opens a dialog above the screen, and the
                  // menu must not be left open underneath it.
                  close();
                  item.onSelect();
                }}
              >
                {item.label}
                {item.submenu && (
                  <span className="card-menu-more" aria-hidden="true">
                    ›
                  </span>
                )}
              </button>
              {item.submenu && openSub === item.id && (
                <div className="card-menu-flyout card">{item.submenu()}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/** Three dots, vertical — the conventional "more" affordance. */
function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}