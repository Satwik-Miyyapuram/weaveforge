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

/** Sends the theme's colours to the desktop plan widget, so it matches the app. Renders nothing. */
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
      probe.remove();
      bridge.setPlanWidgetTheme?.(palette);
    };
    // After the theme's variables have landed on the root.
    const later = () => requestAnimationFrame(send);
    later();
    window.addEventListener(THEME_CHANGE_EVENT, later);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, later);
  }, []);
  return null;
}
