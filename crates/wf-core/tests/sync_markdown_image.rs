//! Ported and property tests for the markdown image helpers.
//! Ports `packages/core/test/shared/markdown-image.test.ts` and
//! `packages/core/test/shared/markdown-image-refs.test.ts`. Cases that need the
//! async `materializeBlobImages` (and the `blob-links` scanners) are not ported
//! here; they are listed in the lane report.

use std::time::{Duration, Instant};

use proptest::prelude::*;
use wf_core::sync::markdown_image::{
    VAULT_IMAGE_PREFIX, escape_markdown_alt_text, image_alt_from_filename,
    image_extension_for_mime, image_paths_in_body, markdown_image, normalize_markdown_image_syntax,
    replace_image_refs,
};

// ---- markdown-image.test.ts ----

#[test]
fn a_bracket_in_the_alt_text_cannot_end_the_label_early() {
    // A screenshot named "figure [2].png" used to produce ![figure [2].png](…).
    assert_eq!(
        markdown_image("vault:a/b.png", "figure [2]"),
        "![figure \\[2\\]](vault:a/b.png)"
    );
    assert_eq!(
        markdown_image("vault:a/b.png", "a\\b"),
        "![a\\\\b](vault:a/b.png)"
    );
}

#[test]
fn the_vault_builder_escapes_too() {
    // Ported inline: `vaultImageMarkdown` is `markdownImage` with the vault prefix.
    let target = format!("{VAULT_IMAGE_PREFIX}u/p/f.png");
    assert_eq!(
        markdown_image(&target, "figure [2]"),
        "![figure \\[2\\]](vault:u/p/f.png)"
    );
}

#[test]
fn a_multiline_or_empty_alt_text_becomes_something_usable() {
    assert_eq!(
        escape_markdown_alt_text("two\nlines   here"),
        "two lines here"
    );
    assert_eq!(escape_markdown_alt_text("   "), "image");
    assert_eq!(escape_markdown_alt_text(""), "image");
}

#[test]
fn an_alt_text_is_derived_from_the_file_name_not_copied_from_it() {
    assert_eq!(
        image_alt_from_filename(Some("loss-curve.png")),
        "loss curve"
    );
    assert_eq!(
        image_alt_from_filename(Some("Screen_Shot_2026.jpeg")),
        "Screen Shot 2026"
    );
    assert_eq!(
        image_alt_from_filename(Some("no-extension")),
        "no extension"
    );
    // A clipboard bitmap is a placeholder, not a description.
    assert_eq!(image_alt_from_filename(Some("image.png")), "image");
    assert_eq!(image_alt_from_filename(None), "image");
    assert_eq!(image_alt_from_filename(Some("")), "image");
}

#[test]
fn extensions_follow_the_blob_with_png_as_the_fallback() {
    assert_eq!(image_extension_for_mime("image/jpeg"), "jpeg");
    assert_eq!(image_extension_for_mime("image/webp"), "webp");
    assert_eq!(image_extension_for_mime("image/gif"), "gif");
    assert_eq!(image_extension_for_mime("image/svg+xml"), "svg");
    assert_eq!(image_extension_for_mime("image/avif"), "avif");
    assert_eq!(image_extension_for_mime("application/octet-stream"), "png");
}

// ---- markdown-image-refs.test.ts ----

fn body_with(prefix: &str) -> String {
    format!(
        "Body text.\n\n![]({prefix}user-1/p1/diagram.png)\n\n![a fig]({prefix}user-1/p1/fig.webp)"
    )
}

#[test]
fn image_paths_in_body_finds_refs_for_each_prefix_with_and_without_alt() {
    for prefix in ["vault:", "paperimg:", "reportimg:"] {
        assert_eq!(
            image_paths_in_body(&body_with(prefix), prefix, normalize_markdown_image_syntax),
            vec!["user-1/p1/diagram.png", "user-1/p1/fig.webp"],
            "prefix {prefix}"
        );
    }
}

#[test]
fn image_paths_in_body_ignores_refs_that_are_not_the_prefix() {
    for prefix in ["vault:", "paperimg:", "reportimg:"] {
        assert_eq!(
            image_paths_in_body(
                "![](https://example.com/x.png)",
                prefix,
                normalize_markdown_image_syntax
            ),
            Vec::<String>::new(),
            "prefix {prefix}"
        );
    }
}

#[test]
fn a_path_is_reported_once_however_often_it_is_referenced() {
    let twice = "![](vault:a/b.png) and again ![](vault:a/b.png)";
    assert_eq!(
        image_paths_in_body(twice, "vault:", normalize_markdown_image_syntax),
        vec!["a/b.png"]
    );
}

#[test]
fn a_ref_wrapped_across_lines_is_still_found() {
    let wrapped = "![]( vault:a/b.png )";
    assert_eq!(
        image_paths_in_body(wrapped, "vault:", normalize_markdown_image_syntax),
        vec!["a/b.png"]
    );
}

#[test]
fn normalize_stays_linear_on_unclosed_image_syntax() {
    for unit in ["![\\", "![](blob:", "![](http://"] {
        let input = unit.repeat(50_000);
        let started = Instant::now();
        let _ = normalize_markdown_image_syntax(&input);
        assert!(
            started.elapsed() < Duration::from_millis(2000),
            "slow on repeated {unit}"
        );
    }
    assert_eq!(
        normalize_markdown_image_syntax("![](foo![x]( vault:a.png )"),
        "![](foo![x](vault:a.png)"
    );
}

#[test]
fn image_ref_scanning_stays_linear_on_unclosed_refs() {
    // Ported part only: the `blob-links` calls in the TS test are not in this lane.
    for s in [
        "![".repeat(50_000),
        "![](vault:!".repeat(50_000),
        "![](assets/notes/x".repeat(50_000),
    ] {
        let started = Instant::now();
        let _ = image_paths_in_body(&s, "vault:", ToOwned::to_owned);
        assert!(
            started.elapsed() < Duration::from_millis(1000),
            "slow on {}",
            s.get(..20).unwrap_or("")
        );
    }
}

// ---- Rust-only checks of the scanner contract ----

#[test]
fn replace_image_refs_passes_alt_head_rest_and_text() {
    let out = replace_image_refs(
        "x ![a](vault:p.png) y",
        &["vault:"],
        |r| {
            assert_eq!(r.alt, "a");
            assert_eq!(r.head, "vault:");
            assert_eq!(r.rest, "p.png");
            assert_eq!(r.text, "![a](vault:p.png)");
            Some("Z".to_owned())
        },
        false,
    );
    assert_eq!(out, "x Z y");
}

#[test]
fn replace_image_refs_matches_any_listed_head_like_an_alternation() {
    // `(vault|paperimg|reportimg):` in the TS blob-links head.
    let heads = ["vault:", "paperimg:", "reportimg:"];
    let out = replace_image_refs(
        "![](paperimg:a.png) ![](https://x/y.png) ![](reportimg:b.png)",
        &heads,
        |r| Some(format!("<{}>", r.rest)),
        false,
    );
    assert_eq!(out, "<a.png> ![](https://x/y.png) <b.png>");
}

#[test]
fn replace_image_refs_stops_a_target_at_whitespace_unless_allowed() {
    let body = "![a](vault:p q.png)";
    let tight = replace_image_refs(body, &["vault:"], |_| Some("X".to_owned()), false);
    assert_eq!(tight, body);
    let loose = replace_image_refs(body, &["vault:"], |_| Some("X".to_owned()), true);
    assert_eq!(loose, "X");
}

// ---- properties ----

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn escaped_alt_text_has_no_unescaped_brackets(alt in ".*") {
        let out = escape_markdown_alt_text(&alt);
        let chars: Vec<char> = out.chars().collect();
        for (i, ch) in chars.iter().enumerate() {
            if *ch == '[' || *ch == ']' {
                // A bracket is escaped when preceded by an odd run of backslashes.
                let run = chars[..i].iter().rev().take_while(|c| **c == '\\').count();
                prop_assert!(run % 2 == 1, "bare bracket in {out:?}");
            }
        }
    }

    #[test]
    fn identity_replacer_returns_the_input_unchanged(
        body in "[!\\[\\]()a-z:\\n ]{0,80}",
        allow_space in any::<bool>(),
    ) {
        let kept = replace_image_refs(
            &body,
            &["vault:"],
            |r| Some(r.text.to_owned()),
            allow_space,
        );
        prop_assert_eq!(&kept, &body);
        let declined = replace_image_refs(&body, &["vault:"], |_| None, allow_space);
        prop_assert_eq!(&declined, &body);
    }
}
