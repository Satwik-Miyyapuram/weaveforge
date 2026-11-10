//! Every per-kind decision in the editor workspace, as one table (pure rules).
//! A port of the table and lookups in
//! `apps/web/src/features/editor-workspace/ui/kind.ts`.
//!
//! Unknown kinds fall back to the `folder` row: a kind the table has not heard
//! of reads as a grouping row with the fallback icon, never as an error.
//! Icon handles and tint classes are data the TS nav and stylesheet consume;
//! the renderers and JSX stay in TS.

use serde::Serialize;

use super::pane_tree::{DocumentMode, TabRef};
use crate::sync::ink_note::is_ink_note_body;

/// Every kind the explorer can show, in the order the TS side lists them.
pub const KINDS: &[&str] = &[
    "vault_page",
    "ink_page",
    "paper",
    "paper_pdf",
    "overleaf",
    "reading_list",
    "report_section",
    "experiment",
    "milestone",
    "log_entry",
    "folder",
];

/// The tint a kind's icon reads by. Becomes the class `kind-tint-<name>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KindTint {
    /// Information.
    Info,
    /// Warning.
    Warn,
    /// The accent colour.
    Accent,
    /// Success.
    Good,
    /// Error or destructive.
    Danger,
    /// No tint.
    Neutral,
}

impl KindTint {
    const fn name(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Accent => "accent",
            Self::Good => "good",
            Self::Danger => "danger",
            Self::Neutral => "neutral",
        }
    }
}

/// Which renderer a kind mounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum KindDocument {
    /// The shipped text editor.
    Text,
    /// The handwritten ink renderer.
    Ink,
    /// The PDF reader.
    Pdf,
    /// The Overleaf projects screen and project editor.
    Overleaf,
}

/// Which surface owns a row's title and its place in the tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum KindOwner {
    /// The vault owns the title and place in the tree.
    Vault,
    /// The report owns the title and place.
    Report,
}

/// Which wikilink lookup table a kind resolves against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum LinkGroup {
    /// Notes lookup.
    Notes,
    /// Papers lookup.
    Papers,
    /// Sections lookup.
    Sections,
}

/// A status-bar segment a kind can show. Same spellings as the TS `SegmentKey`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum StatusSegment {
    /// Word count.
    Words,
    /// Character count.
    Chars,
    /// Cursor position.
    Cursor,
    /// File encoding.
    Encoding,
    /// Document language.
    Language,
    /// Page number.
    Page,
    /// Ink stroke count.
    Strokes,
    /// Pen state.
    Pen,
    /// Recognised ink text count.
    Recognised,
    /// Ink segment.
    Ink,
}

/// One row of the kind table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KindMeta {
    /// The `nav-icon` glyph handle for the kind.
    pub icon: &'static str,
    /// The icon tint.
    pub tint: KindTint,
    /// The `.<name>.md` suffix the UI appends, or `None` where there is no file.
    pub suffix: Option<&'static str>,
    /// The renderer the kind mounts.
    pub document: KindDocument,
    /// Status-bar segments in paint order.
    pub segments: &'static [StatusSegment],
    /// Whether the kind has a PDF mode of its own (a paper, beside its source).
    pub pdf: bool,
    /// Whether the kind supports an Ink mode.
    pub ink: bool,
    /// Whether the body arrives as a preview first and in full later.
    pub lazy_body: bool,
    /// The surface that owns the title and place in the tree.
    pub owner: KindOwner,
    /// Whether a row of this kind is a document rather than a grouping row.
    pub document_row: bool,
    /// Order member rows take inside a reading list. `None` where the kind is never a member.
    pub member_order: Option<i32>,
    /// The wikilink lookup table, if any.
    pub link_group: Option<LinkGroup>,
    /// Whether the workspace can create one of these from a title.
    pub creatable: bool,
}

const TEXT_SEGMENTS: &[StatusSegment] = &[
    StatusSegment::Words,
    StatusSegment::Chars,
    StatusSegment::Cursor,
    StatusSegment::Encoding,
    StatusSegment::Language,
];

/// What an ink note's status bar says: page, strokes, pen, recogniser, format.
const INK_SEGMENTS: &[StatusSegment] = &[
    StatusSegment::Page,
    StatusSegment::Strokes,
    StatusSegment::Pen,
    StatusSegment::Recognised,
    StatusSegment::Ink,
];

const NO_SEGMENTS: &[StatusSegment] = &[];

/// A grouping row: not a document, so no file, no words, no place as a list member.
static FOLDER: KindMeta = KindMeta {
    icon: "folder",
    tint: KindTint::Neutral,
    suffix: None,
    document: KindDocument::Text,
    segments: NO_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: false,
    member_order: None,
    link_group: None,
    creatable: false,
};

static VAULT_PAGE: KindMeta = KindMeta {
    icon: "notes",
    tint: KindTint::Info,
    suffix: Some(".note.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: true,
    lazy_body: true,
    owner: KindOwner::Vault,
    document_row: true,
    // Papers first (10), then notes (20); the gap leaves room for a kind between.
    member_order: Some(20),
    link_group: Some(LinkGroup::Notes),
    creatable: true,
};

static INK_PAGE: KindMeta = KindMeta {
    icon: "ink",
    tint: KindTint::Danger,
    suffix: Some(".ink.md"),
    document: KindDocument::Ink,
    segments: INK_SEGMENTS,
    pdf: false,
    ink: true,
    lazy_body: true,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: Some(20),
    link_group: Some(LinkGroup::Notes),
    creatable: true,
};

static PAPER: KindMeta = KindMeta {
    icon: "book",
    tint: KindTint::Warn,
    suffix: Some(".paper.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: true,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: Some(10),
    link_group: Some(LinkGroup::Papers),
    creatable: false,
};

static PAPER_PDF: KindMeta = KindMeta {
    icon: "book",
    tint: KindTint::Danger,
    suffix: Some(".pdf"),
    document: KindDocument::Pdf,
    segments: NO_SEGMENTS,
    pdf: true,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

static OVERLEAF: KindMeta = KindMeta {
    icon: "overleaf",
    tint: KindTint::Good,
    suffix: None,
    document: KindDocument::Overleaf,
    segments: NO_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

static READING_LIST: KindMeta = KindMeta {
    icon: "list",
    tint: KindTint::Accent,
    suffix: Some(".list.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

static REPORT_SECTION: KindMeta = KindMeta {
    icon: "doc",
    tint: KindTint::Good,
    suffix: Some(".report.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    // Renamed and re-parented through the report's own use case.
    owner: KindOwner::Report,
    document_row: true,
    member_order: None,
    link_group: Some(LinkGroup::Sections),
    creatable: false,
};

static EXPERIMENT: KindMeta = KindMeta {
    icon: "flask",
    tint: KindTint::Warn,
    suffix: Some(".experiment.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

static MILESTONE: KindMeta = KindMeta {
    icon: "flag",
    tint: KindTint::Neutral,
    suffix: Some(".milestone.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

static LOG_ENTRY: KindMeta = KindMeta {
    icon: "calendar",
    tint: KindTint::Neutral,
    suffix: Some(".log.md"),
    document: KindDocument::Text,
    segments: TEXT_SEGMENTS,
    pdf: false,
    ink: false,
    lazy_body: false,
    owner: KindOwner::Vault,
    document_row: true,
    member_order: None,
    link_group: None,
    creatable: false,
};

/// The table row for a kind, or the folder row for anything unknown.
#[must_use]
pub fn kind_meta(kind: &str) -> &'static KindMeta {
    match kind {
        "vault_page" => &VAULT_PAGE,
        "ink_page" => &INK_PAGE,
        "paper" => &PAPER,
        "paper_pdf" => &PAPER_PDF,
        "overleaf" => &OVERLEAF,
        "reading_list" => &READING_LIST,
        "report_section" => &REPORT_SECTION,
        "experiment" => &EXPERIMENT,
        "milestone" => &MILESTONE,
        "log_entry" => &LOG_ENTRY,
        _ => &FOLDER,
    }
}

/// The icon handle for a kind.
#[must_use]
pub fn kind_icon(kind: &str) -> &'static str {
    kind_meta(kind).icon
}

/// Whether a row of this kind is a document that can be opened and saved.
#[must_use]
pub fn is_document_kind(kind: &str) -> bool {
    kind_meta(kind).document_row
}

/// Whether the pane offers a PDF mode for this kind.
#[must_use]
pub fn has_pdf_view(kind: &str) -> bool {
    kind_meta(kind).pdf
}

/// Whether the pane offers an Ink mode for this kind.
#[must_use]
pub fn has_ink_view(kind: &str) -> bool {
    kind_meta(kind).ink
}

/// Whether a kind's body is hydrated after its preview, and must be before a save.
#[must_use]
pub fn has_lazy_body(kind: &str) -> bool {
    kind_meta(kind).lazy_body
}

/// Which surface owns a row's title and its place in the tree.
#[must_use]
pub fn kind_owner(kind: &str) -> KindOwner {
    kind_meta(kind).owner
}

/// Rank of a kind inside a reading list. Unknown or non-member kinds sort last.
#[must_use]
pub fn member_rank(kind: &str) -> i32 {
    kind_meta(kind).member_order.unwrap_or(i32::MAX)
}

/// Which wikilink lookup table a kind resolves against.
#[must_use]
pub fn link_group_of(kind: &str) -> Option<LinkGroup> {
    kind_meta(kind).link_group
}

/// Whether the workspace can make a document of this kind from a title.
#[must_use]
pub fn is_creatable_kind(kind: &str) -> bool {
    kind_meta(kind).creatable
}

/// The tint class a kind reads by, or `None` for an untinted kind.
#[must_use]
pub fn kind_tint_class(kind: &str) -> Option<String> {
    match kind_meta(kind).tint {
        KindTint::Neutral => None,
        tint => Some(format!("kind-tint-{}", tint.name())),
    }
}

/// The tint class for a row's icon. A folder is accent when open and untinted
/// when closed; every document takes its kind's tint.
#[must_use]
pub fn kind_icon_class(kind: &str, open: bool) -> Option<String> {
    if !is_document_kind(kind) {
        return open.then(|| format!("kind-tint-{}", KindTint::Accent.name()));
    }
    kind_tint_class(kind)
}

/// The suffix shown after a title, or `None` where the kind has no file.
#[must_use]
pub fn kind_suffix(kind: &str) -> Option<&'static str> {
    kind_meta(kind).suffix
}

/// The suffix for a kind, or the empty string where it has none.
#[must_use]
pub fn document_suffix(kind: &str) -> &'static str {
    kind_suffix(kind).unwrap_or("")
}

/// The modes a tab of this kind offers, in button order. A PDF row is the
/// reader and is inked in place; everything else is Edit, with Ink where the
/// table says so.
#[must_use]
pub fn modes_for(kind: &str) -> Vec<DocumentMode> {
    let meta = kind_meta(kind);
    if meta.document == KindDocument::Pdf {
        return vec![DocumentMode::Ink];
    }
    if meta.ink {
        vec![DocumentMode::Edit, DocumentMode::Ink]
    } else {
        vec![DocumentMode::Edit]
    }
}

/// The mode a fresh tab of this kind opens in.
#[must_use]
pub fn default_mode_for(kind: &str) -> DocumentMode {
    modes_for(kind)
        .first()
        .copied()
        .unwrap_or(DocumentMode::Edit)
}

/// The mode an existing document opens in: a note whose body carries ink
/// opens on the sheet it was written on; every other kind keeps its default.
#[must_use]
pub fn open_mode_for(kind: &str, body: &str) -> DocumentMode {
    if modes_for(kind).contains(&DocumentMode::Ink) && is_ink_note_body(body) {
        DocumentMode::Ink
    } else {
        default_mode_for(kind)
    }
}

/// The tab that opens a document in its `open_mode_for` mode.
#[must_use]
pub fn opening_tab(kind: &str, id: &str, body: Option<&str>) -> TabRef {
    TabRef {
        kind: kind.to_owned(),
        id: id.to_owned(),
        mode: Some(open_mode_for(kind, body.unwrap_or(""))),
        group: None,
    }
}

/// Which renderer a kind mounts.
#[must_use]
pub fn document_kind(kind: &str) -> KindDocument {
    kind_meta(kind).document
}

/// The status-bar segments for a kind. Empty for anything unknown.
#[must_use]
pub fn segments_for(kind: &str) -> &'static [StatusSegment] {
    kind_meta(kind).segments
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::ink_note::INK_BODY_HEADER;

    #[test]
    fn unknown_kind_reads_as_the_folder_row() {
        assert_eq!(kind_icon("something_new"), kind_icon("folder"));
        assert!(!is_document_kind("something_new"));
        assert_eq!(kind_suffix("something_new"), None);
    }

    #[test]
    fn papers_sort_before_notes_and_non_members_last() {
        assert!(member_rank("paper") < member_rank("vault_page"));
        assert_eq!(member_rank("folder"), i32::MAX);
        assert_eq!(member_rank("milestone"), i32::MAX);
    }

    #[test]
    fn suffixes_match_the_filename_spelling() {
        assert_eq!(kind_suffix("vault_page"), Some(".note.md"));
        assert_eq!(kind_suffix("ink_page"), Some(".ink.md"));
        assert_eq!(kind_suffix("log_entry"), Some(".log.md"));
        assert_eq!(document_suffix("folder"), "");
    }

    #[test]
    fn kind_icon_class_tints_documents_and_only_open_folders() {
        assert_eq!(
            kind_icon_class("folder", true).as_deref(),
            Some("kind-tint-accent")
        );
        assert_eq!(kind_icon_class("folder", false), None);
        assert_eq!(
            kind_icon_class("vault_page", false).as_deref(),
            Some("kind-tint-info")
        );
    }

    #[test]
    fn modes_follow_the_table() {
        assert_eq!(modes_for("paper_pdf"), vec![DocumentMode::Ink]);
        assert_eq!(
            modes_for("vault_page"),
            vec![DocumentMode::Edit, DocumentMode::Ink]
        );
        assert_eq!(
            modes_for("paper"),
            vec![DocumentMode::Edit, DocumentMode::Ink]
        );
        assert_eq!(modes_for("experiment"), vec![DocumentMode::Edit]);
        assert_eq!(default_mode_for("vault_page"), DocumentMode::Edit);
    }

    #[test]
    fn opening_tab_keeps_a_non_ink_note_on_edit() {
        let tab = opening_tab("vault_page", "a", Some("plain text"));
        assert_eq!(tab.kind, "vault_page");
        assert_eq!(tab.id, "a");
        assert_eq!(tab.mode, Some(DocumentMode::Edit));
        assert_eq!(tab.group, None);
    }

    #[test]
    fn opening_an_ink_note_lands_on_ink() {
        let body = format!("{INK_BODY_HEADER} page=1 -->\n");
        assert_eq!(open_mode_for("vault_page", &body), DocumentMode::Ink);
        assert_eq!(open_mode_for("experiment", &body), DocumentMode::Edit);
    }

    #[test]
    fn link_groups_and_owners_match_the_table() {
        assert_eq!(link_group_of("paper"), Some(LinkGroup::Papers));
        assert_eq!(link_group_of("report_section"), Some(LinkGroup::Sections));
        assert_eq!(kind_owner("report_section"), KindOwner::Report);
        assert_eq!(kind_owner("vault_page"), KindOwner::Vault);
        assert!(is_creatable_kind("ink_page"));
        assert!(!is_creatable_kind("paper"));
    }
}
