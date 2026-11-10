//! Where a milestone dependency chip goes when tapped (pure). A port of the rule in
//! `apps/web/src/features/plan/ui/plan-chip.ts` (`planChipTarget`).

use serde::Serialize;

use crate::experiment_status::experiment_href;
use crate::overleaf_workshop::encode_uri_component;
use crate::plan::milestone::{DependencyKind, MilestoneDependency};
use crate::reader_analysis::lines::js_trim;

/// What a dependency chip does when tapped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all_fields = "camelCase",
    rename_all = "camelCase"
)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ChipTarget {
    /// Open `href`; `external` for a URL outside the app.
    Link {
        /// Where the chip points.
        href: String,
        /// Whether `href` is outside the app.
        external: bool,
    },
    /// Scroll to another milestone on the page.
    Jump {
        /// The milestone to scroll to.
        milestone_id: String,
    },
    /// The target was deleted: grey the chip out.
    Missing,
    /// Nothing to open: show the label as plain text.
    Plain,
}

/// The id and title of a milestone on the page, for resolving a title-only reference.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ChipMilestone {
    /// Id.
    pub id: String,
    /// Title.
    pub title: String,
}

/// Papers and experiments open; milestones jump on the page; an external chip
/// links only when its label is a URL. A target that was deleted is `Missing`
/// so the chip greys out instead of linking to nothing.
///
/// `known` is the set of ids still present. `is_offline_build` picks the
/// experiment route the same way the TS `experimentHref` does.
#[must_use]
pub fn chip_target(
    dep: &MilestoneDependency,
    known: &[String],
    milestones: &[ChipMilestone],
    is_offline_build: bool,
) -> ChipTarget {
    let is_known = |id: &str| known.iter().any(|k| k == id);
    let ref_id = dep.ref_id.as_deref().filter(|id| !id.is_empty());
    match dep.kind {
        DependencyKind::External => {
            let label = js_trim(dep.label.as_deref().unwrap_or(""));
            if is_http_url(label) {
                ChipTarget::Link {
                    href: label.to_owned(),
                    external: true,
                }
            } else {
                ChipTarget::Plain
            }
        }
        DependencyKind::Milestone => {
            let id = ref_id.map(str::to_owned).or_else(|| {
                let label = dep.label.as_deref()?;
                milestones
                    .iter()
                    .find(|milestone| milestone.title == label)
                    .map(|milestone| milestone.id.clone())
            });
            match id {
                Some(id) if is_known(&id) => ChipTarget::Jump { milestone_id: id },
                _ => ChipTarget::Missing,
            }
        }
        DependencyKind::Paper => match ref_id {
            Some(id) if is_known(id) => ChipTarget::Link {
                href: format!("/papers?paper={}", encode_uri_component(id)),
                external: false,
            },
            _ => ChipTarget::Missing,
        },
        DependencyKind::Experiment => match ref_id {
            Some(id) if is_known(id) => ChipTarget::Link {
                href: experiment_href(id, is_offline_build),
                external: false,
            },
            _ => ChipTarget::Missing,
        },
    }
}

/// `^https?:\/\/\S+$`, case-insensitive: a scheme, then at least one non-space character.
fn is_http_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    matches!(rest, Some(rest) if !rest.is_empty() && !rest.chars().any(char::is_whitespace))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dep(kind: DependencyKind, ref_id: Option<&str>, label: Option<&str>) -> MilestoneDependency {
        MilestoneDependency {
            kind,
            ref_id: ref_id.map(str::to_owned),
            label: label.map(str::to_owned),
        }
    }

    fn known() -> Vec<String> {
        ["p1", "e1", "m1"]
            .iter()
            .map(|id| (*id).to_owned())
            .collect()
    }

    fn milestones() -> Vec<ChipMilestone> {
        vec![ChipMilestone {
            id: "m1".to_owned(),
            title: "Pilot study".to_owned(),
        }]
    }

    #[test]
    fn paper_chip_links_to_the_paper_page() {
        assert_eq!(
            chip_target(
                &dep(DependencyKind::Paper, Some("p1"), None),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Link {
                href: "/papers?paper=p1".to_owned(),
                external: false
            }
        );
    }

    #[test]
    fn experiment_chip_uses_the_experiment_href() {
        assert_eq!(
            chip_target(
                &dep(DependencyKind::Experiment, Some("e1"), None),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Link {
                href: experiment_href("e1", false),
                external: false
            }
        );
    }

    #[test]
    fn milestone_chips_jump_by_id_or_by_title() {
        assert_eq!(
            chip_target(
                &dep(DependencyKind::Milestone, Some("m1"), None),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Jump {
                milestone_id: "m1".to_owned()
            }
        );
        assert_eq!(
            chip_target(
                &dep(DependencyKind::Milestone, None, Some("Pilot study")),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Jump {
                milestone_id: "m1".to_owned()
            }
        );
    }

    #[test]
    fn a_deleted_target_is_missing() {
        for kind in [
            DependencyKind::Paper,
            DependencyKind::Experiment,
            DependencyKind::Milestone,
        ] {
            assert_eq!(
                chip_target(
                    &dep(kind, Some("gone"), None),
                    &known(),
                    &milestones(),
                    false
                ),
                ChipTarget::Missing
            );
        }
    }

    #[test]
    fn external_chips_link_only_when_the_label_is_a_url() {
        assert_eq!(
            chip_target(
                &dep(
                    DependencyKind::External,
                    None,
                    Some("  https://hpc.example.org/apply ")
                ),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Link {
                href: "https://hpc.example.org/apply".to_owned(),
                external: true
            }
        );
        assert_eq!(
            chip_target(
                &dep(DependencyKind::External, None, Some("Supervisor sign-off")),
                &known(),
                &milestones(),
                false
            ),
            ChipTarget::Plain
        );
    }

    #[test]
    fn url_test_needs_a_scheme_and_no_inner_spaces() {
        assert!(is_http_url("HTTP://x.org/a"));
        assert!(!is_http_url("https://"));
        assert!(!is_http_url("https://x.org a"));
        assert!(!is_http_url("ftp://x.org"));
    }
}
