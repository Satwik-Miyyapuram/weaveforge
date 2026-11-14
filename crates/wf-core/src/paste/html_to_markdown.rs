//! Clipboard HTML to Markdown for "paste with formatting".
//!
//! Browsers, Word and Google Docs put HTML on the clipboard beside the plain
//! text. Pasting the plain text loses the bold, links and tables the user copied,
//! so this converts the HTML that survives a copy. The tokenizer is tolerant on
//! purpose: clipboard HTML is often fragmentary, and a strict parser would drop
//! the whole paste.

/// Converts clipboard HTML to Markdown. Empty or tag-only input gives "".
#[must_use]
pub fn html_to_markdown(html: &str) -> String {
    if html.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let tree = build_tree(tokenize(cf_html_fragment(html)));
    tidy(&blocks(&tree, 0).join("\n\n"))
}

/// Clipboard HTML may carry a CF_HTML header; keep only the fragment it marks.
fn cf_html_fragment(html: &str) -> &str {
    const START: &str = "<!--StartFragment-->";
    const END: &str = "<!--EndFragment-->";
    if !html.starts_with("Version:") || !html.contains("StartFragment") {
        return html;
    }
    let fragment = html
        .find(START)
        .zip(html.find(END))
        .and_then(|(start, end)| html.get(start + START.len()..end));
    if let Some(fragment) = fragment {
        return fragment;
    }
    let mut rest = html;
    while let Some((line, after)) = rest.split_once('\n') {
        if !is_cf_header_line(line.trim_end_matches('\r')) {
            break;
        }
        rest = after;
    }
    rest
}

/// A header line such as `StartHTML:000` or `Version:0.9`.
fn is_cf_header_line(line: &str) -> bool {
    line.split_once(':').is_some_and(|(key, value)| {
        !key.is_empty()
            && key.bytes().all(|b| b.is_ascii_alphabetic())
            && !value.is_empty()
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'.' || b == b'-')
    })
}

/// Inputs over this are not a note's paste; the caller falls back to plain text.
const MAX_INPUT_BYTES: usize = 2_000_000;
/// Deeper nesting is rendered as text only, so hostile input cannot overflow the stack.
const MAX_DEPTH: usize = 200;
/// CommonMark allows at most nine digits in an ordered list number.
const MAX_LIST_NUMBER: u32 = 999_999_999;
const VOID_TAGS: &[&str] = &[
    "br", "img", "hr", "meta", "link", "input", "col", "area", "base", "wbr", "source",
];
/// Tags whose contents are never shown.
const SKIPPED_TAGS: &[&str] = &[
    "script", "style", "head", "title", "meta", "link", "noscript", "template", "svg", "math",
    "iframe", "object",
];
const BLOCK_TAGS: &[&str] = &[
    "p",
    "div",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "aside",
    "figure",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "pre",
    "ul",
    "ol",
    "table",
];

type Attrs = Vec<(String, String)>;

enum Token {
    Start {
        name: String,
        attrs: Attrs,
        self_closing: bool,
    },
    End(String),
    Text(String),
}

enum Node {
    Element {
        tag: String,
        attrs: Attrs,
        children: Vec<Node>,
    },
    Text(String),
}

/// An element still open while the tree is being built.
struct Frame {
    tag: String,
    attrs: Attrs,
    children: Vec<Node>,
}

fn tokenize(html: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut rest = html;
    while !rest.is_empty() {
        let Some(lt) = rest.find('<') else {
            push_text(&mut tokens, rest);
            break;
        };
        if lt > 0 {
            push_text(&mut tokens, &rest[..lt]);
            rest = &rest[lt..];
            continue;
        }
        rest = match read_markup(rest, &mut tokens) {
            Ok(next) => skip_raw_text(next, &mut tokens),
            // Unclosed markup swallows the rest, so rescanning from the next byte would be quadratic.
            Err(Stray::Unterminated) => {
                push_text(&mut tokens, rest);
                break;
            }
            Err(Stray::NotATag) => {
                tokens.push(Token::Text("<".to_string()));
                &rest[1..]
            }
        };
    }
    tokens
}

/// Why `read_markup` could not read a tag at the start of its input.
enum Stray {
    /// No closing `>` or quote before the end of the input.
    Unterminated,
    /// A `<` that starts no tag.
    NotATag,
}

const RAW_TEXT_TAGS: &[&str] = &["script", "style", "textarea", "title"];

/// Skips the body of a raw-text element that just opened, up to its end tag.
fn skip_raw_text<'a>(rest: &'a str, tokens: &mut Vec<Token>) -> &'a str {
    let name = match tokens.last() {
        Some(Token::Start {
            name,
            self_closing: false,
            ..
        }) if RAW_TEXT_TAGS.contains(&name.as_str()) => name.clone(),
        _ => return rest,
    };
    let end = find_end_tag(rest, &name).unwrap_or(rest.len());
    if name == "textarea" || name == "title" {
        push_text(tokens, &rest[..end]);
    }
    &rest[end..]
}

/// Finds `</name` ignoring ASCII case; `match_indices` keeps this linear.
fn find_end_tag(rest: &str, name: &str) -> Option<usize> {
    let close = format!("</{name}");
    rest.match_indices('<')
        .map(|(index, _)| index)
        .find(|&index| {
            rest.get(index..index + close.len())
                .is_some_and(|found| found.eq_ignore_ascii_case(&close))
        })
}

fn push_text(tokens: &mut Vec<Token>, text: &str) {
    if !text.is_empty() {
        tokens.push(Token::Text(decode_entities(text)));
    }
}

/// Reads one tag, comment or declaration at the start of `rest`.
fn read_markup<'a>(rest: &'a str, tokens: &mut Vec<Token>) -> Result<&'a str, Stray> {
    if let Some(body) = rest.strip_prefix("<!--") {
        return Ok(skip_past(body, "-->"));
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
        return Ok(skip_past(&rest[1..], ">"));
    }
    if let Some(body) = rest.strip_prefix("</") {
        let (name, tail) = take_name(body);
        if name.is_empty() {
            return Err(Stray::NotATag);
        }
        let close = tail.find('>').ok_or(Stray::Unterminated)?;
        tokens.push(Token::End(name.to_ascii_lowercase()));
        return Ok(&tail[close + 1..]);
    }
    let body = &rest[1..];
    if !body.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return Err(Stray::NotATag);
    }
    read_start_tag(body, tokens)
}

fn read_start_tag<'a>(body: &'a str, tokens: &mut Vec<Token>) -> Result<&'a str, Stray> {
    let (name, mut tail) = take_name(body);
    let mut attrs = Attrs::new();
    let mut self_closing = false;
    loop {
        tail = tail.trim_start();
        if let Some(after) = tail.strip_prefix("/>") {
            self_closing = true;
            tail = after;
            break;
        }
        if let Some(after) = tail.strip_prefix('>') {
            tail = after;
            break;
        }
        if tail.is_empty() {
            return Err(Stray::Unterminated);
        }
        if let Some(after) = tail.strip_prefix('/') {
            tail = after;
            continue;
        }
        let (attr, after_name) = take_while(tail, |c: char| {
            !c.is_whitespace() && !matches!(c, '=' | '>' | '/')
        });
        if attr.is_empty() {
            // A stray `=` with no name before it.
            tail = &tail[1..];
            continue;
        }
        tail = after_name.trim_start();
        let mut value = "";
        if let Some(after_eq) = tail.strip_prefix('=') {
            let (raw, after_value) = read_attr_value(after_eq.trim_start());
            value = raw;
            tail = after_value;
        }
        attrs.push((attr.to_ascii_lowercase(), decode_entities(value)));
    }
    tokens.push(Token::Start {
        name: name.to_ascii_lowercase(),
        attrs,
        self_closing,
    });
    Ok(tail)
}

/// Splits an attribute value off the front of `s`: quoted, or bare up to whitespace or `>`.
fn read_attr_value(s: &str) -> (&str, &str) {
    if let Some(quote) = s.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let body = &s[1..];
        return match body.find(quote) {
            Some(end) => (&body[..end], &body[end + 1..]),
            None => (body, ""),
        };
    }
    let end = s
        .find(|c: char| c.is_whitespace() || c == '>')
        .unwrap_or(s.len());
    (&s[..end], &s[end..])
}

fn take_while(s: &str, keep: impl Fn(char) -> bool) -> (&str, &str) {
    let end = s.find(|c: char| !keep(c)).unwrap_or(s.len());
    (&s[..end], &s[end..])
}

fn take_name(s: &str) -> (&str, &str) {
    take_while(s, |c| !c.is_whitespace() && c != '/' && c != '>')
}

fn skip_past<'a>(s: &'a str, pat: &str) -> &'a str {
    match s.find(pat) {
        Some(index) => &s[index + pat.len()..],
        None => "",
    }
}

fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        match decode_reference(rest) {
            Some((ch, len)) => {
                out.push(ch);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Decodes the reference at the start of `s`, returning the char and its byte length.
fn decode_reference(s: &str) -> Option<(char, usize)> {
    // A bounded window keeps a stray `&` from scanning the whole text for a `;`.
    let mut end = s.len().min(12);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    let window = s.get(1..end)?;
    let semi = window.find(';')?;
    let ch = match window.get(..semi)? {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "laquo" => '«',
        "raquo" => '»',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "euro" => '€',
        "pound" => '£',
        "yen" => '¥',
        "deg" => '°',
        "middot" => '·',
        "bull" => '•',
        "times" => '×',
        "divide" => '÷',
        "eacute" => 'é',
        "egrave" => 'è',
        "aacute" => 'á',
        "agrave" => 'à',
        "uuml" => 'ü',
        "ouml" => 'ö',
        "auml" => 'ä',
        "ccedil" => 'ç',
        "ntilde" => 'ñ',
        "szlig" => 'ß',
        "shy" => '\u{AD}',
        name => numeric_reference(name)?,
    };
    Some((ch, semi + 2))
}

fn numeric_reference(name: &str) -> Option<char> {
    let code = match name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
        None => name.strip_prefix('#')?.parse::<u32>().ok()?,
    };
    // Zero, surrogates and out-of-range codes are not characters.
    Some(match char::from_u32(code) {
        Some(ch) if code != 0 => ch,
        _ => '\u{FFFD}',
    })
}

fn build_tree(tokens: Vec<Token>) -> Vec<Node> {
    let mut stack = vec![Frame {
        tag: String::new(),
        attrs: Attrs::new(),
        children: Vec::new(),
    }];
    for token in tokens {
        match token {
            Token::Text(text) => push_child(&mut stack, Node::Text(text)),
            Token::End(name) => {
                // An end tag with no open match is ignored.
                if let Some(index) = stack.iter().rposition(|frame| frame.tag == name) {
                    close_to(&mut stack, index);
                }
            }
            Token::Start {
                name,
                attrs,
                self_closing,
            } => {
                implicit_close(&mut stack, &name);
                if VOID_TAGS.contains(&name.as_str()) || self_closing {
                    push_child(
                        &mut stack,
                        Node::Element {
                            tag: name,
                            attrs,
                            children: Vec::new(),
                        },
                    );
                } else if stack.len() <= MAX_DEPTH {
                    // Too deep to open: the tag is dropped and its content stays in the parent.
                    stack.push(Frame {
                        tag: name,
                        attrs,
                        children: Vec::new(),
                    });
                }
            }
        }
    }
    while stack.len() > 1 {
        close_top(&mut stack);
    }
    match stack.into_iter().next() {
        Some(root) => root.children,
        None => Vec::new(),
    }
}

fn push_child(stack: &mut [Frame], node: Node) {
    if let Some(top) = stack.last_mut() {
        top.children.push(node);
    }
}

fn close_top(stack: &mut Vec<Frame>) {
    if stack.len() < 2 {
        return;
    }
    if let Some(frame) = stack.pop() {
        push_child(
            stack,
            Node::Element {
                tag: frame.tag,
                attrs: frame.attrs,
                children: frame.children,
            },
        );
    }
}

fn close_to(stack: &mut Vec<Frame>, index: usize) {
    while stack.len() > index.max(1) {
        close_top(stack);
    }
}

/// A new `li`, `p`, `tr` or cell closes the still-open one of its kind, unless a barrier sits between.
fn implicit_close(stack: &mut Vec<Frame>, name: &str) {
    let (targets, barriers): (&[&str], &[&str]) = match name {
        "li" => (&["li"][..], &["ul", "ol"][..]),
        "p" => (&["p"][..], &["div", "li", "td", "th", "blockquote"][..]),
        "tr" => (&["tr"][..], &["table"][..]),
        "td" | "th" => (&["td", "th"][..], &["tr", "table"][..]),
        _ => return,
    };
    for index in (1..stack.len()).rev() {
        let tag = stack[index].tag.as_str();
        if targets.contains(&tag) {
            close_to(stack, index);
            return;
        }
        if barriers.contains(&tag) {
            return;
        }
    }
}

fn raw_text(nodes: &[Node]) -> String {
    let mut out = String::new();
    let mut pending: Vec<&Node> = nodes.iter().rev().collect();
    while let Some(node) = pending.pop() {
        match node {
            Node::Text(text) => out.push_str(text),
            Node::Element { tag, children, .. } => {
                if tag.as_str() == "br" {
                    out.push('\n');
                } else {
                    pending.extend(children.iter().rev());
                }
            }
        }
    }
    out
}

fn attr<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(key, _)| key.as_str() == name)
        .map(|(_, value)| value.as_str())
}

/// The value of one CSS property in an inline `style`, spaces removed and lowercased.
fn style_prop(style: &str, prop: &str) -> Option<String> {
    style.split(';').find_map(|declaration| {
        let (key, value) = declaration.split_once(':')?;
        key.trim().eq_ignore_ascii_case(prop).then(|| {
            value
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
                .to_ascii_lowercase()
        })
    })
}

fn blocks(nodes: &[Node], depth: usize) -> Vec<String> {
    if depth > MAX_DEPTH {
        let text = collapse_ws(&raw_text(nodes));
        let text = text.trim();
        return if text.is_empty() {
            Vec::new()
        } else {
            vec![escape_text(text)]
        };
    }
    let mut out = Vec::new();
    let mut run_start = 0;
    for (index, node) in nodes.iter().enumerate() {
        let Some(parts) = block_parts(node, depth) else {
            continue;
        };
        out.extend(paragraph(&nodes[run_start..index], depth));
        out.extend(parts);
        run_start = index + 1;
    }
    out.extend(paragraph(&nodes[run_start..], depth));
    out
}

/// The output of a block-level node, or `None` when the node is inline content.
fn block_parts(node: &Node, depth: usize) -> Option<Vec<String>> {
    let Node::Element {
        tag,
        attrs,
        children,
    } = node
    else {
        return None;
    };
    let tag = tag.as_str();
    if SKIPPED_TAGS.contains(&tag) {
        return None;
    }
    if let Some(level) = heading_level(tag) {
        return Some(heading(level, children, depth));
    }
    Some(match tag {
        "p" | "div" | "section" | "article" | "header" | "footer" | "main" | "aside" | "figure" => {
            blocks(children, depth + 1)
        }
        "hr" => vec!["---".to_string()],
        "blockquote" => {
            let inner = blocks(children, depth + 1);
            if inner.is_empty() {
                Vec::new()
            } else {
                vec![quote(&inner.join("\n\n"))]
            }
        }
        "pre" => vec![code_block(children)],
        "ul" | "ol" => list_block(tag == "ol", attrs, children, depth),
        "table" => table_block(children, depth).into_iter().collect(),
        // An inline wrapper around block content (Google Docs) is read as its blocks.
        _ if has_block_child(children) => blocks(children, depth + 1),
        _ => return None,
    })
}

fn heading_level(tag: &str) -> Option<usize> {
    let level: usize = tag.strip_prefix('h')?.parse().ok()?;
    (1..=6).contains(&level).then_some(level)
}

fn heading(level: usize, children: &[Node], depth: usize) -> Vec<String> {
    let text = one_line(children, depth + 1);
    let text = text.trim();
    if text.is_empty() {
        Vec::new()
    } else {
        vec![format!("{} {text}", "#".repeat(level))]
    }
}

/// Inline text on one line; block children are joined by single spaces.
fn one_line(nodes: &[Node], depth: usize) -> String {
    if has_block_child(nodes) {
        blocks(nodes, depth).join(" ")
    } else {
        inline(nodes, depth).replace('\n', " ")
    }
}

fn has_block_child(children: &[Node]) -> bool {
    children
        .iter()
        .any(|node| matches!(node, Node::Element { tag, .. } if BLOCK_TAGS.contains(&tag.as_str())))
}

/// Inline runs become one paragraph each; a run that is only whitespace yields nothing.
fn paragraph(nodes: &[Node], depth: usize) -> Option<String> {
    let text = inline(nodes, depth).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(
        text.split('\n')
            .map(escape_line_start)
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Escapes a leading character that would make a plain-text line a heading, quote, list or ordered item.
fn escape_line_start(line: &str) -> String {
    if line.starts_with(['#', '>']) || line.starts_with("- ") || line.starts_with("+ ") {
        return format!("\\{line}");
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && line[digits..].starts_with(". ") {
        return format!("{}\\{}", &line[..digits], &line[digits..]);
    }
    line.to_string()
}

fn quote(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            if line.is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn code_block(children: &[Node]) -> String {
    let lang = children
        .iter()
        .find_map(|node| match node {
            Node::Element { tag, attrs, .. } if tag.as_str() == "code" => attr(attrs, "class"),
            _ => None,
        })
        .and_then(|class| {
            class
                .split_whitespace()
                .find_map(|word| word.strip_prefix("language-"))
        })
        .unwrap_or("");
    let body = raw_text(children);
    let body = body.trim_end_matches('\n');
    // The fence must be longer than any backtick run in the body.
    let fence = "`".repeat(longest_backtick_run(body).max(2) + 1);
    format!("{fence}{lang}\n{body}\n{fence}")
}

/// The length of the longest run of backticks in `text`.
fn longest_backtick_run(text: &str) -> usize {
    text.split(|c: char| c != '`')
        .map(str::len)
        .max()
        .unwrap_or(0)
}

fn list_block(
    ordered: bool,
    attrs: &[(String, String)],
    children: &[Node],
    depth: usize,
) -> Vec<String> {
    // Digits only; overflow saturates at the CommonMark cap, anything else starts at 1.
    let start = attr(attrs, "start")
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .map_or(1, |s| {
            s.parse::<u32>().unwrap_or(u32::MAX).min(MAX_LIST_NUMBER)
        });
    let mut lines = Vec::new();
    let mut number = start;
    // Content indent of the last item, where nested lists and continuation lines go.
    let mut indent: Option<String> = None;
    let mut run_start = 0;
    for (index, child) in children.iter().enumerate() {
        let Node::Element {
            tag,
            children: item,
            ..
        } = child
        else {
            continue;
        };
        if !matches!(tag.as_str(), "li" | "ul" | "ol") {
            continue;
        }
        // Inline content loose in the list becomes an item of its own.
        if let Some(text) = paragraph(
            children.get(run_start..index).unwrap_or_default(),
            depth + 1,
        ) {
            add_item(&mut lines, &mut number, &mut indent, ordered, &text);
        }
        run_start = index + 1;
        match tag.as_str() {
            "li" => {
                let body = item_body(item, depth + 1);
                if !body.is_empty() {
                    add_item(&mut lines, &mut number, &mut indent, ordered, &body);
                }
            }
            // A list directly inside a list hangs under the item before it.
            _ => {
                let nested = blocks(std::slice::from_ref(child), depth + 1).join("\n");
                for line in nested.lines() {
                    lines.push(match &indent {
                        Some(pad) if !line.is_empty() => format!("{pad}{line}"),
                        _ => line.to_string(),
                    });
                }
            }
        }
    }
    if let Some(text) = paragraph(children.get(run_start..).unwrap_or_default(), depth + 1) {
        add_item(&mut lines, &mut number, &mut indent, ordered, &text);
    }
    if lines.is_empty() {
        Vec::new()
    } else {
        vec![lines.join("\n")]
    }
}

/// Appends one item; the lines after its first sit under the content column.
fn add_item(
    lines: &mut Vec<String>,
    number: &mut u32,
    indent: &mut Option<String>,
    ordered: bool,
    body: &str,
) {
    let marker = if ordered {
        format!("{number}.")
    } else {
        "-".to_string()
    };
    *number = number.saturating_add(1);
    let pad = " ".repeat(marker.len() + 1);
    for (index, line) in body.split('\n').enumerate() {
        lines.push(match index {
            0 => format!("{marker} {line}"),
            _ if line.is_empty() => String::new(),
            _ => format!("{pad}{line}"),
        });
    }
    *indent = Some(pad);
}

/// An item's blocks: a blank line between paragraphs, none before a nested list.
fn item_body(item: &[Node], depth: usize) -> String {
    let mut body = String::new();
    for part in blocks(item, depth) {
        if !body.is_empty() {
            body.push_str(if starts_list(&part) { "\n" } else { "\n\n" });
        }
        body.push_str(&part);
    }
    body
}

/// True when a block is a list, whose markers are never escaped.
fn starts_list(block: &str) -> bool {
    let Some((marker, _)) = block.split_once(' ') else {
        return false;
    };
    marker == "-"
        || marker
            .strip_suffix('.')
            .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

fn table_block(children: &[Node], depth: usize) -> Option<String> {
    let mut rows = Vec::new();
    collect_rows(children, depth + 1, &mut rows);
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    if cols == 0 {
        return None;
    }
    let separator = vec!["---".to_string(); cols];
    let mut lines = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        lines.push(table_row(row, cols));
        if index == 0 {
            lines.push(table_row(&separator, cols));
        }
    }
    Some(lines.join("\n"))
}

fn table_row(cells: &[String], cols: usize) -> String {
    let mut padded = cells.to_vec();
    padded.resize(cols, String::new());
    format!("| {} |", padded.join(" | "))
}

fn collect_rows(nodes: &[Node], depth: usize, rows: &mut Vec<Vec<String>>) {
    if depth > MAX_DEPTH {
        return;
    }
    for node in nodes {
        let Node::Element { tag, children, .. } = node else {
            continue;
        };
        match tag.as_str() {
            "tr" => rows.push(cell_texts(children, depth)),
            "thead" | "tbody" | "tfoot" => collect_rows(children, depth + 1, rows),
            _ => {}
        }
    }
}

fn cell_texts(nodes: &[Node], depth: usize) -> Vec<String> {
    nodes
        .iter()
        .filter_map(|node| match node {
            Node::Element { tag, children, .. } if matches!(tag.as_str(), "td" | "th") => {
                Some(cell_text(children, depth))
            }
            _ => None,
        })
        .collect()
}

fn cell_text(nodes: &[Node], depth: usize) -> String {
    one_line(nodes, depth + 1)
        .replace('|', "\\|")
        .trim()
        .to_string()
}

fn inline(nodes: &[Node], depth: usize) -> String {
    if depth > MAX_DEPTH {
        return escape_text(&collapse_ws(&raw_text(nodes)));
    }
    nodes
        .iter()
        .map(|node| match node {
            Node::Text(text) => escape_text(&collapse_ws(text)),
            Node::Element {
                tag,
                attrs,
                children,
            } => element_inline(tag, attrs, children, depth),
        })
        .collect()
}

fn element_inline(
    tag: &str,
    attrs: &[(String, String)],
    children: &[Node],
    depth: usize,
) -> String {
    if SKIPPED_TAGS.contains(&tag) {
        return String::new();
    }
    match tag {
        "br" => "\n".to_string(),
        "img" => image(attrs),
        "a" => link(attrs, children, depth),
        "code" => code_span(&raw_text(children)),
        _ => styled(tag, attrs, inline(children, depth + 1)),
    }
}

/// Wraps inline content in the emphasis its tag or `style` asks for.
fn styled(tag: &str, attrs: &[(String, String)], content: String) -> String {
    let style = attr(attrs, "style").unwrap_or("");
    let mut out = content;
    let strike = matches!(tag, "s" | "del" | "strike")
        || style_prop(style, "text-decoration").is_some_and(|v| v.contains("line-through"));
    if strike {
        out = wrap("~~", &out);
    }
    let italic =
        matches!(tag, "em" | "i") || style_prop(style, "font-style").as_deref() == Some("italic");
    if italic {
        out = wrap("*", &out);
    }
    // Google Docs wraps the whole copy in `<b style="font-weight:normal">`, which is not bold.
    let bold = match style_prop(style, "font-weight") {
        Some(weight) => weight == "bold" || weight.parse::<u32>().is_ok_and(|n| n >= 600),
        None => matches!(tag, "strong" | "b"),
    };
    if bold {
        out = wrap("**", &out);
    }
    out
}

/// Wraps `content` in `marker` with any outer whitespace moved outside the markers.
fn wrap(marker: &str, content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return if content.is_empty() {
            String::new()
        } else {
            " ".to_string()
        };
    }
    let lead = &content[..content.len() - content.trim_start().len()];
    let trail = &content[content.trim_end().len()..];
    format!("{lead}{marker}{trimmed}{marker}{trail}")
}

fn code_span(text: &str) -> String {
    // A code span is one line.
    let text = text.replace('\n', " ");
    if text.is_empty() {
        return String::new();
    }
    let fence = "`".repeat(longest_backtick_run(&text) + 1);
    let pad = if text.starts_with('`') || text.ends_with('`') {
        " "
    } else {
        ""
    };
    format!("{fence}{pad}{text}{pad}{fence}")
}

fn link(attrs: &[(String, String)], children: &[Node], depth: usize) -> String {
    let inner = inline(children, depth + 1).trim().to_string();
    if inner.is_empty() {
        return inner;
    }
    let href = attr(attrs, "href").unwrap_or("").trim();
    if href.is_empty() || href.starts_with('#') {
        return inner;
    }
    let Some(dest) = safe_url(href, true) else {
        return inner;
    };
    if raw_text(children).trim() == href {
        return dest;
    }
    format!("[{inner}]({dest})")
}

/// A link or image destination safe to write into Markdown, or `None` for a scheme that is not allowed.
fn safe_url(raw: &str, allow_relative: bool) -> Option<String> {
    // Controls are dropped first so `java\tscript:` cannot slip past the scheme check.
    let dest: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_ascii_control())
        .collect();
    if dest.is_empty() {
        return None;
    }
    let cleaned: String = dest.chars().filter(|c| !c.is_whitespace()).collect();
    let head = cleaned.split(['/', '?', '#']).next().unwrap_or("");
    match head.split_once(':') {
        Some((scheme, _))
            if matches!(
                scheme.to_ascii_lowercase().as_str(),
                "http" | "https" | "mailto"
            ) => {}
        Some(_) => return None,
        None if allow_relative => {}
        None => return None,
    }
    let mut out = String::with_capacity(dest.len());
    for ch in dest.chars() {
        match ch {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(ch),
        }
    }
    Some(out)
}

fn image(attrs: &[(String, String)]) -> String {
    let src = attr(attrs, "src").unwrap_or("").trim();
    let alt = escape_text(attr(attrs, "alt").unwrap_or("").trim());
    // Inline data and Word's local temp files cannot travel with the note.
    match safe_url(src, false) {
        Some(dest) => format!("![{alt}]({dest})"),
        None => alt,
    }
}

/// Collapses runs of whitespace to one space.
fn collapse_ws(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(ch);
            in_space = false;
        }
    }
    out
}

fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '&' | '~') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Joins blocks as paragraphs: trims line ends, caps blank runs at one, drops outer newlines.
/// Fenced code is kept line for line.
fn tidy(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for line in text.split('\n') {
        let trimmed = line.trim();
        if let Some((marker, len)) = fence {
            lines.push(line.to_string());
            if trimmed.chars().count() >= len && trimmed.chars().all(|c| c == marker) {
                fence = None;
            }
            continue;
        }
        let line = line.trim_end();
        if line.is_empty() && lines.last().is_some_and(String::is_empty) {
            continue;
        }
        lines.push(line.to_string());
        fence = fence_open(trimmed);
    }
    lines.join("\n").trim_matches('\n').to_string()
}

/// The marker and run length when a line opens a ``` or ~~~ fence.
fn fence_open(trimmed: &str) -> Option<(char, usize)> {
    let marker = trimmed.chars().next()?;
    let len = trimmed.chars().take_while(|&c| c == marker).count();
    (matches!(marker, '`' | '~') && len >= 3).then_some((marker, len))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::html_to_markdown;

    fn md(html: &str) -> String {
        html_to_markdown(html)
    }

    #[test]
    fn empty_and_tag_only_input_gives_empty() {
        assert_eq!(md(""), "");
        assert_eq!(md("<html><body></body></html>"), "");
        assert_eq!(md("<!-- x --><style>p{}</style>"), "");
    }

    #[test]
    fn inline_emphasis_in_paragraph() {
        assert_eq!(
            md("<p>Hello <b>bold</b> and <i>it</i></p>"),
            "Hello **bold** and *it*"
        );
    }

    #[test]
    fn paragraphs_are_separated_by_blank_line() {
        assert_eq!(md("<p>a</p><p>b</p>"), "a\n\nb");
    }

    #[test]
    fn headings_map_to_hashes() {
        assert_eq!(md("<h1>T</h1><h3>S</h3>"), "# T\n\n### S");
    }

    #[test]
    fn links_keep_href_and_drop_unsafe() {
        assert_eq!(
            md("<a href=\"https://x.org/a\">site</a>"),
            "[site](https://x.org/a)"
        );
        assert_eq!(md("<a href=\"#top\">up</a>"), "up");
        assert_eq!(md("<a href=\"javascript:alert(1)\">x</a>"), "x");
    }

    #[test]
    fn lists_bullets_numbers_and_nesting() {
        assert_eq!(
            md("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>"),
            "- a\n- b\n  - c"
        );
        assert_eq!(
            md("<ol start=\"3\"><li>x</li><li>y</li></ol>"),
            "3. x\n4. y"
        );
        assert_eq!(
            md("<ol><li>a<ol><li>b</li></ol></li></ol>"),
            "1. a\n   1. b"
        );
    }

    #[test]
    fn tables_pipe_and_ragged_rows() {
        assert_eq!(
            md("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2|3</td></tr></table>"),
            "| A | B |\n| --- | --- |\n| 1 | 2\\|3 |"
        );
        assert_eq!(
            md("<table><tr><td>a</td></tr><tr><td>b</td><td>c</td></tr></table>"),
            "| a |  |\n| --- | --- |\n| b | c |"
        );
    }

    #[test]
    fn code_blocks_and_inline_code() {
        assert_eq!(
            md("<pre><code class=\"language-rust\">fn  main() {\n    x &lt; 1\n}</code></pre>"),
            "```rust\nfn  main() {\n    x < 1\n}\n```"
        );
        assert_eq!(md("<p>use <code>a*b</code></p>"), "use `a*b`");
    }

    #[test]
    fn script_and_style_are_dropped() {
        assert_eq!(
            md("<p>ok</p><script>alert('x')</script><style>.a{}</style>"),
            "ok"
        );
    }

    #[test]
    fn images_remote_data_and_file() {
        assert_eq!(
            md("<img src=\"https://x.org/a.png\" alt=\"fig\">"),
            "![fig](https://x.org/a.png)"
        );
        assert_eq!(
            md("<img src=\"data:image/png;base64,AAA\" alt=\"fig\">"),
            "fig"
        );
        assert_eq!(md("<img src=\"file:///C:/tmp/a.png\">"), "");
    }

    #[test]
    fn google_docs_wrapper_keeps_weight_and_style() {
        assert_eq!(
            md(
                "<b style=\"font-weight:normal;\" id=\"docs-internal-guid-1\"><p><span style=\"font-weight:700\">Bold</span> plain <span style=\"font-style:italic\">it</span></p></b>"
            ),
            "**Bold** plain *it*"
        );
    }

    #[test]
    fn word_office_tags_are_transparent() {
        assert_eq!(md("<p class=MsoNormal><b>Hi<o:p></o:p></b></p>"), "**Hi**");
    }

    #[test]
    fn markdown_specials_are_escaped() {
        assert_eq!(md("<p>2*3 = 6 and [x]</p>"), "2\\*3 = 6 and \\[x\\]");
        assert_eq!(md("<p># not a heading</p>"), "\\# not a heading");
    }

    #[test]
    fn entities_and_whitespace_collapse() {
        assert_eq!(md("<p>a&nbsp;&amp;\n   b &#169; &#x41;</p>"), "a \\& b © A");
    }

    #[test]
    fn markers_move_outer_spaces() {
        assert_eq!(md("<p>x<b> y </b>z</p>"), "x **y** z");
        assert_eq!(md("<p>a<b> </b>b</p>"), "a b");
    }

    #[test]
    fn blockquote_prefixes_each_line() {
        assert_eq!(
            md("<blockquote><p>q1</p><p>q2</p></blockquote>"),
            "> q1\n>\n> q2"
        );
    }

    #[test]
    fn br_is_newline() {
        assert_eq!(md("<p>a<br>b</p>"), "a\nb");
    }

    #[test]
    fn garbage_and_deep_nesting_do_not_panic() {
        assert_eq!(md("<p>a <b>b"), "a **b**");
        let _ = md("<<<>>> </div></p>");
        let deep = md(&("<div>".repeat(5000) + "x"));
        assert!(deep.contains('x'));
    }

    #[test]
    fn strikethrough() {
        assert_eq!(md("<del>gone</del>"), "~~gone~~");
    }

    #[test]
    fn hr_is_its_own_block() {
        assert_eq!(md("<p>a</p><hr><p>b</p>"), "a\n\n---\n\nb");
    }

    #[test]
    fn unterminated_markup_is_fast() {
        let inputs = [
            "<a ".repeat(70_000),
            "</a".repeat(70_000),
            format!("<a x=\"{}", "y".repeat(200_000)),
        ];
        for s in &inputs {
            let t = std::time::Instant::now();
            let _ = md(s);
            assert!(t.elapsed().as_secs() < 2);
        }
    }

    #[test]
    fn script_body_is_not_markup() {
        assert_eq!(md("<p>hi<script>s=\"<p>\";leak()</script></p>"), "hi");
        assert!(!md("<div>a<script>x=\"</div>\";leak()</script>b</div>").contains("leak"));
    }

    #[test]
    fn escapes_angle_brackets_and_ampersand() {
        let out = md("<p>a &lt;img&gt; &amp; b</p>");
        assert!(out.contains("\\<img>"));
        assert!(out.contains("\\&"));
        // Every `<` is escaped, so no raw tag survives.
        assert!(!out.replace(r"\<", "").contains('<'));
    }

    #[test]
    fn named_punctuation_entities() {
        assert_eq!(md("<p>&mdash;&hellip;&rsquo;</p>"), "—…’");
        assert_eq!(md("<p>&amp;éééé</p>"), "\\&éééé");
    }

    #[test]
    fn numeric_zero_is_replacement_char() {
        assert_eq!(md("<p>&#0;</p>"), "\u{FFFD}");
    }

    #[test]
    fn unsafe_link_schemes_drop_to_text() {
        assert_eq!(md("<a href=\"vbscript:x\">t</a>"), "t");
        assert_eq!(md("<a href=\"java&#x09;script:x\">t</a>"), "t");
        assert_eq!(md("<a href=\"data:text/html,x\">t</a>"), "t");
    }

    #[test]
    fn link_destinations_are_encoded() {
        assert_eq!(
            md("<a href=\"https://e.com/a b(c)\">t</a>"),
            "[t](https://e.com/a%20b%28c%29)"
        );
        assert_eq!(md("<a href=\"/x\">t</a>"), "[t](/x)");
    }

    #[test]
    fn image_schemes_allowlisted() {
        assert_eq!(md("<img src=\"javascript:x\" alt=\"a\">"), "a");
        assert_eq!(md("<img src=\"/rel.png\" alt=\"a\">"), "a");
        assert_eq!(
            md("<img src=\"https://e.com/i.png\" alt=\"a\">"),
            "![a](https://e.com/i.png)"
        );
    }

    #[test]
    fn ordered_list_start_is_clamped_and_defaults() {
        assert_eq!(
            md("<ol start=\"5\"><li>a</li><li>b</li></ol>"),
            "5. a\n6. b"
        );
        assert!(md("<ol start=\"99999999999\"><li>a</li></ol>").starts_with("999999999. a"));
        assert_eq!(md("<ol start=\"x\"><li>a</li></ol>"), "1. a");
    }

    #[test]
    fn block_children_stay_on_one_line() {
        let table = md("<table><tr><th>h</th></tr><tr><td><p>a</p><p>b</p></td></tr></table>");
        assert!(table.lines().any(|line| line.contains("a b")));
        assert_eq!(md("<h2><div>a</div><div>b</div></h2>"), "## a b");
    }

    #[test]
    fn odd_list_children_are_kept() {
        assert_eq!(md("<ul><li>a</li><ul><li>b</li></ul></ul>"), "- a\n  - b");
        let loose = md("<ul>loose<li>a</li></ul>");
        assert!(loose.contains("loose") && loose.contains("- a"));
        assert_eq!(md("<ul><li><p>a</p><p>b</p></li></ul>"), "- a\n\n  b");
    }

    #[test]
    fn code_fence_outlasts_inner_backticks() {
        assert_eq!(md("<pre><code>x ``` y</code></pre>"), "````\nx ``` y\n````");
        assert_eq!(md("<code>a`b</code>"), "``a`b``");
        assert_eq!(md("<code>`a</code>"), "`` `a ``");
    }

    #[test]
    fn code_keeps_blank_lines_and_newlines() {
        assert!(md("<pre>a\n\n\n\nb</pre>").contains("a\n\n\n\nb"));
        assert_eq!(md("<code>a\nb</code>"), "`a b`");
        assert!(md("<pre>a<br>b</pre>").contains("a\nb"));
    }

    #[test]
    fn cf_html_header_is_dropped() {
        let input = "Version:0.9\r\nStartHTML:000\r\nStartFragment:000\r\n<html><body><!--StartFragment--><b>x</b><!--EndFragment--></body></html>";
        assert_eq!(md(input), "**x**");
    }
}
