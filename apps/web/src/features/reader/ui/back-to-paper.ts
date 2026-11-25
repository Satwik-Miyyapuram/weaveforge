/** True when `url` is the page of paper `paperId` (`/papers?paper=<id>`, other params allowed). */
export function isPaperPage(url: string | undefined, paperId: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/papers" && parsed.searchParams.get("paper") === paperId;
  } catch {
    return false;
  }
}

type NavigationEntries = { currentEntry: { index: number } | null; entries(): { url: string | null }[] };

/**
 * Back from the reader to its paper. When the entry before the reader is that paper's page, go back
 * to it, so the paper's own back then reaches the list; pushing the paper again made back loop
 * paper → reader → paper. Otherwise (deep link) replace the reader with the paper page.
 */
export function backToPaper(router: { back(): void; replace(href: string): void }, paperId: string): void {
  const nav = (window as { navigation?: NavigationEntries }).navigation;
  const index = nav?.currentEntry?.index ?? 0;
  const previous = index > 0 ? (nav?.entries()[index - 1]?.url ?? undefined) : undefined;
  if (isPaperPage(previous, paperId)) router.back();
  else router.replace(`/papers?paper=${encodeURIComponent(paperId)}`);
}
