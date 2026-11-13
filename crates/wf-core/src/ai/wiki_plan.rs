//! Plans wiki pages from a concept extraction (TS `plan-wiki-pages.use-case.ts`).
//!
//! Pages are ordinary vault notes; the TS side turns each plan into a `create_vault_note` proposal.

use std::collections::{HashMap, HashSet};

use crate::ai::extraction::{ExtractedConcept, ExtractionResult, concept_key, without_existing};
use crate::reader::text_units::{as_f64, collapse_whitespace};

const DEFAULT_MIN_MENTIONS: f64 = 2.0;
const DEFAULT_MAX_PAGES: f64 = 25.0;

/// A page the planner proposes (TS `WikiPagePlan`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct WikiPagePlan {
    /// Page title: the concept's name.
    pub title: String,
    /// Drafted note body.
    pub body: String,
    /// Documents the concept was found in, for the review queue's evidence.
    pub source_document_ids: Vec<String>,
    /// How many documents mention the concept.
    pub mentions: f64,
}

/// Inputs to `plan_wiki_pages` (TS `PlanWikiPagesInput`). The TS `titleOf` callback is resolved
/// into `titles` (document id to title) before the call; a document id without an entry is shown as its id.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlanWikiPagesInput {
    /// The extraction to plan from.
    pub extraction: ExtractionResult,
    /// Titles already in the wiki; these are never proposed again.
    #[serde(default)]
    pub existing_titles: Vec<String>,
    /// Concepts below this many mentions are not worth a page of their own. Defaults to 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_mentions: Option<f64>,
    /// Cap on the number of pages, with JS `slice` semantics (a negative value counts back from the end). Defaults to 25.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_pages: Option<f64>,
    /// Document id to title, for the page's mention list.
    #[serde(default)]
    pub titles: HashMap<String, String>,
}

/// One document's mention of a concept, ready to list on the page.
struct Source {
    document_id: String,
    title: String,
    evidence: String,
}

/// The review card's text for a planned page: a bold title the card shows as its heading, a `Why:`
/// line, then the drafted page itself (E26).
#[must_use]
pub fn wiki_proposal_content(plan: &WikiPagePlan) -> String {
    let times = if plan.mentions == 1.0 {
        "once".to_owned()
    } else {
        format!("{} times", plan.mentions)
    };
    let sources = plan.source_document_ids.len();
    let where_ = format!(
        "{sources} note{} or paper{}",
        plural_s(sources),
        plural_s(sources)
    );
    [
        format!("**New wiki page \"{}\"**", plan.title),
        format!("Why: mentioned {times} in {where_}."),
        String::new(),
        plan.body.clone(),
    ]
    .join("\n")
}

/// Plan the pages worth creating.
///
/// Idempotent against `existing_titles`: running twice over an unchanged workspace proposes nothing
/// the second time, which is what stops the review queue filling with duplicates.
#[must_use]
pub fn plan_wiki_pages(input: &PlanWikiPagesInput) -> Vec<WikiPagePlan> {
    let min_mentions = input.min_mentions.unwrap_or(DEFAULT_MIN_MENTIONS);
    let max_pages = input.max_pages.unwrap_or(DEFAULT_MAX_PAGES);

    let fresh = without_existing(&input.extraction, &input.existing_titles);

    let mut sources_by_concept: HashMap<String, Vec<Source>> = HashMap::new();
    for mention in &fresh.mentions {
        let title = input
            .titles
            .get(&mention.document_id)
            .cloned()
            .unwrap_or_else(|| mention.document_id.clone());
        sources_by_concept
            .entry(concept_key(&mention.concept_name))
            .or_default()
            .push(Source {
                document_id: mention.document_id.clone(),
                title,
                evidence: mention.evidence.clone(),
            });
    }

    let eligible: Vec<&ExtractedConcept> = fresh
        .concepts
        .iter()
        .filter(|concept| concept.mentions >= min_mentions)
        .collect();
    let end = js_slice_end(eligible.len(), max_pages);

    eligible[..end]
        .iter()
        .map(|concept| {
            let sources = sources_by_concept
                .get(&concept_key(&concept.name))
                .map_or(&[][..], Vec::as_slice);
            let mut seen = HashSet::new();
            let source_document_ids = sources
                .iter()
                .filter(|source| seen.insert(source.document_id.as_str()))
                .map(|source| source.document_id.clone())
                .collect();
            WikiPagePlan {
                title: concept.name.clone(),
                body: render_page(concept, sources),
                source_document_ids,
                mentions: concept.mentions,
            }
        })
        .collect()
}

/// The drafted page body (TS `renderPage`). The summary stays blank on purpose: inventing a
/// definition is the kind of confident wrongness that makes generated wikis untrustworthy.
fn render_page(concept: &ExtractedConcept, sources: &[Source]) -> String {
    let count = sources.len();
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!(
        "> Drafted from {count} source{}. Edit freely — this is an ordinary note.",
        plural_s(count)
    ));
    lines.push(String::new());

    if !concept.aliases.is_empty() {
        lines.push(format!("**Also known as:** {}", concept.aliases.join(", ")));
        lines.push(String::new());
    }

    lines.push("## Summary".to_owned());
    lines.push(String::new());
    lines.push("_Not written yet._".to_owned());
    lines.push(String::new());

    lines.push("## Mentioned in".to_owned());
    lines.push(String::new());
    for source in sources {
        lines.push(format!("- [[{}]]", source.title));
        // One line, so a snippet's own headings and lists cannot leak into the page (E28).
        let evidence = collapse_whitespace(&source.evidence);
        if !evidence.is_empty() {
            lines.push(format!("  - {evidence}"));
        }
    }
    lines.push(String::new());

    lines.push(format!("#{}", concept.kind));

    lines.join("\n")
}

/// `""` for one, `"s"` otherwise.
fn plural_s(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

/// The end index JS `slice(0, end)` uses over `len` items. A negative `end` counts back from the end;
/// values past either end clamp.
fn js_slice_end(len: usize, end: f64) -> usize {
    let len = as_f64(len);
    let end = if end.is_nan() { 0.0 } else { end.trunc() };
    let index = if end < 0.0 {
        (len + end).max(0.0)
    } else {
        end.min(len)
    };
    // `index` lies in `0..=len`, so the truncating cast is exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let index = index as usize;
    index
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::extraction::{ExtractedMention, ExtractionResult};

    fn concept(name: &str, mentions: f64) -> ExtractedConcept {
        ExtractedConcept {
            name: name.into(),
            aliases: Vec::new(),
            kind: "concept".into(),
            mentions,
        }
    }

    fn mention(doc: &str, name: &str, evidence: &str) -> ExtractedMention {
        ExtractedMention {
            document_id: doc.into(),
            concept_name: name.into(),
            evidence: evidence.into(),
        }
    }

    fn input(
        concepts: Vec<ExtractedConcept>,
        mentions: Vec<ExtractedMention>,
    ) -> PlanWikiPagesInput {
        PlanWikiPagesInput {
            extraction: ExtractionResult {
                concepts,
                mentions,
                pending: None,
            },
            ..PlanWikiPagesInput::default()
        }
    }

    fn plan(mentions: f64, sources: &[&str]) -> WikiPagePlan {
        WikiPagePlan {
            title: "VAE".into(),
            body: "Body".into(),
            source_document_ids: sources.iter().map(|s| (*s).to_owned()).collect(),
            mentions,
        }
    }

    #[test]
    fn proposal_content_says_once_for_a_single_mention() {
        assert_eq!(
            wiki_proposal_content(&plan(1.0, &["a"])),
            "**New wiki page \"VAE\"**\nWhy: mentioned once in 1 note or paper.\n\nBody"
        );
    }

    #[test]
    fn proposal_content_counts_repeats_and_sources() {
        assert_eq!(
            wiki_proposal_content(&plan(3.0, &["a", "b"])),
            "**New wiki page \"VAE\"**\nWhy: mentioned 3 times in 2 notes or papers.\n\nBody"
        );
    }

    #[test]
    fn plans_concepts_at_the_mention_floor_with_their_mention_list() {
        let extraction_input = input(
            vec![concept("VAE", 2.0), concept("RNN", 1.0)],
            vec![
                mention("d1", "vae", "VAE is\n  good"),
                mention("d2", "VAE", "x"),
                mention("d3", "rnn", "y"),
            ],
        );
        let with_titles = PlanWikiPagesInput {
            titles: HashMap::from([("d1".to_owned(), "Paper One".to_owned())]),
            ..extraction_input
        };
        let plans = plan_wiki_pages(&with_titles);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].title, "VAE");
        assert_eq!(plans[0].source_document_ids, ["d1", "d2"]);
        assert!(
            plans[0]
                .body
                .contains("- [[Paper One]]\n  - VAE is good\n- [[d2]]\n  - x\n")
        );
        assert!(plans[0].body.ends_with("#concept"));
    }

    #[test]
    fn drops_titles_already_in_the_wiki_so_a_rerun_proposes_nothing() {
        let mut existing = input(
            vec![concept("VAE", 2.0), concept("GAN", 2.0)],
            vec![mention("d1", "vae", "a"), mention("d1", "gan", "b")],
        );
        existing.existing_titles = vec!["  vae ".into()];
        let plans = plan_wiki_pages(&existing);
        let titles: Vec<_> = plans.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, ["GAN"]);

        let titles_now: Vec<String> = titles
            .iter()
            .map(|t| (*t).to_owned())
            .chain(["VAE".to_owned()])
            .collect();
        let rerun = PlanWikiPagesInput {
            existing_titles: titles_now,
            ..input(
                vec![concept("VAE", 2.0), concept("GAN", 2.0)],
                vec![mention("d1", "vae", "a"), mention("d1", "gan", "b")],
            )
        };
        assert!(plan_wiki_pages(&rerun).is_empty());
    }

    #[test]
    fn max_pages_caps_and_a_negative_cap_counts_back_from_the_end() {
        let concepts = vec![concept("A", 2.0), concept("B", 2.0), concept("C", 2.0)];
        let mentions = vec![];
        let capped = PlanWikiPagesInput {
            max_pages: Some(2.0),
            ..input(concepts.clone(), mentions.clone())
        };
        let names: Vec<_> = plan_wiki_pages(&capped)
            .into_iter()
            .map(|p| p.title)
            .collect();
        assert_eq!(names, ["A", "B"]);

        let trimmed = PlanWikiPagesInput {
            max_pages: Some(-1.0),
            ..input(concepts, mentions)
        };
        let names: Vec<_> = plan_wiki_pages(&trimmed)
            .into_iter()
            .map(|p| p.title)
            .collect();
        assert_eq!(names, ["A", "B"]);
    }

    #[test]
    fn min_mentions_defaults_to_two() {
        let defaults = input(vec![concept("ONE", 1.0)], Vec::new());
        assert!(plan_wiki_pages(&defaults).is_empty());
        let lowered = PlanWikiPagesInput {
            min_mentions: Some(1.0),
            ..input(vec![concept("ONE", 1.0)], Vec::new())
        };
        assert_eq!(plan_wiki_pages(&lowered).len(), 1);
    }
}
