"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { desktop, type DesktopMenuGroup, type DesktopMenuItem } from "@/lib/desktop/desktop-bridge";
import { openSearchPalette } from "./jump-to-palette";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { WeaveForgeLogo } from "./weave-forge-logo";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { MenuItemButton } from "./controls";

/**
 * Set on `<html>` before the first paint by the layout's boot script, so the
 * page is laid out under the bar from the start rather than jumping down once
 * this component mounts. `--titlebar-h` in base.css reads it.
 */
export const TITLE_BAR_BOOT_SCRIPT = `try{var w=window.weaveforge;if(w&&w.platform!=="darwin"&&typeof w.menuModel==="function")document.documentElement.setAttribute("data-titlebar","")}catch(e){}`;

/**
 * The shell's menu shortcuts (Ctrl+,) ask the page through this; see `routeTo`.
 * Same string as `PAGE_COMMAND_EVENT` in apps/desktop/src/app-menu.ts, checked
 * by apps/desktop/test/app-menu.test.ts.
 */
const MENU_COMMAND_EVENT = "weaveforge:menu-command";

function runCommand(command: string): void {
  if (command === "search") openSearchPalette();
}

/** Whether `route` is the page open now (`/papers/` is `/papers`). */
function isHere(pathname: string | null, route: string): boolean {
  return (pathname ?? "").replace(/\/+$/, "") === route.replace(/\/+$/, "");
}

/** `rgb(16, 16, 20)` → `#101014`, which is all the shell accepts. */
function toHex(colour: string): string | null {
  const parts = colour.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return null;
  return `#${parts
    .slice(0, 3)
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The desktop window's title bar, on Windows and Linux.
 *
 * The window has no system title bar there (`titleBarStyle: "hidden"` in the
 * shell), so this draws one: the app's mark, the menu in the app's own style,
 * and empty space the window can be dragged by. The minimise, maximise and
 * close buttons are the system's, drawn over the right-hand end; the bar leaves
 * them their room through the `titlebar-area-*` environment variables and asks
 * the shell to tint them to the theme.
 *
 * The menu itself lives in the shell — its shortcuts work with this closed —
 * and this is a picture of it. An entry that only opens a route navigates with
 * the router rather than through the shell, which reloaded the page to get
 * there.
 *
 * Renders nothing in a browser, on macOS, and in a shell that predates it.
 */
export function DesktopTitleBar() {
  const [groups, setGroups] = useState<DesktopMenuGroup[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<number>(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // The picture of the menu, fetched again whenever the shell says it changed
  // (a workspace folder chosen, the window maximised).
  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.menuModel) return;
    let live = true;
    const load = () =>
      void bridge
        .menuModel?.()
        .then((model) => {
          if (!live) return;
          setGroups(model);
          // The boot script guessed; the shell has the last word.
          if (model) document.documentElement.setAttribute("data-titlebar", "");
          else document.documentElement.removeAttribute("data-titlebar");
        })
        .catch((error: unknown) =>
          logToApp({
            level: "warn",
            source: "title-bar",
            message: "The window menu could not be loaded",
            detail: describeRejection(error),
          }),
        );
    load();
    const stop = bridge.onMenuChange?.(load);
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  // A shortcut pressed with the menu closed arrives from the shell as an event.
  // Taken here so it moves through the router instead of reloading the page.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: unknown; command?: unknown }>).detail;
      if (typeof detail?.route === "string") {
        event.preventDefault();
        router.push(detail.route);
      } else if (typeof detail?.command === "string") runCommand(detail.command);
    };
    window.addEventListener(MENU_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(MENU_COMMAND_EVENT, onCommand);
  }, [router]);

  // The system's window buttons, in the bar's own colours.
  useEffect(() => {
    const bridge = desktop();
    if (!groups || !bridge?.setTitleBarColors) return;
    const tint = () => {
      const bar = barRef.current;
      if (!bar) return;
      const style = getComputedStyle(bar);
      const background = toHex(style.backgroundColor);
      const ink = toHex(style.color);
      if (background && ink) bridge.setTitleBarColors?.({ background, ink });
    };
    // After the theme's variables have landed on the root.
    const later = () => requestAnimationFrame(tint);
    later();
    window.addEventListener(THEME_CHANGE_EVENT, later);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, later);
  }, [groups, pathname]);

  const close = useCallback(() => {
    setOpen(null);
    setActive(-1);
  }, []);

  const run = useCallback(
    (item: DesktopMenuItem) => {
      if (item.kind === "separator" || !item.enabled) return;
      close();
      if (item.route) {
        router.push(item.route);
        return;
      }
      if (item.command) {
        runCommand(item.command);
        return;
      }
      void desktop()
        ?.invokeMenuItem?.(item.id)
        .catch((error: unknown) =>
          logToApp({
            level: "warn",
            source: "title-bar",
            message: "A window menu entry failed",
            detail: `${item.id}: ${describeRejection(error)}`,
          }),
        );
    },
    [close, router],
  );

  // Keep the open menu inside the window: slide left at the right edge, scroll when short.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const group = panel?.parentElement;
    if (!panel || !group) return;
    const fit = () => {
      const at = group.getBoundingClientRect();
      const room = window.innerWidth - 8 - at.left - panel.offsetWidth;
      panel.style.left = `${Math.max(8 - at.left, Math.min(0, room))}px`;
      panel.style.maxHeight = `${Math.max(120, window.innerHeight - at.bottom - 8)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

  // Outside click and Esc close; arrows walk the menu the way a system one does.
  useEffect(() => {
    if (open === null || !groups) return;
    const items = groups[open]?.items ?? [];
    const step = (from: number, by: number) => {
      for (let i = 1; i <= items.length; i += 1) {
        const next = (from + by * i + items.length * i) % items.length;
        const item = items[next];
        if (item && item.kind !== "separator" && item.enabled) return next;
      }
      return from;
    };
    const onDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowDown") setActive((at) => step(at, 1));
      else if (event.key === "ArrowUp") setActive((at) => step(at < 0 ? 0 : at, -1));
      else if (event.key === "ArrowRight") {
        setOpen((at) => ((at ?? 0) + 1) % groups.length);
        setActive(-1);
      } else if (event.key === "ArrowLeft") {
        setOpen((at) => ((at ?? 0) - 1 + groups.length) % groups.length);
        setActive(-1);
      } else if (event.key === "Enter" && active >= 0 && items[active]) run(items[active]);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onBlur = () => close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, active, groups, close, run]);

  // Alt on its own opens the first menu, as it does in a Windows app.
  useEffect(() => {
    if (!groups) return;
    let alone = false;
    const onDown = (event: KeyboardEvent) => {
      alone = event.key === "Alt" && !event.repeat;
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !alone) return;
      alone = false;
      event.preventDefault();
      setActive(-1);
      setOpen((at) => (at === null ? 0 : null));
    };
    const onOther = () => {
      alone = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("pointerdown", onOther);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("pointerdown", onOther);
    };
  }, [groups]);

  if (!groups) return null;

  return (
    <div
      ref={barRef}
      className="title-bar"
      // Pressing a menu must not take focus from the page: Cut, Copy and Paste
      // act on whatever is focused, and that has to still be the editor.
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="title-bar-mark" aria-hidden="true">
        <WeaveForgeLogo />
      </span>
      <nav className="title-bar-menus" aria-label="Application menu" role="menubar">
        {groups.map((group, index) => (
          <div key={group.label} className="title-bar-group">
            <MenuItemButton
              aria-haspopup="menu"
              aria-expanded={open === index}
              onClick={() => {
                setActive(-1);
                setOpen((at) => (at === index ? null : index));
              }}
              onPointerEnter={() => {
                if (open !== null && open !== index) {
                  setActive(-1);
                  setOpen(index);
                }
              }}
            >
              {group.label}
            </MenuItemButton>
            {open === index ? (
              <div ref={panelRef} className="popover-panel title-bar-menu" role="menu" aria-label={group.label}>
                <ul className="card-menu-list">
                  {group.items.map((item, at) =>
                    item.kind === "separator" ? (
                      <li key={item.id} role="separator" className="title-bar-sep" />
                    ) : (
                      <li key={item.id}>
                        <MenuItemButton kind={item.kind === "check" ? "checkbox" : "item"} checked={item.checked === true}
                          disabled={!item.enabled}
                          aria-current={item.route && isHere(pathname, item.route) ? "page" : undefined}
                          data-highlighted={at === active || undefined}
                          onPointerEnter={() => setActive(at)}
                          onClick={() => run(item)}
                        >
                          <span className="title-bar-item-label">{item.label}</span>
                          {item.accelerator ? <kbd className="title-bar-kbd">{item.accelerator}</kbd> : null}
                        </MenuItemButton>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </div>
  );
}
