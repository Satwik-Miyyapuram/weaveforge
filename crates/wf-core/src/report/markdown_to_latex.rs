//! Markdown to LaTeX subset for Overleaf export packages. Port of
//! `packages/core/src/features/report/domain/markdown-to-latex.ts`.
//! KaTeX HTML is never used: equations stay as raw TeX delimiters. `reportimg:` images become
//! `\includegraphics` under `figures/`, `[[Paper]]` wikilinks become `\cite{key}` when a cite
//! map is given, and other unsupported constructs become warnings.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::{Captures, Regex};
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::{compile, space_class};
use crate::reader_analysis::lines::js_trim;
use crate::vault::page::{WIKILINK_RE, normalize_title_key, parse_wikilink_inner};

/// JS `.` stops at these; the class spells out "any char but a line terminator".
const LINE_BREAKS: &str = "\r\n\u{2028}\u{2029}";
const VERBATIM_END: &str = "\\end{verbatim}";

static TABLE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        r"\|[^{lb}]+\|[\r\n]+\|[-:| ]+\|",
        lb = LINE_BREAKS
    ))
    .ok()
});
static HTML_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"<[^>]+>").ok());
/// Anchored at a `!`: an image whose target is not `reportimg:`. The lookahead of the TS is
/// checked by the caller on group 1.
static NON_REPORT_IMAGE_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r"^!\[[^\]]*\]\(([^){sp}]+)\)", sp = space_class())).ok());
static REPORT_IMG_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        r"!\[([^\]]*)\]\(reportimg:([^){sp}]+)\)",
        sp = space_class()
    ))
    .ok()
});
static HEADING_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r"^(#{{1,3}})\s+([^{lb}]*)$", lb = LINE_BREAKS)).ok());
static LIST_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r"^\s*[-*]\s+([^{lb}]*)$", lb = LINE_BREAKS)).ok());
static DISPLAY_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r"^\$\$([^{lb}]+)\$\$$", lb = LINE_BREAKS)).ok());
static BOLD_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\*\*([^*]+)\*\*").ok());
static EMPH_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(^|[^*])\*([^*]+)\*").ok());
static CODE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"`([^`]+)`").ok());
static HREF_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(&format!(
        r"\[([^\]]+)\]\((https?://[^){sp}]+)\)",
        sp = space_class()
    ))
    .ok()
});

/// One `reportimg:` figure: the storage path and the safe file name it is written under.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MarkdownToLatexImageRef {
    /// Storage path after `reportimg:`.
    pub path: String,
    /// Relative path used in `\includegraphics{...}` (under `figures/`).
    pub file_name: String,
}

/// Options for [`markdown_to_latex`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MarkdownToLatexOptions {
    /// Map of `normalizeTitleKey(paper.title)` to biblatex cite key. When set, matching
    /// `[[wikilinks]]` become `\cite{key}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::HashMap<String, String>)
    )]
    pub cite_by_title: Option<HashMap<String, String>>,
}

/// Converted body plus everything the export needs to package it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MarkdownToLatexResult {
    /// LaTeX body, no document wrapper.
    pub latex: String,
    /// Human-readable notes on anything left as text, commented or omitted.
    pub warnings: Vec<String>,
    /// Report figures in document order.
    pub images: Vec<MarkdownToLatexImageRef>,
    /// Bib keys emitted via `\cite{...}` (unique, insertion order).
    pub cited_keys: Vec<String>,
}

/// Escapes LaTeX special characters in plain text. A backslash is parked on U+0001 first, so
/// its `\textbackslash{}` is not escaped again.
#[must_use]
pub fn escape_latex_text(s: &str) -> String {
    let parked = s.replace('\\', "\u{1}");
    let mut out = String::with_capacity(parked.len());
    for c in parked.chars() {
        match c {
            '{' | '}' | '$' | '&' | '#' | '^' | '_' | '%' => {
                out.push('\\');
                out.push(c);
            }
            '~' => out.push_str("\\textasciitilde{}"),
            _ => out.push(c),
        }
    }
    out.replace('\u{1}', "\\textbackslash{}")
}

/// A figure file name safe in a LaTeX project and unique within `used`. Unsafe runs become
/// `_`; a repeat gets `_2`, `_3`, ... before its extension.
#[must_use]
pub fn unique_figure_name(raw: &str, used: &mut HashSet<String>) -> String {
    let safe = sanitize_figure_name(raw);
    let mut name = safe.clone();
    let mut n = 2_usize;
    while used.contains(&name) {
        name = match safe.rfind('.') {
            Some(dot) if dot > 0 => {
                let (stem, ext) = safe.split_at(dot);
                format!("{stem}_{n}{ext}")
            }
            _ => format!("{safe}_{n}"),
        };
        n += 1;
    }
    let _ = used.insert(name.clone());
    name
}

/// Convert a limited Markdown subset to LaTeX body (no document wrapper).
#[must_use]
pub fn markdown_to_latex(md: &str, opts: &MarkdownToLatexOptions) -> MarkdownToLatexResult {
    if js_trim(md).is_empty() {
        return MarkdownToLatexResult::default();
    }
    let (with_figures, images) = rewrite_report_images(md);
    let mut conv = Converter {
        cites: opts.cite_by_title.as_ref(),
        ..Converter::default()
    };
    for label in unsupported_labels(&with_figures) {
        conv.warnings.push(format!(
            "Unsupported Markdown: {label} — left as comments or omitted."
        ));
    }
    let normalized = with_figures.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    conv.convert_lines(&lines);
    conv.close_list();
    if conv.in_code {
        conv.warnings
            .push("Unclosed code fence — content omitted from export.".to_owned());
    }
    MarkdownToLatexResult {
        latex: js_trim(&conv.out.join("\n")).to_owned(),
        warnings: conv.warnings,
        images,
        cited_keys: conv.cited,
    }
}

/// Keeps `[A-Za-z0-9._-]`, folds each other run into one `_`, and falls back to `figure.bin`.
fn sanitize_figure_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_run = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('_');
            in_run = true;
        }
    }
    if out.is_empty() {
        "figure.bin".to_owned()
    } else {
        out
    }
}

/// Text of capture group `i`, or empty when it did not participate.
fn group<'t>(caps: &Captures<'t>, i: usize) -> &'t str {
    caps.get(i).map_or("", |m| m.as_str())
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

/// Runs `f` over every match of `re`; the regex-less fallback leaves `s` unchanged.
fn replace_each(re: Option<&Regex>, s: &str, f: impl Fn(&Captures) -> String) -> String {
    match re {
        Some(re) => re.replace_all(s, |caps: &Captures| f(caps)).into_owned(),
        None => s.to_owned(),
    }
}

/// Rewrite `![alt](reportimg:path)` into a LaTeX figure and collect asset refs.
fn rewrite_report_images(md: &str) -> (String, Vec<MarkdownToLatexImageRef>) {
    let Some(re) = REPORT_IMG_RE.as_ref() else {
        return (md.to_owned(), Vec::new());
    };
    let mut text = String::with_capacity(md.len());
    let mut images = Vec::new();
    let mut used = HashSet::new();
    let mut last = 0;
    for caps in re.captures_iter(md) {
        let Some(whole) = caps.get(0) else {
            continue;
        };
        let path = group(&caps, 2);
        let base = path.rsplit('/').next().filter(|s| !s.is_empty());
        let file_name = unique_figure_name(base.unwrap_or("figure.bin"), &mut used);
        let alt = js_trim(group(&caps, 1));
        let caption = escape_latex_text(if alt.is_empty() { "Figure" } else { alt });
        text.push_str(md.get(last..whole.start()).unwrap_or_default());
        text.push_str(&format!(
            "\n\\begin{{figure}}[ht]\n\\centering\n\\includegraphics[width=\\linewidth]{{figures/{file_name}}}\n\\caption{{{caption}}}\n\\end{{figure}}\n"
        ));
        images.push(MarkdownToLatexImageRef {
            path: path.to_owned(),
            file_name,
        });
        last = whole.end();
    }
    text.push_str(md.get(last..).unwrap_or_default());
    (text, images)
}

/// Labels of the unsupported constructs present in `text`, in the TS order.
fn unsupported_labels(text: &str) -> Vec<&'static str> {
    let mut labels = Vec::new();
    if TABLE_RE.as_ref().is_some_and(|re| re.is_match(text)) {
        labels.push("markdown table");
    }
    if HTML_RE.as_ref().is_some_and(|re| re.is_match(text)) {
        labels.push("raw HTML");
    }
    if has_non_report_image(text) {
        labels.push("non-report image (include assets separately)");
    }
    labels
}

/// The TS `!\[..\]\((?!reportimg:)..\)` has a lookahead, so each `!` is tested on its own.
fn has_non_report_image(text: &str) -> bool {
    text.match_indices('!').any(|(at, _)| {
        let rest = text.get(at..).unwrap_or_default();
        NON_REPORT_IMAGE_RE
            .as_ref()
            .and_then(|re| re.captures(rest))
            .and_then(|caps| {
                caps.get(1)
                    .map(|src| !src.as_str().starts_with("reportimg:"))
            })
            .unwrap_or(false)
    })
}

fn apply_inline_markdown(escaped: &str) -> String {
    let bold = replace_each(BOLD_RE.as_ref(), escaped, |c| {
        format!("\\textbf{{{}}}", group(c, 1))
    });
    let emph = replace_each(EMPH_RE.as_ref(), &bold, |c| {
        format!("{}\\emph{{{}}}", group(c, 1), group(c, 2))
    });
    replace_each(CODE_RE.as_ref(), &emph, |c| {
        format!("\\texttt{{{}}}", group(c, 1))
    })
}

/// `\` `{` `}` `%` `#` are escaped in a URL; nothing else is, since hyperref takes the rest.
fn escape_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    for c in url.chars() {
        if matches!(c, '\\' | '{' | '}' | '%' | '#') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escape raw markdown text, turning `[label](http…)` into `\href`. The URL is cut out before
/// escaping, so its `_`, `~` and `&` stay as written.
fn inline_text(raw: &str) -> String {
    let Some(re) = HREF_RE.as_ref() else {
        return apply_inline_markdown(&escape_latex_text(raw));
    };
    let mut out = String::new();
    let mut last = 0;
    for caps in re.captures_iter(raw) {
        let Some(whole) = caps.get(0) else {
            continue;
        };
        let before = raw.get(last..whole.start()).unwrap_or_default();
        out.push_str(&apply_inline_markdown(&escape_latex_text(before)));
        let url = escape_url(group(&caps, 2));
        let label = apply_inline_markdown(&escape_latex_text(group(&caps, 1)));
        out.push_str(&format!("\\href{{{url}}}{{{label}}}"));
        last = whole.end();
    }
    let tail = raw.get(last..).unwrap_or_default();
    out.push_str(&apply_inline_markdown(&escape_latex_text(tail)));
    out
}

/// Byte offset of `pat` in `s` at or after `from`.
fn find_from(s: &str, from: usize, pat: &str) -> Option<usize> {
    s.get(from..)?.find(pat).map(|p| p + from)
}

/// The TeX for a `$...$` or `$$...$$` span starting at byte `i`, and the byte after it.
fn math_at(s: &str, i: usize) -> Option<(String, usize)> {
    let bytes = s.as_bytes();
    if bytes.get(i) != Some(&b'$') {
        return None;
    }
    if bytes.get(i + 1) == Some(&b'$')
        && let Some(end) = find_from(s, i + 2, "$$")
    {
        let inner = s.get(i + 2..end).unwrap_or_default();
        return Some((format!("\\[{inner}\\]"), end + 2));
    }
    let end = find_from(s, i + 1, "$")?;
    let inner = s.get(i + 1..end).unwrap_or_default();
    (!inner.contains('\n')).then(|| (format!("${inner}$"), end + 1))
}

/// Per-document conversion state.
#[derive(Default)]
struct Converter<'a> {
    cites: Option<&'a HashMap<String, String>>,
    warnings: Vec<String>,
    cited: Vec<String>,
    out: Vec<String>,
    in_list: bool,
    in_code: bool,
    code_lang: String,
    code_buf: Vec<String>,
    in_figure: bool,
}

impl Converter<'_> {
    fn convert_lines(&mut self, lines: &[&str]) {
        let mut i = 0;
        while let Some(&line) = lines.get(i) {
            i = self.convert_line(lines, i, line) + 1;
        }
    }

    /// Converts `lines[i]` and returns the index of the last line it consumed.
    fn convert_line(&mut self, lines: &[&str], i: usize, line: &str) -> usize {
        if js_trim(line).starts_with("```") {
            self.toggle_fence(line);
            return i;
        }
        if self.in_code {
            self.code_buf.push(line.to_owned());
            return i;
        }
        // TikZ and other caller-made figure blocks are neither Markdown nor prose.
        if self.in_figure || line.starts_with("\\begin{figure}") {
            self.close_list();
            self.in_figure = js_trim(line) != "\\end{figure}";
            self.out.push(line.to_owned());
            return i;
        }
        if let Some(caps) = HEADING_RE.as_ref().and_then(|re| re.captures(line)) {
            self.close_list();
            let cmd = match group(&caps, 1).len() {
                1 => "section",
                2 => "subsection",
                _ => "subsubsection",
            };
            let text = self.text_with_cites(group(&caps, 2));
            self.out.push(format!("\\{cmd}{{{text}}}"));
            return i;
        }
        if let Some(caps) = LIST_RE.as_ref().and_then(|re| re.captures(line)) {
            if !self.in_list {
                self.out.push("\\begin{itemize}".to_owned());
                self.in_list = true;
            }
            let item = self.text_with_cites(group(&caps, 1));
            self.out.push(format!("\\item {item}"));
            return i;
        }
        if js_trim(line).is_empty() {
            self.close_list();
            self.out.push(String::new());
            return i;
        }
        if let Some(caps) = DISPLAY_RE
            .as_ref()
            .and_then(|re| re.captures(js_trim(line)))
        {
            self.close_list();
            self.out.push(format!("\\[{}\\]", group(&caps, 1)));
            return i;
        }
        if js_trim(line) == "$$" {
            let closing = lines
                .iter()
                .enumerate()
                .skip(i + 1)
                .find(|(_, c)| js_trim(c) == "$$")
                .map(|(j, _)| j);
            if let Some(closing) = closing {
                self.close_list();
                self.out.push("\\[".to_owned());
                for body in lines.get(i + 1..closing).unwrap_or_default() {
                    self.out.push((*body).to_owned());
                }
                self.out.push("\\]".to_owned());
                return closing;
            }
        }
        self.close_list();
        let converted = self.inline_to_latex(line);
        self.out.push(converted);
        i
    }

    /// Opens or closes a code fence. A closing fence flushes the buffered lines verbatim.
    fn toggle_fence(&mut self, line: &str) {
        if self.in_code {
            self.in_code = false;
            self.flush_code();
            return;
        }
        self.close_list();
        self.in_code = true;
        self.code_lang = js_trim(js_trim(line).get(3..).unwrap_or_default()).to_owned();
        self.code_buf.clear();
    }

    fn flush_code(&mut self) {
        self.out.push("\\begin{verbatim}".to_owned());
        let mut broke_closer = false;
        for code_line in std::mem::take(&mut self.code_buf) {
            // A literal closer would end the block early; the space keeps it as text.
            if code_line.contains(VERBATIM_END) {
                broke_closer = true;
                self.out
                    .push(code_line.replace(VERBATIM_END, "\\end {verbatim}"));
            } else {
                self.out.push(code_line);
            }
        }
        if broke_closer {
            self.warnings.push(
                "A code block held \\end{verbatim}; it is printed as \\end {verbatim}.".to_owned(),
            );
        }
        self.out.push(VERBATIM_END.to_owned());
        if !self.code_lang.is_empty() {
            self.warnings.push(format!(
                "Code fence language \"{}\" ignored in verbatim.",
                self.code_lang
            ));
        }
    }

    fn close_list(&mut self) {
        if self.in_list {
            self.out.push("\\end{itemize}".to_owned());
            self.in_list = false;
        }
    }

    /// The cite key for `target`, when the map has a non-empty one.
    fn lookup_cite(&self, target: &str) -> Option<String> {
        if target.is_empty() {
            return None;
        }
        self.cites?
            .get(&normalize_title_key(target))
            .filter(|key| !key.is_empty())
            .cloned()
    }

    /// Escape markdown text and turn matching `[[Paper]]` into `\cite{key}`. Unresolved links
    /// become escaped display text (alias or target).
    fn text_with_cites(&mut self, s: &str) -> String {
        if s.is_empty() {
            return String::new();
        }
        let Some(re) = WIKILINK_RE.as_ref() else {
            return inline_text(s);
        };
        let mut out = String::new();
        let mut last = 0;
        for caps in re.captures_iter(s) {
            let (Some(whole), Some(inner)) = (caps.get(0), caps.get(1)) else {
                continue;
            };
            let before = s.get(last..whole.start()).unwrap_or_default();
            out.push_str(&inline_text(before));
            let link = parse_wikilink_inner(inner.as_str(), whole.as_str());
            if let Some(key) = self.lookup_cite(&link.target) {
                out.push_str(&format!("\\cite{{{key}}}"));
                if !self.cited.contains(&key) {
                    self.cited.push(key);
                }
            } else {
                let label = link
                    .alias
                    .or_else(|| non_empty(&link.target))
                    .unwrap_or_else(|| js_trim(inner.as_str()).to_owned());
                out.push_str(&inline_text(&label));
                if !link.target.is_empty() && self.cites.is_some() {
                    self.warnings.push(format!(
                        "Wikilink [[{}]] is not a paper in the library — left as text.",
                        link.target
                    ));
                }
            }
            last = whole.end();
        }
        out.push_str(&inline_text(s.get(last..).unwrap_or_default()));
        out
    }

    /// Converts one line's inline text, keeping `$...$` and `$$...$$` spans as TeX.
    fn inline_to_latex(&mut self, s: &str) -> String {
        let bytes = s.as_bytes();
        let mut out = String::new();
        let mut i = 0;
        while i < bytes.len() {
            if let Some((value, next)) = math_at(s, i) {
                out.push_str(&value);
                i = next;
                continue;
            }
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] != b'$' {
                j += 1;
            }
            let text = s.get(i..j).unwrap_or_default();
            out.push_str(&self.text_with_cites(text));
            i = j;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        MarkdownToLatexImageRef, MarkdownToLatexOptions, MarkdownToLatexResult, markdown_to_latex,
    };

    fn convert(md: &str) -> MarkdownToLatexResult {
        markdown_to_latex(md, &MarkdownToLatexOptions::default())
    }

    #[test]
    fn converts_headings_emphasis_and_lists() {
        let r = convert("# Intro\n\nHello **world**\n\n- a\n- b");
        assert!(r.latex.contains("\\section{Intro}"), "{}", r.latex);
        assert!(r.latex.contains("\\textbf{world}"), "{}", r.latex);
        assert!(r.latex.contains("\\begin{itemize}"), "{}", r.latex);
        assert!(r.latex.contains("\\item a"), "{}", r.latex);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn preserves_inline_and_display_math_as_tex() {
        let r = convert("Energy $E=mc^2$\n\n$$\\int x$$");
        assert!(r.latex.contains("$E=mc^2$"), "{}", r.latex);
        assert!(r.latex.contains("\\[\\int x\\]"), "{}", r.latex);
    }

    #[test]
    fn converts_reportimg_figures_to_includegraphics() {
        let r = convert("See ![Plot A](reportimg:user/sec/a.webp) and more.");
        assert!(
            r.latex
                .contains("\\includegraphics[width=\\linewidth]{figures/a.webp}"),
            "{}",
            r.latex
        );
        assert!(r.latex.contains("\\caption{Plot A}"), "{}", r.latex);
        assert_eq!(
            r.images,
            vec![MarkdownToLatexImageRef {
                path: "user/sec/a.webp".to_owned(),
                file_name: "a.webp".to_owned(),
            }]
        );
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn still_warns_on_non_report_images() {
        let r = convert("![x](https://example.com/x.png)");
        assert!(
            r.warnings.iter().any(|w| w.contains("non-report image")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn turns_wikilink_into_cite_when_mapped() {
        let cites: HashMap<String, String> =
            HashMap::from([("a paper".to_owned(), "doi_10_1234".to_owned())]);
        let opts = MarkdownToLatexOptions {
            cite_by_title: Some(cites),
        };
        let r = markdown_to_latex("As shown in [[A Paper]] and [[A Paper|short]].", &opts);
        assert!(
            r.latex
                .contains("As shown in \\cite{doi_10_1234} and \\cite{doi_10_1234}."),
            "{}",
            r.latex
        );
        assert_eq!(r.cited_keys, vec!["doi_10_1234".to_owned()]);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn leaves_unresolved_wikilinks_as_text_with_a_warning() {
        let cites: HashMap<String, String> =
            HashMap::from([("a paper".to_owned(), "k1".to_owned())]);
        let opts = MarkdownToLatexOptions {
            cite_by_title: Some(cites),
        };
        let r = markdown_to_latex("See [[Unknown Note]].", &opts);
        assert!(r.latex.contains("See Unknown Note."), "{}", r.latex);
        assert!(!r.latex.contains("\\cite"), "{}", r.latex);
        assert!(
            r.warnings.iter().any(|w| w.contains("[[Unknown Note]]")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn passes_a_whole_figure_block_through_untouched() {
        // Stands in for a TikZ PRISMA figure: every line between the delimiters must survive.
        let tex = [
            "\\begin{figure}[ht]",
            "\\centering",
            "\\begin{tikzpicture}",
            "\\node {Identified: 10};",
            "\\end{tikzpicture}",
            "\\label{fig:prisma}",
            "\\end{figure}",
        ]
        .join("\n");
        let r = convert(&format!("Before.\n\n{tex}\n\nAfter."));
        assert!(r.latex.contains("\\begin{tikzpicture}"), "{}", r.latex);
        assert!(r.latex.contains("\\label{fig:prisma}"), "{}", r.latex);
        assert!(r.latex.contains("\\node {Identified: 10};"), "{}", r.latex);
        assert!(!r.latex.contains("\\textbackslash"), "{}", r.latex);
        assert!(r.latex.contains("Before."), "{}", r.latex);
        assert!(r.latex.contains("After."), "{}", r.latex);
    }

    #[test]
    fn keeps_a_link_url_raw_and_escapes_only_its_label() {
        let r = convert("See [a_b **x**](https://x.org/a_b~c&d%20#f) now_ok");
        assert!(
            r.latex
                .contains(r"\href{https://x.org/a_b~c&d\%20\#f}{a\_b \textbf{x}}"),
            "{}",
            r.latex
        );
        assert!(r.latex.contains(r"now\_ok"), "{}", r.latex);
    }

    #[test]
    fn keeps_a_code_fence_end_verbatim_inside_the_block() {
        let md = [
            "```tex",
            r"before \end{verbatim} and \end{verbatim} again",
            r"\input{rest}",
            "```",
            "",
            "After.",
        ]
        .join("\n");
        let r = convert(&md);

        // Only the block's own closer ends the verbatim; the rest stays code.
        assert_eq!(r.latex.matches(r"\end{verbatim}").count(), 1, "{}", r.latex);
        assert!(
            r.latex
                .contains(r"before \end {verbatim} and \end {verbatim} again"),
            "{}",
            r.latex
        );
        let input_at = r.latex.find(r"\input{rest}");
        let closer_at = r.latex.find(r"\end{verbatim}");
        assert!(
            matches!((input_at, closer_at), (Some(a), Some(b)) if a < b),
            "{}",
            r.latex
        );
        assert!(r.latex.contains("After."), "{}", r.latex);
        assert_eq!(
            r.warnings
                .iter()
                .filter(|w| w.contains("end{verbatim}"))
                .count(),
            1,
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn leaves_a_plain_code_fence_unchanged_and_unwarned() {
        let r = convert("```\nx = {1}\n```");
        assert!(
            r.latex
                .contains("\\begin{verbatim}\nx = {1}\n\\end{verbatim}"),
            "{}",
            r.latex
        );
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn leaves_non_http_brackets_as_text() {
        let r = convert("[a_b](ftp://x_y)");
        assert!(!r.latex.contains(r"\href"), "{}", r.latex);
        assert!(r.latex.contains(r"a\_b"), "{}", r.latex);
    }
}
