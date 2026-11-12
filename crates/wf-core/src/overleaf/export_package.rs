//! Overleaf export package: the `main.tex` preamble, the bibliography scope, `references.bib`,
//! `manifest.json` and `README.txt` (TS `buildOverleafExportPackage` in `application/parts.ts`).
//! The section walk and the cite keys come from the caller. Pure: the caller passes `exported_at`
//! as an ISO string, so this module never reads the clock.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::overleaf::bibtex::{self, BibPaper};
use crate::overleaf_export_package::{
    ExportFile, ExportImage, ManifestStats, OverleafManifest, escape_title, manifest_contents,
};
use crate::reader_analysis::lines::js_trim;

/// Packages loaded only when the body uses TikZ (a PRISMA figure).
pub const PRISMA_FIGURE_PACKAGES: [&str; 2] = ["tikz", "float"];

/// Title used when the report does not give one.
pub const DEFAULT_TITLE: &str = "WeaveForge report export";

/// The `note` field of `manifest.json`.
pub const MANIFEST_NOTE: &str =
    "Upload these files to a new or existing Overleaf project. WeaveForge does not push to Overleaf.";

/// Which papers `references.bib` holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BibliographyScope {
    /// Every paper in the library; `main.tex` adds `\nocite{*}`.
    #[default]
    All,
    /// Only the papers the report cites.
    Cited,
}

impl BibliographyScope {
    /// The scope as the manifest and the TS option spell it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Cited => "cited",
        }
    }
}

/// One paper for `references.bib`, with the cite key the caller chose for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    /// The paper fields the entry reads.
    pub paper: BibPaper,
    /// Cite key; empty when the caller has none.
    pub key: String,
}

/// What the caller computed before the package is built.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackageInput {
    /// Body lines of `main.tex` (the section walk output).
    pub body: Vec<String>,
    /// Warnings the section walk raised.
    pub walk_warnings: Vec<String>,
    /// Figures to place under `figures/`.
    pub images: Vec<ExportImage>,
    /// Sections exported.
    pub sections: u32,
    /// Approximate equation count.
    pub equations_approx: u32,
    /// Figures exported.
    pub figures: u32,
    /// Document title; blank or absent uses [`DEFAULT_TITLE`].
    #[serde(default)]
    pub title: Option<String>,
    /// Whether a bibliography is part of the package.
    pub include_bibliography: bool,
    /// Which papers the bibliography holds.
    #[serde(default)]
    pub bibliography_scope: BibliographyScope,
    /// Manifest and README timestamp, ISO 8601, supplied by the caller.
    pub exported_at: String,
}

/// The built package.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackage {
    /// `main.tex`, `references.bib` (when a bibliography is included), `manifest.json`, `README.txt`.
    pub files: Vec<ExportFile>,
    /// Warnings, including the empty-report one (which the manifest does not list).
    pub warnings: Vec<String>,
    /// Counts for the report.
    pub stats: ManifestStats,
}

/// Build the package. `entries` holds every library paper (empty when there is none or no
/// bibliography is included); `scope` decides which of them `references.bib` keeps.
///
/// # Errors
///
/// A `serde_json` error when the manifest cannot be serialised (not expected for this shape).
pub fn build_export_package(
    input: &ExportPackageInput,
    entries: &[BibEntry],
) -> Result<ExportPackage, serde_json::Error> {
    let include_bib = input.include_bibliography;
    let scope = input.bibliography_scope;
    let mut warnings = input.walk_warnings.clone();
    let mut stats = ManifestStats {
        sections: input.sections,
        equations_approx: input.equations_approx,
        bibliography_entries: 0,
        figures: input.figures,
    };

    // Decide the bibliography set before the preamble, because `\nocite{*}` and
    // `\printbibliography` must agree with what actually lands in references.bib.
    let cited: HashSet<String> = bibtex::collect_cited_keys(&input.body.join("\n"))
        .into_iter()
        .collect();
    let bib_entries: Vec<&BibEntry> = if include_bib && !entries.is_empty() {
        match scope {
            BibliographyScope::All => entries.iter().collect(),
            BibliographyScope::Cited => entries
                .iter()
                .filter(|e| cited.contains(&e.key))
                .collect(),
        }
    } else {
        Vec::new()
    };
    if include_bib
        && scope == BibliographyScope::Cited
        && !entries.is_empty()
        && bib_entries.is_empty()
    {
        warnings.push(
            "Bibliography set to cited-only, but the report cites no papers — references.bib is empty."
                .to_owned(),
        );
    }

    let uses_tikz = input
        .body
        .iter()
        .any(|chunk| chunk.contains("\\begin{tikzpicture}"));
    let title = input
        .title
        .as_deref()
        .map(js_trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(DEFAULT_TITLE);

    let mut lines: Vec<String> = vec![
        "% Generated by WeaveForge — Overleaf export package.".to_owned(),
        "% This plaintext left the WeaveForge RLS boundary by explicit user action.".to_owned(),
        "\\documentclass[11pt,a4paper]{report}".to_owned(),
        "\\usepackage[utf8]{inputenc}".to_owned(),
        "\\usepackage[T1]{fontenc}".to_owned(),
        "\\usepackage{hyperref}".to_owned(),
        "\\usepackage{graphicx}".to_owned(),
    ];
    if uses_tikz {
        lines.extend(
            PRISMA_FIGURE_PACKAGES
                .iter()
                .map(|pkg| format!("\\usepackage{{{pkg}}}")),
        );
    }
    if include_bib {
        lines.push("\\usepackage[backend=biber,style=numeric]{biblatex}".to_owned());
        lines.push("\\addbibresource{references.bib}".to_owned());
    } else {
        lines.push("% no bibliography".to_owned());
    }
    lines.push(format!("\\title{{{}}}", escape_title(title)));
    lines.push("\\author{}".to_owned());
    lines.push("\\date{\\today}".to_owned());
    lines.push("\\begin{document}".to_owned());
    lines.push("\\maketitle".to_owned());
    lines.push("\\tableofcontents".to_owned());
    lines.push("\\clearpage".to_owned());
    lines.extend(input.body.iter().cloned());
    // Numeric style prints only cited entries, so an "all" export needs this or
    // the PDF silently omits most of references.bib.
    if scope == BibliographyScope::All && !bib_entries.is_empty() {
        lines.push("\\nocite{*}".to_owned());
    }
    if bib_entries.is_empty() {
        lines.push("% no bibliography entries".to_owned());
    } else {
        lines.push("\\printbibliography".to_owned());
    }
    lines.push("\\end{document}".to_owned());
    lines.push(String::new());
    // Empty strings are dropped, as the TS join did, including empty body lines.
    let main_tex = lines
        .iter()
        .filter(|line| !line.is_empty())
        .map(String::as_str)
        .collect::<Vec<&str>>()
        .join("\n");

    let mut files = vec![ExportFile {
        path: "main.tex".to_owned(),
        contents: main_tex,
    }];

    if !bib_entries.is_empty() {
        let rendered: Vec<String> = bib_entries
            .iter()
            .map(|e| bibtex::paper_to_bibtex(&e.paper, &e.key))
            .collect();
        stats.bibliography_entries = u32::try_from(bib_entries.len()).unwrap_or(u32::MAX);
        files.push(ExportFile {
            path: "references.bib".to_owned(),
            contents: bibtex::join_bibtex(&rendered),
        });
    } else if include_bib {
        if entries.is_empty() {
            warnings.push("Bibliography requested but no papers were available.".to_owned());
        }
        files.push(ExportFile {
            path: "references.bib".to_owned(),
            contents: bibtex::join_bibtex(&[]),
        });
    }

    // The manifest lists the warnings raised so far; the empty-report warning comes after it.
    let mut manifest_files: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    manifest_files.extend(input.images.iter().map(|i| i.zip_path.clone()));
    let manifest = OverleafManifest {
        schema_version: 1,
        exported_at: input.exported_at.clone(),
        app: "WeaveForge".to_owned(),
        kind: "overleaf-export-package".to_owned(),
        title: title.to_owned(),
        bibliography_scope: include_bib.then(|| scope.as_str().to_owned()),
        files: manifest_files,
        stats: stats.clone(),
        warnings: warnings.clone(),
        note: MANIFEST_NOTE.to_owned(),
        missing_figures: None,
    };
    files.push(ExportFile {
        path: "manifest.json".to_owned(),
        contents: manifest_contents(&manifest)?,
    });
    files.push(ExportFile {
        path: "README.txt".to_owned(),
        contents: readme(&input.exported_at, include_bib, scope),
    });

    if stats.sections == 0 {
        warnings.push("Report has no sections — main.tex is an empty shell.".to_owned());
    }

    Ok(ExportPackage {
        files,
        warnings,
        stats,
    })
}

/// `README.txt` of the package.
fn readme(exported_at: &str, include_bib: bool, scope: BibliographyScope) -> String {
    let bib_line = if include_bib {
        match scope {
            BibliographyScope::Cited => "  references.bib   — only the papers cited in this report",
            BibliographyScope::All => {
                "  references.bib   — your whole paper library; main.tex uses \\nocite{*} so every entry prints"
            }
        }
    } else {
        "  references.bib   — not included"
    };
    [
        "WeaveForge → Overleaf export package".to_owned(),
        format!("Exported at: {exported_at}"),
        String::new(),
        "Contents:".to_owned(),
        "  main.tex         — report outline (+ section notes as LaTeX)".to_owned(),
        bib_line.to_owned(),
        "  figures/         — images from section notes (if any)".to_owned(),
        "  manifest.json    — export metadata and warnings".to_owned(),
        String::new(),
        "How to use:".to_owned(),
        "  1. Create a new Overleaf project (or open an existing one).".to_owned(),
        "  2. Upload main.tex, references.bib, and the figures/ folder.".to_owned(),
        "  3. Compile in Overleaf. Fix any warnings listed in manifest.json.".to_owned(),
        String::new(),
        "Citations: [[Paper Title]] wikilinks in section notes become \\cite{…} when".to_owned(),
        "the title matches a paper in your library (case-insensitive).".to_owned(),
        String::new(),
        "Privacy: this ZIP contains plaintext. It left WeaveForge by your explicit export.".to_owned(),
        "WeaveForge never stores this package or your Overleaf Git token in the browser export path."
            .to_owned(),
        String::new(),
    ]
    .join("\n")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::Value;

    const EXPORTED_AT: &str = "2026-11-12T00:00:00.000Z";

    fn entry(id: &str, title: &str, key: &str) -> BibEntry {
        BibEntry {
            paper: BibPaper {
                id: id.to_owned(),
                title: title.to_owned(),
                authors: vec!["Ada Lovelace".to_owned()],
                year: Some(1843),
                ..BibPaper::default()
            },
            key: key.to_owned(),
        }
    }

    fn two_papers() -> Vec<BibEntry> {
        vec![
            entry("p1", "A Paper", "a2026"),
            entry("p2", "Uncited Paper", "u2026"),
        ]
    }

    fn input(body: &[&str], include_bib: bool, scope: BibliographyScope) -> ExportPackageInput {
        ExportPackageInput {
            body: body.iter().map(|s| (*s).to_owned()).collect(),
            walk_warnings: Vec::new(),
            images: Vec::new(),
            sections: 1,
            equations_approx: 0,
            figures: 0,
            title: None,
            include_bibliography: include_bib,
            bibliography_scope: scope,
            exported_at: EXPORTED_AT.to_owned(),
        }
    }

    fn contents<'a>(pkg: &'a ExportPackage, path: &str) -> &'a str {
        pkg.files
            .iter()
            .find(|f| f.path == path)
            .map(|f| f.contents.as_str())
            .unwrap()
    }

    fn manifest(pkg: &ExportPackage) -> Value {
        serde_json::from_str(contents(pkg, "manifest.json")).unwrap()
    }

    #[test]
    // it: buildOverleafExportPackage emits main.tex, bib, manifest
    fn emits_main_bib_manifest_and_readme() {
        let mut inp = input(&["\\chapter{Introduction}"], true, BibliographyScope::All);
        inp.title = Some("Demo".to_owned());
        let pkg = build_export_package(&inp, &[entry("p1", "A Paper", "a2026")]).unwrap();
        let mut paths: Vec<&str> = pkg.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort_unstable();
        assert_eq!(
            paths,
            ["README.txt", "main.tex", "manifest.json", "references.bib"]
        );
        let main = contents(&pkg, "main.tex");
        assert!(main.contains("\\chapter{Introduction}"), "{main}");
        assert!(main.contains("\\title{Demo}"), "{main}");
        assert_eq!(pkg.stats.bibliography_entries, 1);
        assert!(pkg.warnings.is_empty(), "{:?}", pkg.warnings);
    }

    #[test]
    // it: buildOverleafExportPackage omits notes and bib when disabled
    fn omits_bib_when_disabled() {
        let pkg = build_export_package(
            &input(&["Plain text."], false, BibliographyScope::All),
            &[],
        )
        .unwrap();
        assert!(pkg.files.iter().all(|f| f.path != "references.bib"));
        let main = contents(&pkg, "main.tex");
        assert!(main.contains("% no bibliography\n"), "{main}");
        assert!(!main.contains("biblatex"), "{main}");
        assert!(contents(&pkg, "README.txt").contains("references.bib   — not included"));
        assert_eq!(manifest(&pkg)["bibliographyScope"], Value::Null);
    }

    #[test]
    // it: bibliographyScope 'all' exports every paper and adds nocite
    fn scope_all_exports_every_paper_with_nocite() {
        let pkg = build_export_package(
            &input(&["\\cite{a2026}"], true, BibliographyScope::All),
            &two_papers(),
        )
        .unwrap();
        assert!(contents(&pkg, "references.bib").contains("Uncited Paper"));
        assert_eq!(pkg.stats.bibliography_entries, 2);
        let main = contents(&pkg, "main.tex");
        assert!(main.contains("\\nocite{*}"), "{main}");
        assert!(main.contains("\\printbibliography"), "{main}");
    }

    #[test]
    // it: bibliographyScope 'cited' drops uncited papers and omits nocite
    fn scope_cited_drops_uncited_and_omits_nocite() {
        let pkg = build_export_package(
            &input(&["\\cite{a2026}"], true, BibliographyScope::Cited),
            &two_papers(),
        )
        .unwrap();
        let bib = contents(&pkg, "references.bib");
        assert!(bib.contains("A Paper"));
        assert!(!bib.contains("Uncited Paper"));
        assert_eq!(pkg.stats.bibliography_entries, 1);
        assert!(!contents(&pkg, "main.tex").contains("\\nocite"));
    }

    #[test]
    // it: bibliographyScope 'cited' warns when the report cites nothing
    fn scope_cited_warns_when_nothing_cited() {
        let pkg = build_export_package(
            &input(&["No citations here."], true, BibliographyScope::Cited),
            &two_papers(),
        )
        .unwrap();
        assert_eq!(pkg.stats.bibliography_entries, 0);
        assert!(
            pkg.warnings.iter().any(|w| w.contains("cites no papers")),
            "{:?}",
            pkg.warnings
        );
        let main = contents(&pkg, "main.tex");
        assert!(!main.contains("\\printbibliography"), "{main}");
        assert!(main.contains("% no bibliography entries"), "{main}");
    }

    #[test]
    fn requested_bib_without_papers_warns_and_writes_empty_bib() {
        let pkg = build_export_package(&input(&[], true, BibliographyScope::All), &[]).unwrap();
        assert!(
            pkg.warnings
                .iter()
                .any(|w| w == "Bibliography requested but no papers were available."),
            "{:?}",
            pkg.warnings
        );
        assert!(contents(&pkg, "references.bib").starts_with('%'));
    }

    #[test]
    fn title_is_latex_escaped_and_blank_title_falls_back() {
        let mut inp = input(&[], false, BibliographyScope::All);
        inp.title = Some("Q&A 100% {x}".to_owned());
        let pkg = build_export_package(&inp, &[]).unwrap();
        assert!(contents(&pkg, "main.tex").contains("\\title{Q\\&A 100\\% \\{x\\}}"));
        assert_eq!(manifest(&pkg)["title"], "Q&A 100% {x}");

        inp.title = Some("   ".to_owned());
        let pkg = build_export_package(&inp, &[]).unwrap();
        assert!(contents(&pkg, "main.tex").contains("\\title{WeaveForge report export}"));
        assert_eq!(manifest(&pkg)["title"], DEFAULT_TITLE);
    }

    #[test]
    fn tikz_body_loads_prisma_packages() {
        let with = build_export_package(
            &input(&["\\begin{tikzpicture}"], false, BibliographyScope::All),
            &[],
        )
        .unwrap();
        let main = contents(&with, "main.tex");
        assert!(main.contains("\\usepackage{tikz}\n\\usepackage{float}\n"), "{main}");

        let without =
            build_export_package(&input(&["plain"], false, BibliographyScope::All), &[]).unwrap();
        assert!(!contents(&without, "main.tex").contains("tikz"));
    }

    #[test]
    fn empty_body_lines_are_dropped() {
        let pkg = build_export_package(
            &input(&["", "x"], false, BibliographyScope::All),
            &[],
        )
        .unwrap();
        assert!(
            contents(&pkg, "main.tex").ends_with("\\clearpage\nx\n% no bibliography entries\n\\end{document}"),
            "{}",
            contents(&pkg, "main.tex")
        );
    }

    #[test]
    fn manifest_lists_files_and_figures_and_snapshots_warnings() {
        let mut inp = input(&[], true, BibliographyScope::All);
        inp.sections = 0;
        inp.images = vec![ExportImage {
            storage_path: "o/s/a.webp".to_owned(),
            zip_path: "figures/a.webp".to_owned(),
        }];
        let pkg = build_export_package(&inp, &two_papers()).unwrap();
        let m = manifest(&pkg);
        assert_eq!(m["schemaVersion"], 1);
        assert_eq!(m["exportedAt"], EXPORTED_AT);
        assert_eq!(m["kind"], "overleaf-export-package");
        assert_eq!(m["bibliographyScope"], "all");
        assert_eq!(
            m["files"],
            serde_json::json!(["main.tex", "references.bib", "figures/a.webp"])
        );
        assert_eq!(m["stats"]["bibliographyEntries"], 2);
        assert!(m.get("missingFigures").is_none());
        // The empty-report warning is returned but was added after the manifest snapshot.
        assert!(pkg.warnings.iter().any(|w| w.contains("no sections")));
        assert!(!m["warnings"].to_string().contains("no sections"));
        assert!(contents(&pkg, "manifest.json").ends_with("}\n"));
    }

    #[test]
    fn scope_cited_in_manifest_and_readme() {
        let pkg = build_export_package(
            &input(&["\\cite{a2026}"], true, BibliographyScope::Cited),
            &two_papers(),
        )
        .unwrap();
        assert_eq!(manifest(&pkg)["bibliographyScope"], "cited");
        assert!(contents(&pkg, "README.txt")
            .contains("references.bib   — only the papers cited in this report"));
        assert!(contents(&pkg, "README.txt").contains("Exported at: 2026-11-12T00:00:00.000Z\n"));
    }
}
