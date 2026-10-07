"use client";

import { Popover } from "./popover";
import { Menu, type MenuItem } from "./menu";

export type CardMenuItem = MenuItem;
export { Menu, SubmenuFlyout, computeSubmenuPosition } from "./menu";

/**
 * The card's overflow menu.
 *
 * Inherits from the common Menu and Submenu architecture (`@/components/menu`).
 * All cards across the app (papers, notes, experiments, logbook, plan, projects,
 * lists, report) share this menu, ensuring single-origin styling, accessibility,
 * and automatic collision-detected submenus.
 *
 * Built on `Popover`, which owns placement, Esc, outside-click, focus entry and
 * focus return.
 */
export function CardMenu({
  items,
  label = "More actions",
}: {
  items: CardMenuItem[];
  label?: string;
}) {
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
      {(close) => <Menu items={items} onClose={close} />}
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