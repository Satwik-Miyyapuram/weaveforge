//! Drop image references whose blob did not resolve (wf-core `markdown_image_refs`).
//! Ported from `apps/web/src/lib/markdown-image-refs.ts`.
//!
//! Paper notes and report sections both write images as `<prefix><path>`. The ones whose blob
//! never arrived are removed, so the reader does not see a broken image for a file it cannot fetch.

use regex_lite::Regex;

/// Remove every `![alt](prefix+path)` whose `path` is in `paths` but not in `resolved`.
/// Each path is matched literally, so a path with `)` or regex metacharacters still works.
#[must_use]
pub fn strip_unresolved_image_refs(
    body: &str,
    prefix: &str,
    paths: &[String],
    resolved: &[String],
) -> String {
    let alternatives: Vec<String> = paths
        .iter()
        .filter(|path| !resolved.contains(*path))
        .map(|path| escape_regex(&format!("{prefix}{path}")))
        .collect();
    if alternatives.is_empty() {
        return body.to_owned();
    }
    // One group around the alternation: `\(a|b\)` would bind `|` to the whole pattern.
    let pattern = format!(r"!\[[^\]]*\]\((?:{})\)", alternatives.join("|"));
    match Regex::new(&pattern) {
        Ok(re) => re.replace_all(body, "").into_owned(),
        // Every alternative is escaped, so this cannot fail; keep the body if it ever did.
        Err(_) => body.to_owned(),
    }
}

/// Escape the regex metacharacters, as the TypeScript `escapeRegExp` did.
fn escape_regex(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ".*+?^${}()|[]\\".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn drops_only_unresolved_refs() {
        let body = "![a](paperimg:a.png) and ![b](paperimg:b.png)";
        let out = strip_unresolved_image_refs(
            body,
            "paperimg:",
            &owned(&["a.png", "b.png"]),
            &owned(&["a.png"]),
        );
        assert_eq!(out, "![a](paperimg:a.png) and ");
    }

    #[test]
    fn regex_metacharacters_match_literally() {
        let body = "![x](reportimg:a+b(1).png)";
        let out = strip_unresolved_image_refs(body, "reportimg:", &owned(&["a+b(1).png"]), &[]);
        assert_eq!(out, "");
    }

    #[test]
    fn several_unresolved_refs_are_each_removed() {
        // The TypeScript alternation was ungrouped and left a stray `)` here.
        let body = "![x](p:a.png) ![y](p:b.png) ![z](p:c.png)";
        let out = strip_unresolved_image_refs(
            body,
            "p:",
            &owned(&["a.png", "b.png", "c.png"]),
            &owned(&["c.png"]),
        );
        assert_eq!(out, "  ![z](p:c.png)");
    }

    #[test]
    fn other_images_are_untouched() {
        let body = "![a](https://example.com/a.png)";
        let out = strip_unresolved_image_refs(body, "p:", &owned(&["a.png"]), &[]);
        assert_eq!(out, body);
    }

    #[test]
    fn nothing_unresolved_returns_body() {
        let body = "![a](p:a.png)";
        assert_eq!(
            strip_unresolved_image_refs(body, "p:", &owned(&["a.png"]), &owned(&["a.png"])),
            body
        );
        assert_eq!(strip_unresolved_image_refs(body, "p:", &[], &[]), body);
    }
}
