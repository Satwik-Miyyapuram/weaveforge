//! Turning a spreadsheet paste into a Markdown table.
//!
//! Copying a results table out of Excel, Numbers, Google Sheets or an HTML table
//! puts tab-separated rows on the clipboard. Pasted into Markdown they render as
//! one run-together line, so the reader has to rebuild by hand a table they
//! already had — which for a research note holding measurements is most of the
//! reason the table was copied.
//!
//! Tabs only, never commas. A tab-separated block of several lines is
//! unambiguous: prose does not contain tabs. Comma-separated text is not — half
//! the sentences in a note would qualify — and a rule that turns a paragraph
//! into a table is worse than no rule.

use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;
use crate::search::js_text::is_js_whitespace;

use super::TextResult;

/// A tab-separated block read into its header row and the rows after it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TabularParse {
    /// Header cells, taken from the first row.
    pub header: Vec<String>,
    /// Every row after the first.
    pub rows: Vec<Vec<String>>,
}

/// Rows fewer than this are a line with a tab in it, not a table.
const MIN_ROWS: usize = 2;
/// One column is a list, not a table.
const MIN_COLUMNS: usize = 2;
/// Above this a paste is a data dump rather than a table somebody will read in a
/// note, and rendering it as Markdown makes an unreadable wall either way.
const MAX_ROWS: usize = 500;
const MAX_COLUMNS: usize = 50;

/// A column whose every value is a number, with optional thousands separators,
/// sign, percent or currency. Such a column reads right-aligned.
static NUMERIC_VALUE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"^[-+]?[$£€]?\d{1,3}(?:[ ,]\d{3})*(?:\.\d+)?%?$|^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?%?$")
        .ok()
});

/// Reads a tab-separated block, or returns `None` when it is not one.
///
/// Every row must have the same number of cells. A spreadsheet always pads its
/// rectangle, so a ragged block came from somewhere else — a log, a code sample,
/// indented prose — and is left alone.
#[must_use]
pub fn parse_tab_separated(text: &str) -> Option<TabularParse> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<&str> = normalized.split('\n').collect();
    // A trailing newline is how most applications end the copy.
    while lines.last().is_some_and(|line| line.is_empty()) {
        let _empty = lines.pop();
    }
    if lines.len() < MIN_ROWS || lines.len() > MAX_ROWS {
        return None;
    }

    let grid: Vec<Vec<&str>> = lines
        .iter()
        .map(|line| line.split('\t').collect())
        .collect();
    let columns = grid.first()?.len();
    if !(MIN_COLUMNS..=MAX_COLUMNS).contains(&columns) {
        return None;
    }
    if grid.iter().any(|row| row.len() != columns) {
        return None;
    }

    let cells: Vec<Vec<String>> = grid
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| cell.trim_matches(is_js_whitespace).to_owned())
                .collect()
        })
        .collect();
    // A block of blank cells is whitespace someone copied, not data.
    if cells.iter().all(|row| row.iter().all(String::is_empty)) {
        return None;
    }

    let mut rows = cells.into_iter();
    let header = rows.next()?;
    Some(TabularParse {
        header,
        rows: rows.collect(),
    })
}

/// A cell that Markdown will read as one cell.
fn escape_cell(cell: &str) -> String {
    // A pipe would start a new column, and a backslash before it would escape the
    // escape. Empty cells get a space so the row keeps its shape.
    let escaped = cell.replace('\\', "\\\\").replace('|', "\\|");
    if escaped.is_empty() {
        " ".to_owned()
    } else {
        escaped
    }
}

/// True when every non-empty value in the column is a number.
fn is_numeric_column(rows: &[Vec<String>], index: usize) -> bool {
    let values: Vec<&str> = rows
        .iter()
        .map(|row| row.get(index).map_or("", String::as_str))
        .filter(|value| !value.is_empty())
        .collect();
    if values.is_empty() {
        return false;
    }
    NUMERIC_VALUE
        .as_ref()
        .is_some_and(|re| values.iter().all(|value| re.is_match(value)))
}

/// One Markdown table row from already-escaped cells.
fn table_line(cells: &[String]) -> String {
    format!("| {} |", cells.join(" | "))
}

/// Renders a parsed block as a Markdown table.
///
/// Columns are not padded to a common width. Aligned source looks better in a
/// plain editor and worse everywhere else: one edit to a cell and the whole
/// table has to be re-laid, which is work the writer did not ask for, and the
/// rendered output is identical either way.
#[must_use]
pub fn render_markdown_table(parse: &TabularParse) -> String {
    let separator: Vec<String> = (0..parse.header.len())
        .map(|index| {
            if is_numeric_column(&parse.rows, index) {
                "---:".to_owned()
            } else {
                "---".to_owned()
            }
        })
        .collect();

    let header: Vec<String> = parse.header.iter().map(|cell| escape_cell(cell)).collect();
    let mut lines = vec![table_line(&header), table_line(&separator)];
    lines.extend(parse.rows.iter().map(|row| {
        let cells: Vec<String> = row.iter().map(|cell| escape_cell(cell)).collect();
        table_line(&cells)
    }));
    lines.join("\n")
}

/// Converts a tab-separated paste to a Markdown table, or returns it unchanged.
#[must_use]
pub fn tab_separated_to_markdown_table(text: &str) -> TextResult {
    match parse_tab_separated(text) {
        Some(parse) => TextResult::new(text, render_markdown_table(&parse)),
        None => TextResult::new(text, text.to_owned()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn convert(text: &str) -> String {
        tab_separated_to_markdown_table(text).text
    }

    #[test]
    fn a_spreadsheet_paste_becomes_a_markdown_table() {
        let pasted = "model\tval_loss\taccuracy\nbeta-VAE\t0.1826\t0.912\nResNet-18\t0.340\t0.887";
        assert_eq!(
            convert(pasted),
            [
                "| model | val_loss | accuracy |",
                "| --- | ---: | ---: |",
                "| beta-VAE | 0.1826 | 0.912 |",
                "| ResNet-18 | 0.340 | 0.887 |",
            ]
            .join("\n")
        );
    }

    #[test]
    fn numeric_columns_are_right_aligned_and_text_columns_are_not() {
        let parse = parse_tab_separated("a\tb\tc\nx\t1\t1.5%\ny\t-2\tnot a number").expect("table");
        let table = render_markdown_table(&parse);
        assert_eq!(table.split('\n').nth(1), Some("| --- | ---: | --- |"));
    }

    #[test]
    fn thousands_separators_signs_and_currency_still_read_as_numbers() {
        let parse = parse_tab_separated("cost\tn\n$1,200\t+3\n$980\t-4").expect("table");
        assert_eq!(
            render_markdown_table(&parse).split('\n').nth(1),
            Some("| ---: | ---: |")
        );
    }

    #[test]
    fn a_pipe_in_a_cell_cannot_start_a_new_column() {
        assert_eq!(
            convert("a\tb\nx|y\tz"),
            "| a | b |\n| --- | --- |\n| x\\|y | z |"
        );
    }

    #[test]
    fn an_empty_cell_keeps_the_rows_shape() {
        assert_eq!(convert("a\tb\n\tz"), "| a | b |\n| --- | --- |\n|   | z |");
    }

    #[test]
    fn prose_is_never_mistaken_for_a_table() {
        for text in [
            "one, two, three",
            "a single line\twith a tab",
            "no tabs at all\nsecond line",
            "ragged\trows\nhere\ttoo\tmany",
            "\t\n\t",
            "",
            "just one column\nof lines",
        ] {
            assert_eq!(convert(text), text, "{text:?}");
        }
    }

    #[test]
    fn a_comma_separated_block_is_left_alone_deliberately() {
        let csv = "model,val_loss\nbeta-VAE,0.1826";
        assert_eq!(convert(csv), csv);
    }

    #[test]
    fn a_data_dump_past_the_size_caps_is_left_as_text() {
        let wide = (0..60)
            .map(|i| format!("c{i}"))
            .collect::<Vec<_>>()
            .join("\t");
        let wide_text = format!("{wide}\n{wide}");
        assert_eq!(convert(&wide_text), wide_text);

        let tall = vec!["a\tb"; 600].join("\n");
        assert_eq!(convert(&tall), tall);
    }

    #[test]
    fn carriage_returns_and_a_trailing_newline_come_through() {
        assert_eq!(
            convert("a\tb\r\nx\ty\r\n"),
            "| a | b |\n| --- | --- |\n| x | y |"
        );
    }

    #[test]
    fn non_ascii_cells_convert_and_numbers_still_align() {
        assert_eq!(
            convert("名前\tvalue\nテスト\t1.5"),
            "| 名前 | value |\n| --- | ---: |\n| テスト | 1.5 |"
        );
    }

    #[test]
    fn converting_is_idempotent_so_a_table_pasted_again_stays_one_table() {
        let once = convert("a\tb\nx\ty");
        assert_eq!(convert(&once), once);
    }

    #[test]
    fn empty_input_is_unchanged() {
        let result = tab_separated_to_markdown_table("");
        assert_eq!(result.text, "");
        assert!(!result.changed);
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(NUMERIC_VALUE.is_some(), "NUMERIC_VALUE");
    }
}
