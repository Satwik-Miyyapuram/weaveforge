"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import "@/app/pitch/looks.css";
import s from "@/app/pitch/scrolly.module.css";
import { APP_URL, REPO_URL } from "@/app/pitch/links";
import { BrandMark, GitHubMark, ThemePicker, themeAttrs, useSiteTheme } from "@/app/pitch/site-chrome";

/**
 * The docs' page and header: the pitch's own header, with the same looks and
 * the same stored theme. The docs are the same site, and a reader who follows
 * "Docs" from the pitch should not land somewhere that looks like a different
 * product, or lose the theme they picked there.
 *
 * A client component only for the theme; the layout that renders the nav and
 * the pages inside it stays a server component.
 */
export function DocsFrame({ children }: { children: ReactNode }) {
  const [theme, pickTheme] = useSiteTheme();

  return (
    <div className="wf-looks docs-page" {...themeAttrs(theme)}>
      <header className={s.top}>
        <div className={s["top-in"]}>
          <Link href="/" className={s.brand}>
            <span className={s.logo}><BrandMark /></span>WeaveForge
          </Link>
          <div className={s["top-end"]}>
            <Link href="/docs/" className={s["top-link"]} aria-current="page">Docs</Link>
            <a className={s["icon-btn"]} href={REPO_URL} aria-label="WeaveForge on GitHub" title="GitHub">
              <GitHubMark />
            </a>
            <ThemePicker theme={theme} onPick={pickTheme} />
            <a className={`${s.btn} ${s["btn-primary"]} ${s["top-cta"]}`} href={APP_URL}>Open the app</a>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
