//! The sentence the link form previews (TS `linkSentence` in
//! `apps/web/src/features/relations/ui/relation-phrase.ts`).

use crate::enum_label::enum_label;

/// "‹from› ‹relation, lowercased› ‹to›", or `None` until both papers are picked. A blank paper
/// counts as not picked, as an empty string is falsy in the TS original.
#[must_use]
pub fn link_sentence(from: Option<&str>, relation: &str, to: Option<&str>) -> Option<String> {
    let from = from.filter(|paper| !paper.is_empty())?;
    let to = to.filter(|paper| !paper.is_empty())?;
    Some(format!(
        "{from} {} {to}",
        enum_label("relation", relation).to_lowercase()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "the link sentence says what will be saved"
    #[test]
    fn the_link_sentence_names_both_papers_and_the_relation() {
        assert_eq!(
            link_sentence(Some("Attention"), "cites", Some("LSTM")).as_deref(),
            Some("Attention cites LSTM")
        );
        assert_eq!(
            link_sentence(Some("A"), "uses_method", Some("B")).as_deref(),
            Some("A uses method B")
        );
    }

    // it: "nothing until both papers are picked"
    #[test]
    fn nothing_until_both_papers_are_picked() {
        assert_eq!(link_sentence(Some(""), "cites", Some("B")), None);
        assert_eq!(link_sentence(Some("A"), "cites", None), None);
    }
}
