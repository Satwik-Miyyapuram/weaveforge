//! The meaning-search status line, ported from
//! `apps/web/src/features/settings/ui/semantic-status-text.ts`. Pure: no I/O.
//!
//! The line says what the meaning-search arm is doing and, once done, that it works.

use serde::Deserialize;

/// A newer model embedding in the background.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Upgrading {
    /// The model being upgraded to.
    pub to: String,
    /// Passages embedded so far.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub done: u64,
    /// Passages to embed; zero when not yet counted.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub total: u64,
}

/// What the meaning-search arm is doing. Mirrors the TS `SemanticStatus` union.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum SemanticStatus {
    /// Not started.
    Off,
    /// The model is downloading.
    Downloading {
        /// Bytes received.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        loaded: u64,
        /// Bytes expected.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        total: u64,
    },
    /// The model is loading into memory.
    Loading,
    /// Passages are being embedded.
    Embedding {
        /// Passages embedded so far.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        done: u64,
        /// Passages to embed; zero when not yet counted.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        total: u64,
    },
    /// Search is answering.
    Ready {
        /// Passages searchable by meaning.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        passages: u64,
        /// The model answering.
        model: String,
        /// A newer model embedding in the background, if any.
        #[serde(default)]
        upgrading: Option<Upgrading>,
        /// The desktop's own encoder failed to load, so the web worker answers.
        #[serde(default)]
        fallback: bool,
    },
    /// Meaning search failed.
    Error {
        /// Why it failed.
        message: String,
    },
}

/// The one line for `status`, as the settings panel shows it.
#[must_use]
pub fn semantic_status_text(status: &SemanticStatus) -> String {
    match status {
        SemanticStatus::Downloading { loaded, total } => {
            let denom = (*total).max(1) as f64;
            // A floored, non-negative percentage of a count: the cast is exact.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let percent = ((*loaded as f64 / denom) * 100.0 + 0.5).floor() as u64;
            format!("Downloading the model — {percent}%")
        }
        SemanticStatus::Loading => "Starting the model…".to_owned(),
        SemanticStatus::Embedding { done, total } => {
            if *total > 0 {
                format!(
                    "Reading your workspace — {} of {} passages",
                    thousands(*done),
                    thousands(*total)
                )
            } else {
                "Reading your workspace…".to_owned()
            }
        }
        SemanticStatus::Ready {
            passages,
            model,
            upgrading,
            fallback,
        } => match upgrading {
            Some(up) => {
                let progress = if up.total > 0 {
                    format!(
                        " — {} of {} passages",
                        thousands(up.done),
                        thousands(up.total)
                    )
                } else {
                    "…".to_owned()
                };
                format!(
                    "On ({model}). Upgrading to {} in the background{progress}. Search keeps using the current model until it is done.",
                    up.to
                )
            }
            None => {
                let note = if *fallback {
                    " The app's own encoder did not load, so the browser's is used."
                } else {
                    ""
                };
                format!(
                    "On — {} passages searchable by meaning ({model}). New and edited items are added as you work.{note}",
                    thousands(*passages)
                )
            }
        },
        SemanticStatus::Error { message } => {
            format!("Not working: {message}. Keyword search is unaffected.")
        }
        SemanticStatus::Off => "Waiting to start…".to_owned(),
    }
}

/// `n` with a comma between each group of three digits, as `toLocaleString` (en-US) writes it.
fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let len = digits.len();
    let mut out = String::with_capacity(len + len / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_thousands_like_en_us() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1000), "1,000");
        assert_eq!(thousands(1234567), "1,234,567");
    }

    #[test]
    fn ready_with_fallback_says_so() {
        let status = SemanticStatus::Ready {
            passages: 3,
            model: "MiniLM".to_owned(),
            upgrading: None,
            fallback: true,
        };
        assert_eq!(
            semantic_status_text(&status),
            "On — 3 passages searchable by meaning (MiniLM). New and edited items are added as you work. The app's own encoder did not load, so the browser's is used."
        );
    }

    #[test]
    fn downloading_rounds_half_up() {
        let status = SemanticStatus::Downloading {
            loaded: 1,
            total: 2,
        };
        assert_eq!(semantic_status_text(&status), "Downloading the model — 50%");
        let zero = SemanticStatus::Downloading {
            loaded: 5,
            total: 0,
        };
        assert_eq!(semantic_status_text(&zero), "Downloading the model — 500%");
    }

    #[test]
    fn upgrading_without_total_has_ellipsis() {
        let status = SemanticStatus::Ready {
            passages: 3,
            model: "A".to_owned(),
            upgrading: Some(Upgrading {
                to: "B".to_owned(),
                done: 0,
                total: 0,
            }),
            fallback: false,
        };
        assert_eq!(
            semantic_status_text(&status),
            "On (A). Upgrading to B in the background…. Search keeps using the current model until it is done."
        );
    }

    #[test]
    fn off_and_error_lines() {
        assert_eq!(
            semantic_status_text(&SemanticStatus::Off),
            "Waiting to start…"
        );
        assert_eq!(
            semantic_status_text(&SemanticStatus::Error {
                message: "offline".to_owned()
            }),
            "Not working: offline. Keyword search is unaffected."
        );
    }
}
