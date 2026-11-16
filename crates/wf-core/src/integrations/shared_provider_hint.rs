//! The "same stored credentials" hint under a project sync descriptor, ported
//! from `apps/web/src/integrations/descriptors-resolve.ts` (`sharedProviderHint`).

use serde::Deserialize;

/// The fields of a project sync descriptor the hint reads.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "HintDescriptor"))]
#[serde(rename_all = "camelCase", default)]
pub struct DescriptorRef {
    /// The descriptor's id.
    pub id: String,
    /// The provider it syncs with.
    pub provider: String,
    /// Its display title.
    pub title: String,
}

/// `Uses the same stored credentials as “<title>”.` for the first other
/// descriptor on the same provider, or `None` when there is none.
#[must_use]
pub fn shared_provider_hint(descriptor: &DescriptorRef, all: &[DescriptorRef]) -> Option<String> {
    let first = all
        .iter()
        .find(|d| d.provider == descriptor.provider && d.id != descriptor.id)?;
    Some(format!(
        "Uses the same stored credentials as “{}”.",
        first.title
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: &str, provider: &str, title: &str) -> DescriptorRef {
        DescriptorRef {
            id: id.to_string(),
            provider: provider.to_string(),
            title: title.to_string(),
        }
    }

    #[test]
    fn no_sibling_gives_none() {
        let all = [d("a", "gitlab", "A"), d("b", "zotero", "B")];
        assert_eq!(shared_provider_hint(&all[0], &all), None);
    }

    #[test]
    fn same_id_is_not_a_sibling() {
        let all = [d("a", "gitlab", "A")];
        assert_eq!(shared_provider_hint(&all[0], &all), None);
    }

    #[test]
    fn first_sibling_title_is_named() {
        let all = [
            d("git", "gitlab", "GitLab — Git tab"),
            d("log", "gitlab", "GitLab — Logbook"),
        ];
        assert_eq!(
            shared_provider_hint(&all[1], &all).as_deref(),
            Some("Uses the same stored credentials as “GitLab — Git tab”.")
        );
    }
}
