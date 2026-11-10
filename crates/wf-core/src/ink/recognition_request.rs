//! Port of `readInkRequest` in apps/desktop/src/ink-recogniser.ts. Pure.
//!
//! The page's request, checked whole before it goes to the Windows Ink helper: lines of strokes of
//! finite numbers, an optional word list and an optional language. Anything else is `None`. Only
//! the known fields are kept. A field that is present as JSON `null` is refused, as `null` is not
//! `undefined` in the TS. NaN and infinities cannot appear in JSON, so they are refused upstream.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One line of writing: flat `[x, y, pressure, x, y, pressure, ...]` per stroke.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InkRecognitionLineInput {
    /// Strokes.
    pub strokes: Vec<Vec<f64>>,
}

/// The checked request. `vocabulary` and `lang` are absent when the page did not send them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InkRecognitionRequest {
    /// Lines.
    pub lines: Vec<InkRecognitionLineInput>,
    /// Vocabulary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vocabulary: Option<Vec<String>>,
    /// Lang.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

/// Reads the page's request, or `None` when any part of it is the wrong shape.
#[must_use]
pub fn read_ink_request(request: &Value) -> Option<InkRecognitionRequest> {
    let object = request.as_object()?;
    let lines = object.get("lines")?.as_array()?;
    let lines = lines.iter().map(read_line).collect::<Option<Vec<_>>>()?;
    let vocabulary = match object.get("vocabulary") {
        None => None,
        Some(words) => Some(
            words
                .as_array()?
                .iter()
                .map(|word| word.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()?,
        ),
    };
    let lang = match object.get("lang") {
        None => None,
        Some(lang) => Some(lang.as_str()?.to_owned()),
    };
    Some(InkRecognitionRequest {
        lines,
        vocabulary,
        lang,
    })
}

fn read_line(line: &Value) -> Option<InkRecognitionLineInput> {
    let strokes = line.as_object()?.get("strokes")?.as_array()?;
    let strokes = strokes
        .iter()
        .map(read_stroke)
        .collect::<Option<Vec<_>>>()?;
    Some(InkRecognitionLineInput { strokes })
}

fn read_stroke(stroke: &Value) -> Option<Vec<f64>> {
    stroke
        .as_array()?
        .iter()
        .map(|number| number.as_f64().filter(|value| value.is_finite()))
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn line(strokes: Vec<Vec<f64>>) -> InkRecognitionLineInput {
        InkRecognitionLineInput { strokes }
    }

    // xipc-22: the shape web's desktopInkRequest sends.
    #[test]
    fn the_web_pages_real_payload_is_accepted_as_it_is() {
        let sent = json!({
            "lines": [{ "strokes": [[10, 20, 128, 11, 21, 130], [30, 40, 0.5]] }, { "strokes": [] }],
            "vocabulary": ["entropy", "Kalman"],
            "lang": "en-GB",
        });
        assert_eq!(
            read_ink_request(&sent),
            Some(InkRecognitionRequest {
                lines: vec![
                    line(vec![
                        vec![10.0, 20.0, 128.0, 11.0, 21.0, 130.0],
                        vec![30.0, 40.0, 0.5]
                    ]),
                    line(vec![]),
                ],
                vocabulary: Some(vec!["entropy".to_owned(), "Kalman".to_owned()]),
                lang: Some("en-GB".to_owned()),
            }),
        );
    }

    #[test]
    fn absent_optional_fields_stay_absent() {
        assert_eq!(
            read_ink_request(&json!({ "lines": [], "vocabulary": [] })),
            Some(InkRecognitionRequest {
                lines: vec![],
                vocabulary: Some(vec![]),
                lang: None,
            }),
        );
        assert_eq!(
            read_ink_request(&json!({ "lines": [] })),
            Some(InkRecognitionRequest {
                lines: vec![],
                vocabulary: None,
                lang: None,
            }),
        );
    }

    #[test]
    fn unknown_fields_are_dropped() {
        assert_eq!(
            read_ink_request(&json!({ "lines": [], "extra": 1 })),
            Some(InkRecognitionRequest {
                lines: vec![],
                vocabulary: None,
                lang: None,
            }),
        );
    }

    #[test]
    fn anything_else_is_refused() {
        let bad = [
            json!(null),
            json!("lines"),
            json!([]),
            json!({ "lines": "x" }),
            json!({ "lines": [null] }),
            json!({ "lines": [{}] }),
            json!({ "lines": [{ "strokes": "x" }] }),
            json!({ "lines": [{ "strokes": [null] }] }),
            json!({ "lines": [{ "strokes": [[1, "2", 3]] }] }),
            json!({ "lines": [{ "strokes": [[1, null, 3]] }] }),
            json!({ "lines": [], "vocabulary": "word" }),
            json!({ "lines": [], "vocabulary": ["ok", 3] }),
            json!({ "lines": [], "vocabulary": null }),
            json!({ "lines": [], "lang": 7 }),
            json!({ "lines": [], "lang": null }),
        ];
        for request in &bad {
            assert_eq!(read_ink_request(request), None, "accepted {request}");
        }
    }
}
