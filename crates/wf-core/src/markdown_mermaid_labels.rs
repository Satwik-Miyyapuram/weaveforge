//! Mermaid label quoting (wf-core `markdown_mermaid_labels`). Ported from `apps/web/src/lib/parts-2.ts`.
//!
//! Mermaid rejects `(`, `)` and `|` inside an unquoted `[label]` or `{label}`. A label
//! that needs it is quoted before the parser sees it; anything else is left byte for byte.

/// Brackets that open a label; the close must match the open (`[`→`]`, `{`→`}`).
const OPENS: [char; 2] = ['[', '{'];
/// Characters a label may not contain (the label is the run between open and close).
fn is_label_stop(c: char) -> bool {
    matches!(c, '[' | ']' | '{' | '}' | '"' | '\n')
}

/// Quote each unquoted label that holds `(`, `)` or `|`, unless its shape carries meaning
/// (`[(cylinder)]`, `[[subroutine]]`, `[/parallelogram/]`) or it is already quoted.
#[must_use]
pub fn quote_awkward_labels(code: &str) -> String {
    let chars: Vec<char> = code.chars().collect();
    let mut out = String::with_capacity(code.len());
    let mut pos = 0;
    while pos < chars.len() {
        if !OPENS.contains(&chars[pos]) {
            out.push(chars[pos]);
            pos += 1;
            continue;
        }
        // The label is the run of non-stop characters; a match needs a close right after it.
        let mut end = pos + 1;
        while end < chars.len() && !is_label_stop(chars[end]) {
            end += 1;
        }
        if end >= chars.len() || !matches!(chars[end], ']' | '}') {
            out.push(chars[pos]);
            pos += 1;
            continue;
        }
        let open = chars[pos];
        let close = chars[end];
        let label: String = chars[pos + 1..end].iter().collect();
        // A match is consumed whether or not it is rewritten, as the regex replace does.
        out.push(open);
        if needs_quotes(&label) && (open == '[' && close == ']' || open == '{' && close == '}') {
            out.push('"');
            out.push_str(&label);
            out.push('"');
        } else {
            out.push_str(&label);
        }
        out.push(close);
        pos = end + 1;
    }
    out
}

/// A label needs quotes when it has `(`, `)` or `|`, and it does not start or end with a
/// character that marks a special shape (`(`, `/`, `\`).
fn needs_quotes(label: &str) -> bool {
    if !label.contains(['(', ')', '|']) {
        return false;
    }
    let first = label.chars().next();
    let last = label.chars().next_back();
    let shaped = |c: Option<char>| matches!(c, Some('(' | '/' | '\\'));
    !(shaped(first) || shaped(last))
}

#[cfg(test)]
mod tests {
    use super::quote_awkward_labels;

    #[test]
    fn labels_with_parens_or_pipes_are_quoted() {
        assert_eq!(
            quote_awkward_labels(
                "flowchart LR\n  X[image] --> Q[q(z|x)]\n  G --> P[GIN prior p(z|G)]"
            ),
            "flowchart LR\n  X[image] --> Q[\"q(z|x)\"]\n  G --> P[\"GIN prior p(z|G)\"]"
        );
    }

    #[test]
    fn quoted_plain_and_shaped_labels_are_untouched() {
        let src = "A[\"q(z|x)\"] --> B[(db)] --> C[[sub]] --> D[/par/] --> E{KL} -->|edge (x)| F";
        assert_eq!(quote_awkward_labels(src), src);
    }

    #[test]
    fn mismatched_close_is_left_alone() {
        assert_eq!(quote_awkward_labels("[a(b}"), "[a(b}");
        assert_eq!(quote_awkward_labels("{a|b]"), "{a|b]");
    }

    #[test]
    fn nested_open_is_retried_after_a_failed_run() {
        assert_eq!(quote_awkward_labels("[[a(b)]]"), "[[\"a(b)\"]]");
    }

    #[test]
    fn brace_label_is_quoted_and_shape_edges_are_kept() {
        assert_eq!(quote_awkward_labels("N{x(1)}"), "N{\"x(1)\"}");
        assert_eq!(quote_awkward_labels("N[(a|b)]"), "N[(a|b)]");
        assert_eq!(quote_awkward_labels(r"N[\a|c]"), r"N[\a|c]");
    }

    #[test]
    fn unicode_passes_through() {
        assert_eq!(quote_awkward_labels("é[ü(ö)] 🙂"), "é[\"ü(ö)\"] 🙂");
    }
}
