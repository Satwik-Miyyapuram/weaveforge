"use client";

import { useEffect } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

/** Widget variable -> the theme variable it wears. */
const PALETTE: Record<string, string> = {
  bg: "--surface",
  well: "--surface2",
  line: "--border",
  text: "--text",
  muted: "--muted",
  accent: "--accent",
  "accent-ink": "--accent-fg",
  late: "--st-danger-bg",
  "late-ink": "--st-danger-fg",
  soon: "--st-warn-bg",
  "soon-ink": "--st-warn-fg",
};

/** Paints `colour` over the page background and reads the pixel back, so any CSS colour syntax lands as `#rrggbb`. */
function toHex(ctx: CanvasRenderingContext2D, background: string, colour: string): string {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return `#${Array.from(pixel.slice(0, 3), (part) => part.toString(16).padStart(2, "0")).join("")}`;
}

type Computed = Pick<CSSStyleDeclaration, "borderTopWidth" | "borderTopLeftRadius" | "boxShadow" | "fontFamily" | "fontSize">;

/**
 * The theme's shape, by the widget variable each one sets (design D-27): what a
 * card and a small control actually draw, the page font, and the body and
 * small text sizes. Read off real elements, so a Flat theme sends no shadow and
 * Poster sends its hard one.
 */
export function widgetShape(probe: { card: Computed; control: Computed; page: Computed; text: Computed; small: Computed }) {
  return {
    radius: probe.card.borderTopLeftRadius,
    "radius-sm": probe.control.borderTopLeftRadius,
    bw: probe.card.borderTopWidth,
    sh: probe.card.boxShadow,
    "sh-sm": probe.control.boxShadow,
    font: probe.page.fontFamily,
    fs: probe.text.fontSize,
    "fs-sm": probe.small.fontSize,
  };
}

/** Sends the theme's colours and shape to the desktop plan widget, so it matches the app. Renders nothing. */
export function PlanWidgetTheme() {
  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.setPlanWidgetTheme) return;
    const send = () => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (!ctx) return probe.remove();
      probe.style.color = "var(--surface)";
      const background = getComputedStyle(probe).color;
      const palette: Record<string, string> = {};
      for (const [key, variable] of Object.entries(PALETTE)) {
        probe.style.color = `var(${variable})`;
        palette[key] = toHex(ctx, background, getComputedStyle(probe).color);
      }
      // A card and a small control, as the theme draws them; text sizes by role
      // rather than off the control, whose size changes with its font in CRT.
      const card = document.createElement("div");
      card.className = "card";
      const control = document.createElement("span");
      control.className = "btn-secondary btn-sm";
      const small = document.createElement("span");
      small.style.fontSize = "var(--fs-xs)";
      probe.style.fontSize = "var(--fs)";
      document.body.append(card, control, small);
      const read = getComputedStyle;
      bridge.setPlanWidgetTheme?.({ ...palette, ...widgetShape({
        card: read(card), control: read(control), page: read(document.body), text: read(probe), small: read(small),
      }) });
      for (const el of [probe, card, control, small]) el.remove();
    };
    // After the theme's variables have landed on the root. One frame at a
    // time, cancelled on unmount so no probe runs on a page that has left.
    let frame: number | null = null;
    const later = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        send();
      });
    };
    later();
    window.addEventListener(THEME_CHANGE_EVENT, later);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener(THEME_CHANGE_EVENT, later);
    };
  }, []);
  return null;
}
