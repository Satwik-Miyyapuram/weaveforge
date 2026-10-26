"use client";

import { useTheme } from "@/lib/hooks/use-theme";

/**
 * Light/dark theme toggle. Persists the choice in localStorage and flips
 * `data-theme` on <html>; the no-flash script in layout.tsx applies the stored
 * (or system) preference before paint so the initial render matches.
 */
export function ThemeToggle() {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      className="header-link theme-toggle"
      onClick={toggle}
      title={dark ? "Switch to light" : "Switch to dark"}
      aria-label={`Theme: ${dark ? "Dark" : "Light"}`}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      {/* The setting and its value, like a settings row (DA-97). The old label
          read as either the state or what a click would do. */}
      <span>Theme</span>
      <span className="menu-row-value">{dark ? "Dark" : "Light"}</span>
    </button>
  );
}
