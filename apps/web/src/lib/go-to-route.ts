/**
 * Go to an app route. A route with a `#hash` on the page already open only
 * changes the hash, since a router push there fires no `hashchange` and the
 * page (Settings picks its tab by hash) would not notice.
 */
export function goToRoute(
  route: string,
  push: (route: string) => void,
  location: Pick<Location, "pathname" | "hash"> = window.location,
): void {
  const at = route.indexOf("#");
  const path = at < 0 ? route : route.slice(0, at);
  if (at >= 0 && location.pathname.replace(/\/$/, "") === path) {
    location.hash = route.slice(at + 1);
    return;
  }
  push(route);
}
