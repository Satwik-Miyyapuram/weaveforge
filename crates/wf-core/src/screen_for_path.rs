//! Screen cache id for a pathname, ported from `apps/web/src/lib/screen-for-path.ts`.
//! Only exact list routes have a screen cache. Detail routes such as
//! `/experiments/:id` have none, because caching one run under the list's key
//! would paint the list instead. Pure.

/// Top-level list routes and the screen cache id each one keeps. The ids match
/// the `SCREEN_IDS` names in `apps/web/src/lib/screens.ts`.
const ROUTE_SCREENS: &[(&str, &str)] = &[
    ("/papers", "papers"),
    ("/notes", "vault"),
    ("/graph", "graph"),
    ("/lists", "lists"),
    ("/experiments", "experiments"),
    ("/plan", "plan"),
    ("/log", "logbook"),
    ("/report", "report"),
    // Its own cache key and route. `/report/overleaf` is matched exactly, so the
    // `/report` entry cannot swallow it.
    ("/report/overleaf", "report-overleaf"),
    ("/shared", "shared-with-me"),
];

/// The screen cache id for `pathname`, or `None` for a detail or settings route.
/// A query string or fragment is cut before the lookup.
#[must_use]
pub fn screen_for_path(pathname: &str) -> Option<&'static str> {
    let cut = pathname.find(['?', '#']).unwrap_or(pathname.len());
    let path = &pathname[..cut];
    ROUTE_SCREENS
        .iter()
        .find(|(route, _)| *route == path)
        .map(|(_, screen)| *screen)
}

#[cfg(test)]
mod tests {
    use super::screen_for_path;

    #[test]
    fn list_routes_map_to_their_screen() {
        assert_eq!(screen_for_path("/papers"), Some("papers"));
        assert_eq!(screen_for_path("/notes"), Some("vault"));
        assert_eq!(screen_for_path("/shared"), Some("shared-with-me"));
    }

    #[test]
    fn overleaf_has_its_own_screen() {
        assert_eq!(screen_for_path("/report/overleaf"), Some("report-overleaf"));
        assert_eq!(screen_for_path("/report"), Some("report"));
    }

    #[test]
    fn detail_and_unknown_routes_have_none() {
        assert_eq!(screen_for_path("/experiments/abc"), None);
        assert_eq!(screen_for_path("/settings"), None);
        assert_eq!(screen_for_path("/papers/"), None);
    }

    #[test]
    fn query_and_fragment_are_cut() {
        assert_eq!(screen_for_path("/papers?tab=2"), Some("papers"));
        assert_eq!(screen_for_path("/graph#node"), Some("graph"));
        assert_eq!(screen_for_path("/log?x=1#y"), Some("logbook"));
    }
}
