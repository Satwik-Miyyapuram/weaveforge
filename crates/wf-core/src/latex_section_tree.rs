//! Best-effort LaTeX section outline over a project's source files. Port of
//! `latex-section-tree.ts`: no TeX compilation; unresolved includes become warnings.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;

/// JS `\s` character set body, spliced into regex classes.
const WS: &str = "\t\n\u{0B}\u{0C}\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

/// One source file of a LaTeX project.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LatexSourceFile {
    /// Path relative to the project root.
    pub path: String,
    /// Full file text.
    pub content: String,
}

/// A sectioning command and the source span it governs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LatexSectionNode {
    /// `{file}:{line}:{localIndex}`, both 1-based.
    pub id: String,
    /// Heading text with commands, comments and braces removed.
    pub title: String,
    /// Base command name, e.g. `section` for `\section*`.
    pub command: String,
    /// 0 for `part` through 6 for `subparagraph`.
    pub level: u8,
    /// Normalized path of the file holding the heading.
    pub file: String,
    /// 1-based line of the heading.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub start_line: usize,
    /// 1-based last line of the span.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub end_line: usize,
    /// Short plain-text excerpt of the body, at most 240 chars.
    pub preview: String,
    /// Nested sections.
    pub children: Vec<LatexSectionNode>,
}

/// Outline of a LaTeX project.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LatexSectionTree {
    /// Top-level sections.
    pub roots: Vec<LatexSectionNode>,
    /// Normalized paths of the files visited, in visit order.
    pub files: Vec<String>,
    /// Include problems, in the order found.
    pub warnings: Vec<String>,
}

static SECTION_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^[{WS}]*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[{WS}]*(?:\[[^\]]*\][{WS}]*)?\{{([^{{}}]*)\}}"
    ))
    .ok()
});
static INCLUDE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"\\(?:input|include)\b[{WS}]*(?:\{{([^}}]+)\}}|([^{WS}%]+))"
    ))
    .ok()
});
static COMMENT_TAIL_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new("%[^\n\r\u{2028}\u{2029}]*$").ok());
static COMMENT_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new("%[^\n\r\u{2028}\u{2029}]*").ok());
static CMD_TITLE_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r"\\[a-zA-Z]+[{WS}]*")).ok());
static PREVIEW_CMD_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r"\\[a-zA-Z]+(?:[{WS}]|\[(?s:.)\]+|\{{[^}}]*\}})*")).ok());
static BRACES_RE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new("[{}]").ok());
static PREVIEW_DELIM_RE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new("[{}$]").ok());
static WS_RUN_RE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(&format!("[{WS}]+")).ok());

/// JS `trim()` / `\s` membership for one char.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Replaces every match; a regex that failed to compile matches nothing.
fn replace_all(re: &LazyLock<Option<Regex>>, text: &str, rep: &str) -> String {
    match re.as_ref() {
        Some(re) => re.replace_all(text, rep).into_owned(),
        None => text.to_owned(),
    }
}

fn level_of(command: &str) -> u8 {
    match command {
        "part" => 0,
        "chapter" => 1,
        "section" => 2,
        "subsection" => 3,
        "subsubsection" => 4,
        "paragraph" => 5,
        // subparagraph: the only other command the section regex admits
        _ => 6,
    }
}

/// Project path with `.tex` appended and `..` folded in; None if it climbs out or is empty.
fn normalize_path(path: &str) -> Option<String> {
    let with_ext = if path.ends_with(".tex") {
        path.to_owned()
    } else {
        format!("{path}.tex")
    };
    let slashed = with_ext.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for part in slashed.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                let _parent = parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    let joined = parts.join("/");
    (!joined.is_empty()).then_some(joined)
}

/// Include path resolved against the directory of `current` (a normalized path).
fn resolve_include(current: &str, include: &str) -> Option<String> {
    let base = current.rfind('/').map_or("", |i| &current[..i]);
    if base.is_empty() {
        normalize_path(include)
    } else {
        normalize_path(&format!("{base}/{include}"))
    }
}

fn clean_title(title: &str) -> String {
    let text = replace_all(&COMMENT_TAIL_RE, title, "");
    let text = replace_all(&CMD_TITLE_RE, &text, "");
    let text = replace_all(&BRACES_RE, &text, "");
    let text = replace_all(&WS_RUN_RE, &text, " ");
    text.trim_matches(is_js_space).to_owned()
}

/// Plain-text excerpt of `lines[start..end]`, clamped to bounds.
fn preview_body(lines: &[&str], start: usize, end: usize) -> String {
    let end = end.min(lines.len());
    let start = start.min(end);
    // Joined before the comment strip on purpose: a `%` also drops later lines.
    let joined = lines[start..end].join(" ");
    let text = replace_all(&COMMENT_RE, &joined, "");
    let text = replace_all(&PREVIEW_CMD_RE, &text, " ");
    let text = replace_all(&PREVIEW_DELIM_RE, &text, "");
    let text = replace_all(&WS_RUN_RE, &text, " ");
    text.trim_matches(is_js_space).chars().take(240).collect()
}

/// Arena node: the public node fields plus child indices.
struct Flat {
    id: String,
    title: String,
    command: String,
    level: u8,
    file: String,
    start_line: usize,
    end_line: usize,
    preview: String,
    children: Vec<usize>,
}

/// Shared state for one parse; the section stack spans files.
struct Ctx<'a> {
    sources: HashMap<String, &'a str>,
    arena: Vec<Flat>,
    roots: Vec<usize>,
    stack: Vec<usize>,
    active: HashSet<String>,
    files: Vec<String>,
    warnings: Vec<String>,
}

fn scan_line(
    ctx: &mut Ctx<'_>,
    file: &str,
    index: usize,
    line: &str,
    local: &mut Vec<usize>,
    line_count: usize,
) {
    if let Some(caps) = SECTION_RE.as_ref().and_then(|re| re.captures(line)) {
        let command = caps.get(1).map_or("", |m| m.as_str());
        let title = caps.get(2).map_or("", |m| m.as_str());
        let level = level_of(command);
        while ctx
            .stack
            .last()
            .is_some_and(|&top| ctx.arena[top].level >= level)
        {
            let _popped = ctx.stack.pop();
        }
        let node = ctx.arena.len();
        ctx.arena.push(Flat {
            id: format!("{file}:{}:{}", index + 1, local.len() + 1),
            title: clean_title(title),
            command: command.to_owned(),
            level,
            file: file.to_owned(),
            start_line: index + 1,
            end_line: line_count,
            preview: String::new(),
            children: Vec::new(),
        });
        match ctx.stack.last().copied() {
            Some(parent) => ctx.arena[parent].children.push(node),
            None => ctx.roots.push(node),
        }
        local.push(node);
        ctx.stack.push(node);
    }
    if let Some(re) = INCLUDE_RE.as_ref() {
        for caps in re.captures_iter(line) {
            let raw = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map_or("", |m| m.as_str());
            match resolve_include(file, raw) {
                Some(child) => visit(ctx, &child),
                None => ctx
                    .warnings
                    .push(format!("Unsafe include path ignored: {raw}")),
            }
        }
    }
}

/// Sets each local section's span and preview, then pops this file's sections off the stack.
fn link_sections(ctx: &mut Ctx<'_>, local: &[usize], lines: &[&str]) {
    for (pos, &idx) in local.iter().enumerate() {
        let start = ctx.arena[idx].start_line;
        let end = local
            .get(pos + 1)
            .map_or(lines.len(), |&next| ctx.arena[next].start_line - 1);
        ctx.arena[idx].end_line = end;
        ctx.arena[idx].preview = preview_body(lines, start, end);
    }
    for &idx in local.iter().rev() {
        if ctx.stack.last() == Some(&idx) {
            let _popped = ctx.stack.pop();
        }
    }
}

fn visit(ctx: &mut Ctx<'_>, file_path: &str) {
    let Some(normalized) = normalize_path(file_path) else {
        ctx.warnings
            .push(format!("Unsafe include path ignored: {file_path}"));
        return;
    };
    if ctx.active.contains(&normalized) {
        ctx.warnings
            .push(format!("Circular include ignored: {normalized}"));
        return;
    }
    let Some(content) = ctx.sources.get(&normalized).copied() else {
        ctx.warnings
            .push(format!("Included file not found: {normalized}"));
        return;
    };
    let _added = ctx.active.insert(normalized.clone());
    ctx.files.push(normalized.clone());
    let text = content.replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut local: Vec<usize> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        scan_line(ctx, &normalized, index, line, &mut local, lines.len());
    }
    link_sections(ctx, &local, &lines);
    let _removed = ctx.active.remove(&normalized);
}

fn build_node(arena: &[Flat], idx: usize) -> LatexSectionNode {
    let flat = &arena[idx];
    LatexSectionNode {
        id: flat.id.clone(),
        title: flat.title.clone(),
        command: flat.command.clone(),
        level: flat.level,
        file: flat.file.clone(),
        start_line: flat.start_line,
        end_line: flat.end_line,
        preview: flat.preview.clone(),
        children: flat
            .children
            .iter()
            .map(|&child| build_node(arena, child))
            .collect(),
    }
}

/// Builds the section outline from `entry_file` (TS default `main.tex`) following includes.
#[must_use]
pub fn parse_latex_section_tree(sources: &[LatexSourceFile], entry_file: &str) -> LatexSectionTree {
    let mut by_path: HashMap<String, &str> = HashMap::new();
    for source in sources {
        if let Some(path) = normalize_path(&source.path) {
            let _previous = by_path.insert(path, source.content.as_str());
        }
    }
    let mut ctx = Ctx {
        sources: by_path,
        arena: Vec::new(),
        roots: Vec::new(),
        stack: Vec::new(),
        active: HashSet::new(),
        files: Vec::new(),
        warnings: Vec::new(),
    };
    visit(&mut ctx, entry_file);
    let roots = ctx
        .roots
        .iter()
        .map(|&idx| build_node(&ctx.arena, idx))
        .collect();
    LatexSectionTree {
        roots,
        files: ctx.files,
        warnings: ctx.warnings,
    }
}
