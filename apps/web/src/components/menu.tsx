"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface MenuItem {
  id: string;
  label: ReactNode;
  /** Destructive: drawn in the danger colour. */
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /**
   * A panel or sub-list that opens beside this row instead of closing the menu.
   * Can be either a custom ReactNode render function (e.g. ListPicker) or a
   * nested list of MenuItem objects.
   */
  submenu?: (() => ReactNode) | readonly MenuItem[];
  kind?: "item" | "separator" | "header" | "check";
  checked?: boolean;
  accelerator?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  title?: string;
}

export interface SubmenuPlacement {
  placementX: "left" | "right";
  placementY: "top" | "bottom";
  maxHeight: number;
  maxWidth: number;
}

const VIEWPORT_PAD = 12;
const SUBMENU_GAP = 6;

/**
 * Pure calculation of viewport collision and placement for submenus.
 *
 * Flips horizontally to the left when opening to the right would overflow the
 * viewport's right edge. Flips vertically upwards when opening downwards would
 * overflow the viewport's bottom edge. Clamps max dimensions so the flyout stays
 * within safe viewport bounds with scroll.
 */
export function computeSubmenuPosition(
  anchorRect: { left: number; right: number; top: number; bottom: number; width?: number; height?: number },
  flyoutRect: { width: number; height: number },
  vw: number,
  vh: number,
  gap = SUBMENU_GAP,
  pad = VIEWPORT_PAD,
): SubmenuPlacement {
  const width = flyoutRect.width || 208;
  const height = flyoutRect.height || 100;

  // 1. Horizontal placement
  // Default opens to the right of the anchor: anchorRect.right + gap
  const spaceRight = vw - anchorRect.right - pad;
  const spaceLeft = anchorRect.left - pad;

  let placementX: "left" | "right" = "right";
  if (width + gap > spaceRight) {
    // Overflows right! Flip left if it fits on the left or if left has more room
    if (width + gap <= spaceLeft || spaceLeft > spaceRight) {
      placementX = "left";
    }
  }

  // 2. Vertical placement
  // Default aligns to top of the row: anchorRect.top - 4
  const spaceBelow = vh - (anchorRect.top - 4) - pad;
  const spaceAbove = (anchorRect.bottom + 4) - pad;

  let placementY: "top" | "bottom" = "top";
  if (height > spaceBelow) {
    // Overflows bottom! Flip up if it fits above or if above has more room
    if (height <= spaceAbove || spaceAbove > spaceBelow) {
      placementY = "bottom";
    }
  }

  const availableHeight = placementY === "bottom" ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(120, Math.min(320, Math.floor(availableHeight)));
  const availableWidth = placementX === "left" ? spaceLeft : spaceRight;
  const maxWidth = Math.max(160, Math.floor(availableWidth));

  return {
    placementX,
    placementY,
    maxHeight,
    maxWidth,
  };
}

export interface SubmenuFlyoutProps {
  /** The anchor element (the parent <li> row) used to measure collision bounds. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  gap?: number;
  pad?: number;
  onClose?: () => void;
}

/**
 * Common submenu flyout container with automatic viewport boundary collision detection.
 *
 * Flips left when the right screen edge is near, and flips up when the bottom screen
 * edge is near.
 */
export function SubmenuFlyout({
  anchorRef,
  children,
  className = "",
  style,
  gap = SUBMENU_GAP,
  pad = VIEWPORT_PAD,
}: SubmenuFlyoutProps) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<SubmenuPlacement>({
    placementX: "right",
    placementY: "top",
    maxHeight: 320,
    maxWidth: 320,
  });
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const flyout = flyoutRef.current;
    if (!flyout) return;
    const anchor = anchorRef?.current ?? flyout.parentElement;
    if (!anchor) return;

    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const flyoutRect = flyout.getBoundingClientRect();
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const vh = typeof window !== "undefined" ? window.innerHeight : 768;

      const next = computeSubmenuPosition(anchorRect, flyoutRect, vw, vh, gap, pad);
      setPlacement(next);
      setMeasured(true);
    };

    update();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(flyout);
    ro?.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, gap, pad]);

  const xStyle: CSSProperties =
    placement.placementX === "left"
      ? { left: "auto", right: `calc(100% + ${gap}px)` }
      : { left: `calc(100% + ${gap}px)`, right: "auto" };

  const yStyle: CSSProperties =
    placement.placementY === "bottom"
      ? { top: "auto", bottom: "-4px" }
      : { top: "-4px", bottom: "auto" };

  return (
    <div
      ref={flyoutRef}
      className={`card-menu-flyout menu-flyout card${placement.placementX === "left" ? " flip-x" : ""}${placement.placementY === "bottom" ? " flip-y" : ""}${className ? ` ${className}` : ""}`}
      data-placement-x={placement.placementX}
      data-placement-y={placement.placementY}
      style={{
        ...style,
        ...xStyle,
        ...yStyle,
        maxHeight: `${placement.maxHeight}px`,
        maxWidth: `${placement.maxWidth}px`,
        visibility: measured ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

export interface MenuProps {
  items: readonly MenuItem[];
  className?: string;
  onClose?: () => void;
  /** Controlled active submenu item id */
  openSubmenuId?: string | null;
  onSubmenuChange?: (id: string | null) => void;
  ariaLabel?: string;
}

/**
 * Common Menu object and renderer.
 *
 * All application menus and submenus inherit from or compose this primitive.
 * Any positioning, collision detection or accessibility adjustments stay in
 * this single origin.
 */
export function Menu({
  items,
  className = "",
  onClose,
  openSubmenuId,
  onSubmenuChange,
  ariaLabel,
}: MenuProps) {
  const [internalOpenSub, setInternalOpenSub] = useState<string | null>(null);
  const openSub = openSubmenuId !== undefined ? openSubmenuId : internalOpenSub;
  const setOpenSub = onSubmenuChange ?? setInternalOpenSub;
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      const list = listRef.current;
      if (!list) return;

      const buttons = Array.from(
        list.querySelectorAll<HTMLButtonElement>("li > button.card-menu-item:not(:disabled), li > button.menu-item:not(:disabled)"),
      );
      const activeIndex = buttons.findIndex((b) => b === document.activeElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = activeIndex < buttons.length - 1 ? activeIndex + 1 : 0;
        buttons[next]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = activeIndex > 0 ? activeIndex - 1 : buttons.length - 1;
        buttons[prev]?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (openSub) {
          setOpenSub(null);
        } else {
          onClose?.();
        }
      } else if (e.key === "ArrowLeft") {
        if (openSub) {
          e.preventDefault();
          setOpenSub(null);
        }
      }
    },
    [onClose, openSub, setOpenSub],
  );

  return (
    <ul
      ref={listRef}
      className={`card-menu-list menu-list${className ? ` ${className}` : ""}`}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => (
        <MenuItemRow
          key={item.id}
          item={item}
          isOpen={openSub === item.id}
          onToggleSubmenu={() => setOpenSub(openSub === item.id ? null : item.id)}
          onClose={onClose}
        />
      ))}
    </ul>
  );
}

function MenuItemRow({
  item,
  isOpen,
  onToggleSubmenu,
  onClose,
}: {
  item: MenuItem;
  isOpen: boolean;
  onToggleSubmenu: () => void;
  onClose?: () => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);

  if (item.kind === "separator") {
    return <li key={item.id} role="separator" className="title-bar-sep menu-sep" />;
  }

  const hasSubmenu = Boolean(item.submenu);

  const renderSubmenuContent = () => {
    if (!item.submenu) return null;
    if (typeof item.submenu === "function") {
      return item.submenu();
    }
    if (Array.isArray(item.submenu)) {
      return <Menu items={item.submenu} onClose={onClose} />;
    }
    return null;
  };

  return (
    <li
      ref={rowRef}
      className={`menu-row${hasSubmenu ? " card-menu-row" : ""}`}
      role="none"
    >
      <button
        type="button"
        role={item.kind === "check" ? "menuitemcheckbox" : "menuitem"}
        aria-checked={item.kind === "check" ? item.checked === true : undefined}
        className={`card-menu-item menu-item${item.danger ? " danger" : ""}`}
        disabled={item.disabled}
        title={item.title}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? isOpen : undefined}
        onClick={() => {
          if (hasSubmenu) {
            onToggleSubmenu();
            return;
          }
          onClose?.();
          item.onSelect?.();
        }}
      >
        {item.icon && <span className="menu-item-icon" aria-hidden="true">{item.icon}</span>}
        <span className="menu-item-label">{item.label}</span>
        {item.accelerator && <kbd className="title-bar-kbd menu-kbd">{item.accelerator}</kbd>}
        {item.trailing && <span className="menu-item-trailing">{item.trailing}</span>}
        {hasSubmenu && (
          <span className="card-menu-more menu-more" aria-hidden="true">
            ›
          </span>
        )}
      </button>
      {hasSubmenu && isOpen && (
        <SubmenuFlyout anchorRef={rowRef} onClose={() => onToggleSubmenu()}>
          {renderSubmenuContent()}
        </SubmenuFlyout>
      )}
    </li>
  );
}
