//! Fingerprints and passage ids for the semantic index. Port of `textHash`, `documentIdOf` and
//! `embeddableText` in `apps/web/src/features/search/application/semantic-index.ts`.
//!
//! The text hash is persisted beside the vectors, so it must stay bit-identical to the TypeScript
//! it replaces: FNV-1a over UTF-16 code units, written in base 36 with the length.

use crate::search::js_text::is_js_whitespace;

const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;
const BASE36_DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// `n` in lowercase base 36, as JavaScript's `Number#toString(36)` writes it.
fn to_base36(mut n: u64) -> String {
    let mut digits = Vec::new();
    loop {
        digits.push(char::from(BASE36_DIGITS[(n % 36) as usize]));
        n /= 36;
        if n == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}

/// A short fingerprint of the text a document was embedded from, as `hash.length` in base 36.
///
/// Stored beside the vectors so a reload can tell which documents changed while the app was
/// closed. A collision costs one stale vector until the next edit, never a wrong result elsewhere.
#[must_use]
pub fn text_hash(text: &str) -> String {
    let mut hash = FNV_OFFSET;
    let mut units: u64 = 0;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
        units += 1;
    }
    format!("{}.{}", to_base36(u64::from(hash)), to_base36(units))
}

/// The document a passage belongs to: `note:n1#2` becomes `note:n1`. An id without a `#` is its
/// own document, and only the last `#` marks the passage.
#[must_use]
pub fn document_id_of(passage: &str) -> String {
    match passage.rfind('#') {
        Some(at) => passage[..at].to_owned(),
        None => passage.to_owned(),
    }
}

/// Text worth embedding for a document: the title and aliases joined by `. `, then the trimmed
/// body. The title is repeated into the first passage because a short note is often only its
/// title, and a body-only vector for "Attention" carries almost nothing.
#[must_use]
pub fn embeddable_text(title: &str, aliases: &[String], body: &str) -> String {
    let head = std::iter::once(title)
        .chain(aliases.iter().map(String::as_str))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(". ");
    let body = body.trim_matches(is_js_whitespace);
    if body.is_empty() {
        head
    } else {
        format!("{head}. {body}")
    }
}

/// The document id behind a workspace file name: its base name with the extension taken off.
///
/// The folder writes one file per entry, named for its id.
#[must_use]
pub fn document_id_of_path(file: &str) -> String {
    let base = file.rsplit('/').next().unwrap_or(file);
    match base.rfind('.') {
        Some(dot) if dot > 0 => base[..dot].to_owned(),
        _ => base.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_id_of_path_strips_folder_and_extension() {
        assert_eq!(document_id_of_path("notes/note:a.md"), "note:a");
        assert_eq!(document_id_of_path(".hidden"), ".hidden");
        assert_eq!(document_id_of_path("plain"), "plain");
    }

    #[test]
    fn text_hash_matches_the_stored_format() {
        assert_eq!(text_hash(""), "ztntfp.0");
        assert_eq!(text_hash("a"), "1r9wi7g.1");
        assert_eq!(text_hash("héllo 😀 wörld"), "1qs8wzt.e");
    }

    #[test]
    fn passage_ids_carry_their_document() {
        assert_eq!(document_id_of("note:a#3"), "note:a");
        assert_eq!(document_id_of("note:a"), "note:a");
        assert_eq!(document_id_of("pdf:p1:12#0"), "pdf:p1:12");
    }

    #[test]
    fn embeddable_text_repeats_title_and_trims_body() {
        assert_eq!(
            embeddable_text(
                "Attention",
                &["Transformer".to_owned()],
                "  Scaled dot product  "
            ),
            "Attention. Transformer. Scaled dot product"
        );
        assert_eq!(embeddable_text("Attention", &[], "  "), "Attention");
    }
}
