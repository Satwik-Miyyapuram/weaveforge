//! Rewrites experiment artifact references in report markdown into figures or warning lines.
//! Port of `apps/web/src/features/report/application/resolve-artifact-markdown.ts`, with the
//! lookup of `resolveArtifactRef` (artifact-refs.ts) folded in. The `lastMetricAtMs` heartbeat
//! hook is not ported: no caller passed it.
//!
//! The warning text and curly quotes match the TS output.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::artifact_refs::{
    ScannedRef, artifact_basename, collapse_whitespace, scan_artifact_refs,
};
use crate::experiment_status::{self, Experiment as RunFields, ExperimentStatus};

/// Marker that opens each warning line (U+26A0 followed by the emoji variation selector).
const WARNING: &str = "\u{26A0}\u{FE0F}";

/// The note added under a stale running figure.
const STALE_NOTE: &str = "Experiment is running but stale \u{2014} this figure may be out of date.";

/// The experiment fields the markdown rewrite reads (a subset of TS `Experiment`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReportExperiment {
    /// Experiment id; references name it.
    pub id: String,
    /// Display name, shown when an artifact is missing.
    pub name: String,
    /// Live artifact URLs or names. Absent counts as none.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub artifacts: Option<Vec<String>>,
    /// Current status, for the stale-running check.
    pub status: ExperimentStatus,
    /// First start, ISO 8601 UTC.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub started_at: Option<String>,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// Alt or name text made safe for a markdown caption and an attribute. Newlines and runs of
/// whitespace collapse to one space; quotes, angle brackets, backticks, markdown meta characters
/// and `&` are dropped. An empty result becomes `artifact`.
#[must_use]
pub fn safe_artifact_caption(alt: Option<&str>) -> String {
    let collapsed = collapse_whitespace(alt.unwrap_or(""));
    let cleaned: String = collapsed
        .chars()
        .filter(|c| {
            !matches!(
                c,
                '"' | '\'' | '<' | '>' | '`' | '[' | ']' | '*' | '_' | '~' | '\\' | '&'
            )
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "artifact".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// An image destination the markdown renderer turns into `<img>`, or `None` when the URL is not
/// an `http(s)`, `blob:` or `vault:` URL or holds a character that could break out of the tag.
/// Parentheses and whitespace are percent-encoded so they cannot end the destination.
#[must_use]
pub fn safe_image_destination(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let scheme_ok = ["http:", "https:", "blob:", "vault:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme));
    if !scheme_ok {
        return None;
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '"' | '\'' | '<' | '>' | '`'))
    {
        return None;
    }
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch == '(' || ch == ')' || ch.is_whitespace() {
            // Matches the TS `charCodeAt(0).toString(16)`: no zero padding, so a tab becomes `%9`.
            out.push_str(&format!("%{:X}", ch as u32));
        } else {
            out.push(ch);
        }
    }
    Some(out)
}

/// Replaces every `expartifact:` reference in `body` with a figure, or a warning line when the
/// artifact cannot be shown. `now_ms` is the clock for the stale-running check (`Date.now()` in TS).
/// Returns `body` unchanged when it has no references.
#[must_use]
pub fn resolve_artifact_refs_markdown(
    body: &str,
    experiments: &[ReportExperiment],
    now_ms: f64,
) -> String {
    let refs = scan_artifact_refs(body);
    if refs.is_empty() {
        return body.to_owned();
    }
    // Later duplicates win, as with `new Map(...)` in TS.
    let by_id: HashMap<&str, &ReportExperiment> = experiments
        .iter()
        .map(|experiment| (experiment.id.as_str(), experiment))
        .collect();

    let mut out = String::with_capacity(body.len());
    let mut cursor = 0;
    for found in &refs {
        out.push_str(&body[cursor..found.byte_start]);
        cursor = found.byte_end;
        out.push_str(&render_one(found, &by_id, now_ms));
    }
    out.push_str(&body[cursor..]);
    out
}

fn render_one(
    found: &ScannedRef,
    experiments: &HashMap<&str, &ReportExperiment>,
    now_ms: f64,
) -> String {
    let caption = safe_artifact_caption(Some(found.alt.as_str()));
    let Some(experiment) = experiments.get(found.experiment_id.as_str()) else {
        return format!("> {WARNING} Missing experiment for artifact \u{201C}{caption}\u{201D}.");
    };
    let artifacts: &[String] = experiment.artifacts.as_deref().unwrap_or(&[]);
    let Some(matched) = match_experiment_artifact(artifacts, &found.artifact_name) else {
        let name = safe_artifact_caption(Some(experiment.name.as_str()));
        return format!(
            "> {WARNING} Artifact \u{201C}{caption}\u{201D} was not found on experiment {name}."
        );
    };
    format_resolved_figure(&caption, matched, is_stale(experiment, now_ms))
}

fn format_resolved_figure(caption: &str, artifact_url: &str, stale: bool) -> String {
    let Some(destination) = safe_image_destination(artifact_url) else {
        return format!("> {WARNING} Artifact \u{201C}{caption}\u{201D} has no renderable URL.");
    };
    let figure = format!("![{caption}]({destination})");
    if stale {
        format!("{figure}\n> {WARNING} {STALE_NOTE}")
    } else {
        figure
    }
}

/// The live artifact that a stored reference names. Prefers an exact match, then a unique
/// basename match, so `loss.png` finds a signed `https://…/loss.png?token=…`. A basename shared
/// by two live URLs matches nothing (fail closed).
fn match_experiment_artifact<'a>(artifacts: &'a [String], wanted: &str) -> Option<&'a str> {
    if let Some(exact) = artifacts
        .iter()
        .find(|artifact| artifact.as_str() == wanted)
    {
        return Some(exact.as_str());
    }
    let want = artifact_basename(wanted);
    if want.is_empty() {
        return None;
    }
    let mut hits = artifacts
        .iter()
        .filter(|artifact| artifact_basename(artifact) == want);
    let first = hits.next()?;
    if hits.next().is_some() {
        return None;
    }
    Some(first.as_str())
}

/// Whether a running experiment has gone quiet for longer than the stale threshold.
fn is_stale(experiment: &ReportExperiment, now_ms: f64) -> bool {
    let run = RunFields {
        status: experiment.status,
        started_at: experiment.started_at.clone(),
        created_at: experiment.created_at.clone(),
    };
    experiment_status::is_stale_running_experiment(
        &run,
        now_ms,
        experiment_status::STALE_RUNNING_MS,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW_MS: f64 = 1_767_225_900_000.0; // 2026-01-01T00:05:00Z

    fn experiment(
        id: &str,
        name: &str,
        artifacts: &[&str],
        status: ExperimentStatus,
    ) -> ReportExperiment {
        ReportExperiment {
            id: id.to_owned(),
            name: name.to_owned(),
            artifacts: Some(artifacts.iter().map(|s| (*s).to_owned()).collect()),
            status,
            started_at: None,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn caption_collapses_newlines_and_drops_markup() {
        assert_eq!(safe_artifact_caption(Some("before\nafter")), "before after");
        assert_eq!(safe_artifact_caption(Some("a[b]c")), "abc");
        assert_eq!(
            safe_artifact_caption(Some("x\" onerror=\"alert(1)")),
            "x onerror=alert(1)"
        );
        assert_eq!(safe_artifact_caption(None), "artifact");
        assert_eq!(safe_artifact_caption(Some("  ")), "artifact");
    }

    #[test]
    fn destination_accepts_web_schemes_and_encodes_parentheses() {
        assert_eq!(
            safe_image_destination("https://cdn.test/a.png").as_deref(),
            Some("https://cdn.test/a.png")
        );
        assert_eq!(
            safe_image_destination("https://cdn.test/a(1).png").as_deref(),
            Some("https://cdn.test/a%281%29.png")
        );
        assert_eq!(safe_image_destination("loss.png"), None);
        assert_eq!(safe_image_destination("javascript:alert(1)"), None);
        assert_eq!(
            safe_image_destination("https://cdn.test/a.png\" onerror=\"x"),
            None
        );
    }

    #[test]
    fn resolved_ref_emits_figure_with_collapsed_alt() {
        let body = "![before\nafter](expartifact:e1/https%3A%2F%2Fcdn.test%2Fa.png)";
        let out = resolve_artifact_refs_markdown(
            body,
            &[experiment(
                "e1",
                "Run",
                &["https://cdn.test/a.png"],
                ExperimentStatus::Done,
            )],
            NOW_MS,
        );
        assert_eq!(out, "![before after](https://cdn.test/a.png)");
    }

    #[test]
    fn basename_ref_resolves_to_signed_live_url() {
        let out = resolve_artifact_refs_markdown(
            "![fig](expartifact:e1/loss.png)",
            &[experiment(
                "e1",
                "Run",
                &["https://cdn.test/loss.png?tok=1"],
                ExperimentStatus::Done,
            )],
            NOW_MS,
        );
        assert_eq!(out, "![fig](https://cdn.test/loss.png?tok=1)");
    }

    #[test]
    fn missing_experiment_warns() {
        let out = resolve_artifact_refs_markdown(
            "![fig](expartifact:gone/https%3A%2F%2Fx.test%2Fa.png)",
            &[],
            NOW_MS,
        );
        assert_eq!(
            out,
            "> \u{26A0}\u{FE0F} Missing experiment for artifact \u{201C}fig\u{201D}."
        );
    }

    #[test]
    fn missing_artifact_names_the_experiment() {
        let out = resolve_artifact_refs_markdown(
            "![fig](expartifact:e1/other.png)",
            &[experiment(
                "e1",
                "Run",
                &["loss.png"],
                ExperimentStatus::Done,
            )],
            NOW_MS,
        );
        assert_eq!(
            out,
            "> \u{26A0}\u{FE0F} Artifact \u{201C}fig\u{201D} was not found on experiment Run."
        );
    }

    #[test]
    fn basename_collision_fails_closed() {
        let out = resolve_artifact_refs_markdown(
            "![fig](expartifact:e1/loss.png)",
            &[experiment(
                "e1",
                "Run",
                &[
                    "https://cdn.test/a/loss.png?token=1",
                    "https://cdn.test/b/loss.png?token=2",
                ],
                ExperimentStatus::Done,
            )],
            NOW_MS,
        );
        assert!(out.contains("was not found on experiment Run."), "{out}");
    }

    #[test]
    fn stale_running_experiment_adds_note() {
        let mut run = experiment(
            "e1",
            "Run",
            &["https://cdn.test/loss.png"],
            ExperimentStatus::Running,
        );
        run.started_at = Some("2026-01-01T00:00:00.000Z".to_owned());
        let out = resolve_artifact_refs_markdown("![fig](expartifact:e1/loss.png)", &[run], NOW_MS);
        assert_eq!(
            out,
            "![fig](https://cdn.test/loss.png)\n> \u{26A0}\u{FE0F} Experiment is running but stale \u{2014} this figure may be out of date."
        );
    }

    #[test]
    fn body_without_refs_is_unchanged() {
        let body = "Just [[Note]] and text.";
        assert_eq!(resolve_artifact_refs_markdown(body, &[], NOW_MS), body);
    }
}
