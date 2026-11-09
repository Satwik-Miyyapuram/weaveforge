//! Project rules (the Rust twin of `packages/core/src/features/projects/domain/project.ts`).

/// The name a new project is stored under: trimmed, or `None` when nothing is left.
#[must_use]
pub fn project_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::project_name;

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(project_name("  Thesis  ").as_deref(), Some("Thesis"));
    }

    #[test]
    fn keeps_inner_whitespace() {
        assert_eq!(project_name("Latent  Spaces").as_deref(), Some("Latent  Spaces"));
    }

    #[test]
    fn blank_name_is_none() {
        assert_eq!(project_name(""), None);
        assert_eq!(project_name("   \t\n"), None);
    }
}
