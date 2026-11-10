//! Export path guard and missing-figure warning (ports of `assertSafeExportPath` and
//! `missingFigureWarning` in apps/web/src/features/overleaf/application/build-overleaf-export.ts).

/// Why `path` is not a plain relative ZIP entry name (no `..`, no leading `/`, no `\`), or `None`
/// when it is safe. The TS wrapper throws this message.
#[must_use]
pub fn unsafe_export_path_error(path: &str) -> Option<String> {
    if path.contains("..") || path.starts_with('/') || path.contains('\\') {
        Some(format!("Refusing unsafe export path: {path}"))
    } else {
        None
    }
}

/// The warning for a figure whose blob could not be loaded.
#[must_use]
pub fn missing_figure_warning(zip_path: &str, storage_path: &str) -> String {
    format!("Missing figure: {zip_path} (could not load {storage_path})")
}

#[cfg(test)]
mod tests {
    use super::{missing_figure_warning, unsafe_export_path_error};

    #[test]
    fn refuses_traversal_absolute_and_backslash_paths() {
        for bad in ["../x.tex", "a/../b", "/etc/passwd", "figures\\a.png"] {
            assert!(unsafe_export_path_error(bad).is_some(), "{bad}");
        }
    }

    #[test]
    fn accepts_plain_relative_paths() {
        for ok in ["main.tex", "figures/fig_2.png", "a.b.c"] {
            assert_eq!(unsafe_export_path_error(ok), None, "{ok}");
        }
    }

    #[test]
    fn names_the_figure_and_its_storage_path() {
        assert_eq!(
            missing_figure_warning("figures/b.png", "u/1/b.png"),
            "Missing figure: figures/b.png (could not load u/1/b.png)"
        );
    }
}
