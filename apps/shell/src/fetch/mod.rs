//! Fetches the shell makes for pasted links: URL safety checks and page titles.
//!
//! Ported from `packages/core/src/net/` and `apps/web/src/backend/net/`.

pub mod page_title;

pub mod url_shape;

pub mod paste;

/// True for the characters JavaScript's `\s` and `String.prototype.trim` treat as
/// whitespace. Rust's `char::is_whitespace` differs (it has U+0085, lacks U+FEFF),
/// so the ports of TS string code use this instead.
#[must_use]
pub const fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}
