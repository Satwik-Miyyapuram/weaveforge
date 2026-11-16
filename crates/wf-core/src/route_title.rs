//! Window titles for routes, ported from `apps/web/src/lib/route-title.ts`.
//! Pure: the nav items are passed in, so no navigation state is read here.

use serde::{Deserialize, Serialize};

const APP_NAME: &str = "WeaveForge";

/// Routes with no nav item of their own, named for the window title.
const EXTRA_TITLES: &[(&str, &str)] = &[
    ("/settings", "Settings"),
    ("/ai-review", "AI suggestions"),
    ("/reader", "Reader"),
    ("/report/overleaf", "Overleaf"),
    ("/shared", "Shared with you"),
    ("/supervision", "Supervision"),
];

/// A nav item as the title lookup needs it: its path and the label it shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "NavRouteInput"))]
#[serde(rename_all = "camelCase")]
pub struct NavRoute {
    /// The route path, for example `/papers`.
    pub path: String,
    /// The screen name, for example `Papers`.
    pub label: String,
}

/// The screen's own name (`Papers`), or `None` for a route with none.
///
/// The longest matching path wins, so `/report/overleaf` is not named after
/// `/report`, and a detail route (`/experiments/abc`) takes its list's name.
/// A trailing slash is ignored; the root path stays `/`.
#[must_use]
pub fn label_for_path(pathname: &str, nav_items: &[NavRoute]) -> Option<String> {
    let trimmed = pathname.trim_end_matches('/');
    let path = if trimmed.is_empty() { "/" } else { trimmed };

    let mut best: Option<(&str, &str)> = None;
    let candidates = nav_items
        .iter()
        .map(|item| (item.path.as_str(), item.label.as_str()))
        .chain(EXTRA_TITLES.iter().copied());
    for (candidate_path, title) in candidates {
        let matches = path == candidate_path
            || path
                .strip_prefix(candidate_path)
                .is_some_and(|rest| rest.starts_with('/'));
        if matches && best.is_none_or(|(best_path, _)| candidate_path.len() > best_path.len()) {
            best = Some((candidate_path, title));
        }
    }
    best.map(|(_, title)| title.to_string())
}

/// The window title for a route: `Papers · WeaveForge`, or the bare app name.
#[must_use]
pub fn title_for_path(pathname: &str, nav_items: &[NavRoute]) -> String {
    match label_for_path(pathname, nav_items) {
        Some(label) => format!("{label} \u{b7} {APP_NAME}"),
        None => APP_NAME.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{NavRoute, label_for_path, title_for_path};

    fn nav() -> Vec<NavRoute> {
        [
            ("/", "Dashboard"),
            ("/papers", "Papers"),
            ("/report", "Report"),
            ("/experiments", "Experiments"),
        ]
        .into_iter()
        .map(|(path, label)| NavRoute {
            path: path.to_string(),
            label: label.to_string(),
        })
        .collect()
    }

    #[test]
    fn detail_route_takes_its_list_name() {
        assert_eq!(
            label_for_path("/experiments/abc", &nav()).as_deref(),
            Some("Experiments")
        );
        assert_eq!(
            title_for_path("/papers/xyz", &nav()),
            "Papers \u{b7} WeaveForge"
        );
    }

    #[test]
    fn longest_path_wins() {
        assert_eq!(
            label_for_path("/report/overleaf", &nav()).as_deref(),
            Some("Overleaf")
        );
        assert_eq!(label_for_path("/report", &nav()).as_deref(), Some("Report"));
    }

    #[test]
    fn trailing_slash_is_ignored_and_root_is_home() {
        assert_eq!(
            label_for_path("/papers/", &nav()).as_deref(),
            Some("Papers")
        );
        assert_eq!(label_for_path("/", &nav()).as_deref(), Some("Dashboard"));
    }

    #[test]
    fn unknown_route_is_the_bare_app_name() {
        assert_eq!(label_for_path("/nowhere", &nav()), None);
        assert_eq!(title_for_path("/nowhere", &nav()), "WeaveForge");
    }

    #[test]
    fn prefix_must_end_at_a_segment() {
        assert_eq!(label_for_path("/papersx", &nav()), None);
    }
}
