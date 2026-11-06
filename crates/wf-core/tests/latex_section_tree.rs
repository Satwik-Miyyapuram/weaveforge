#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_core::latex_section_tree::*;

fn file(path: &str, content: &str) -> LatexSourceFile {
    LatexSourceFile {
        path: path.to_owned(),
        content: content.to_owned(),
    }
}

fn parse(files: &[(&str, &str)]) -> LatexSectionTree {
    let sources: Vec<LatexSourceFile> = files.iter().map(|(p, c)| file(p, c)).collect();
    parse_latex_section_tree(&sources, "main.tex")
}

#[test]
fn nests_sections_by_level_and_starts_new_root_for_peer() {
    let tree = parse(&[(
        "main.tex",
        "\\section{A}\n\\subsection{B}\n\\subsubsection{C}\n\\section{D}",
    )]);
    assert_eq!(tree.roots.len(), 2);
    assert_eq!(tree.roots[0].title, "A");
    assert_eq!(tree.roots[0].children[0].title, "B");
    assert_eq!(tree.roots[0].children[0].children[0].title, "C");
    assert_eq!(tree.roots[1].title, "D");
    assert!(tree.roots[1].children.is_empty());
}

#[test]
fn starred_heading_is_parsed_with_base_command() {
    let tree = parse(&[("main.tex", "\\section*{Intro}")]);
    assert_eq!(tree.roots[0].title, "Intro");
    assert_eq!(tree.roots[0].command, "section");
    assert_eq!(tree.roots[0].level, 2);
}

#[test]
fn short_title_in_brackets_is_skipped() {
    let tree = parse(&[(
        "main.tex",
        "\\section[Short]{Long title}\n\\subsection*[S] {Sub}",
    )]);
    assert_eq!(tree.roots[0].title, "Long title");
    assert_eq!(tree.roots[0].children[0].title, "Sub");
}

#[test]
fn title_cleanup_strips_commands_and_comments() {
    // A brace inside the title keeps the TS SECTION_RE from matching, so this uses a bare command.
    let tree = parse(&[("main.tex", "\\section{The \\emph Big Idea % note}")]);
    assert_eq!(tree.roots[0].title, "The Big Idea");
}

#[test]
fn heading_with_nested_braces_is_not_a_section() {
    let tree = parse(&[("main.tex", "\\section{The \\emph{Big} Idea}")]);
    assert!(tree.roots.is_empty());
}

#[test]
fn relative_include_resolves_against_current_directory() {
    let tree = parse(&[
        ("main.tex", "\\input{chapters/one}"),
        ("chapters/one.tex", "\\input{two}"),
        ("chapters/two.tex", ""),
    ]);
    assert_eq!(
        tree.files,
        vec!["main.tex", "chapters/one.tex", "chapters/two.tex"]
    );
    assert!(tree.warnings.is_empty());
}

#[test]
fn braceless_input_resolves() {
    let tree = parse(&[("main.tex", "\\input chap1"), ("chap1.tex", "")]);
    assert_eq!(tree.files, vec!["main.tex", "chap1.tex"]);
}

#[test]
fn missing_include_warns() {
    let tree = parse(&[("main.tex", "\\input{missing}")]);
    assert_eq!(tree.warnings, vec!["Included file not found: missing.tex"]);
}

#[test]
fn circular_include_warns() {
    let sources = [file("a.tex", "\\input{b}"), file("b.tex", "\\input{a}")];
    let tree = parse_latex_section_tree(&sources, "a.tex");
    assert_eq!(tree.files, vec!["a.tex", "b.tex"]);
    assert_eq!(tree.warnings, vec!["Circular include ignored: a.tex"]);
}

#[test]
fn include_climbing_out_of_project_is_unsafe() {
    let tree = parse(&[("main.tex", "\\input{../../x}")]);
    assert_eq!(tree.warnings, vec!["Unsafe include path ignored: ../../x"]);
    assert_eq!(tree.files, vec!["main.tex"]);
}

#[test]
fn same_file_included_twice_is_visited_twice() {
    let tree = parse(&[("main.tex", "\\input{sub}\n\\input{sub}"), ("sub.tex", "")]);
    assert_eq!(tree.files, vec!["main.tex", "sub.tex", "sub.tex"]);
}

#[test]
fn end_line_and_id_use_next_section_start() {
    let tree = parse(&[("main.tex", "\\section{A}\na\nb\n\\section{B}\nc\nd")]);
    assert_eq!(tree.roots[0].start_line, 1);
    assert_eq!(tree.roots[0].end_line, 3);
    assert_eq!(tree.roots[0].id, "main.tex:1:1");
    assert_eq!(tree.roots[1].start_line, 4);
    assert_eq!(tree.roots[1].end_line, 6);
    assert_eq!(tree.roots[1].id, "main.tex:4:2");
}

#[test]
fn preview_strips_commands_comments_and_dollars() {
    let tree = parse(&[("main.tex", "\\section{S}\nText \\cite{x} $a$ more % hidden")]);
    assert_eq!(tree.roots[0].preview, "Text a more");
}

#[test]
fn comment_on_one_body_line_drops_later_body_lines() {
    let tree = parse(&[("main.tex", "\\section{S}\none % c\ntwo")]);
    assert_eq!(tree.roots[0].preview, "one");
}

#[test]
fn preview_is_capped_at_240_chars() {
    let body = "a".repeat(300);
    let content = format!("\\section{{S}}\n{body}");
    let tree = parse(&[("main.tex", content.as_str())]);
    assert_eq!(tree.roots[0].preview.chars().count(), 240);
}

#[test]
fn preview_bracket_quirk_drops_bracket_and_closing_brackets() {
    let tree = parse(&[("main.tex", "\\section{S}\n\\foo[a]]] tail")]);
    assert_eq!(tree.roots[0].preview, "tail");
}

#[test]
fn cross_file_section_nests_under_parent_in_other_file() {
    let tree = parse(&[
        ("main.tex", "\\section{A}\n\\input{sub}\n\\section{C}"),
        ("sub.tex", "\\subsection{B}"),
    ]);
    assert_eq!(tree.roots.len(), 2);
    assert_eq!(tree.roots[0].title, "A");
    assert_eq!(tree.roots[0].children[0].title, "B");
    assert_eq!(tree.roots[0].children[0].file, "sub.tex");
    assert_eq!(tree.roots[1].title, "C");
}

#[test]
fn crlf_content_keeps_correct_line_numbers() {
    let tree = parse(&[("main.tex", "\\section{A}\r\nx\r\n\\section{B}\r\ny")]);
    assert_eq!(tree.roots[1].start_line, 3);
    assert_eq!(tree.roots[0].end_line, 2);
}

#[test]
fn duplicate_paths_last_source_wins() {
    let tree = parse(&[
        ("main.tex", "\\section{Old}"),
        ("main.tex", "\\section{New}"),
    ]);
    assert_eq!(tree.roots.len(), 1);
    assert_eq!(tree.roots[0].title, "New");
}

#[test]
fn missing_entry_warns_with_empty_result() {
    let tree = parse_latex_section_tree(&[], "main.tex");
    assert_eq!(tree.warnings, vec!["Included file not found: main.tex"]);
    assert!(tree.roots.is_empty());
    assert!(tree.files.is_empty());
}

#[test]
fn json_uses_camel_case_keys() {
    let tree = parse(&[("main.tex", "\\section{A}\nx")]);
    let value = serde_json::to_value(&tree).unwrap();
    let node = &value["roots"][0];
    assert!(node.get("startLine").is_some());
    assert!(node.get("endLine").is_some());
    assert!(value.get("roots").is_some());
    assert!(value.get("files").is_some());
    assert!(value.get("warnings").is_some());
}

#[test]
fn commands_that_start_with_include_or_input_are_not_includes() {
    let tree = parse(&[(
        "main.tex",
        "\\section{A}\n\\includegraphics[width=\\linewidth]{aa.png}\n\\inputencoding{utf8}\n\\includeonly{x}",
    )]);
    assert!(tree.warnings.is_empty(), "{:?}", tree.warnings);
}
