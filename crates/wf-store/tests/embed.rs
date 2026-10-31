//! Tests for native sentence embeddings: profiles, prompts, pooling and the optional model comparisons.

use std::path::Path;
use std::time::Instant;

use wf_store::embed::{
    EmbedKind, Encoder, MAX_TEXT_CHARS, MAX_TOKENS, Pooling, Profile, normalize, pad_rows,
    pool_cls, pool_mean, prepare, profile_for,
};

const ARCTIC: &str = "Snowflake/snowflake-arctic-embed-m-v1.5";
const ARCTIC_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

fn arctic_profile() -> Profile {
    profile_for(ARCTIC)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot / (norm_a * norm_b)
}

#[test]
fn profile_for_known_and_unknown_models() {
    assert_eq!(
        profile_for(ARCTIC),
        Profile {
            pooling: Pooling::Cls,
            query_prefix: ARCTIC_PREFIX
        }
    );
    assert_eq!(
        profile_for("Xenova/all-MiniLM-L6-v2"),
        Profile {
            pooling: Pooling::Mean,
            query_prefix: ""
        }
    );
    assert_eq!(
        profile_for("some/unknown-model"),
        Profile {
            pooling: Pooling::Mean,
            query_prefix: ""
        }
    );
}

#[test]
fn prepare_applies_prefix_only_to_queries() {
    let texts = vec!["  hi  ".to_string()];

    let query = prepare(&texts, EmbedKind::Query, arctic_profile());
    assert_eq!(query, vec![format!("{ARCTIC_PREFIX}hi")]);

    let passage = prepare(&texts, EmbedKind::Passage, arctic_profile());
    assert_eq!(passage, vec!["  hi  ".to_string()]);

    let minilm = profile_for("Xenova/all-MiniLM-L6-v2");
    let minilm_query = prepare(&texts, EmbedKind::Query, minilm);
    assert_eq!(minilm_query, vec!["hi".to_string()]);
}

#[test]
fn pool_cls_picks_first_token_of_each_item() {
    // batch 2, seq 2, dim 2: row-major [batch, seq, dim]
    let hidden = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
    let pooled = pool_cls(&hidden, 2, 2, 2);
    assert_eq!(pooled, vec![vec![1.0, 2.0], vec![5.0, 6.0]]);
}

#[test]
fn pool_mean_ignores_padding_and_handles_empty_mask() {
    // batch 2, seq 3, dim 2; item 0 has one padded token, item 1 has none
    let hidden = [
        1.0, 2.0, 3.0, 4.0, 100.0, 100.0, 2.0, 2.0, 4.0, 4.0, 9.0, 9.0,
    ];
    let mask = [1, 1, 0, 1, 1, 1];
    let pooled = pool_mean(&hidden, &mask, 2, 3, 2);
    assert_eq!(pooled, vec![vec![2.0, 3.0], vec![5.0, 5.0]]);

    let zero_hidden = [1.0, 2.0, 3.0, 4.0];
    let zero_mask = [0, 0];
    let zeros = pool_mean(&zero_hidden, &zero_mask, 1, 2, 2);
    assert_eq!(zeros, vec![vec![0.0, 0.0]]);
}

#[test]
fn normalize_scales_to_unit_length_and_keeps_zero() {
    let mut v = [3.0_f32, 4.0];
    normalize(&mut v);
    assert!((v[0] - 0.6).abs() < 1e-6, "got {}", v[0]);
    assert!((v[1] - 0.8).abs() < 1e-6, "got {}", v[1]);

    let mut zero = [0.0_f32, 0.0];
    normalize(&mut zero);
    assert_eq!(zero, [0.0, 0.0]);
}

#[test]
fn short_hidden_slice_pads_with_zero() {
    // batch 2, seq 2, dim 2 needs 8 values; only 2 supplied
    let pooled = pool_cls(&[1.0, 2.0], 2, 2, 2);
    assert_eq!(pooled, vec![vec![1.0, 2.0], vec![0.0, 0.0]]);
}

#[test]
fn pad_rows_pads_short_rows_to_the_longest() {
    let padded = pad_rows(&[&[101, 7, 102], &[101, 102]], 0);
    assert_eq!(padded.seq_len, 3);
    assert_eq!(padded.ids, vec![101, 7, 102, 101, 102, 0]);
    assert_eq!(padded.mask, vec![1, 1, 1, 1, 1, 0]);
}

#[test]
fn pad_rows_cuts_long_rows_to_max_tokens() {
    let long: Vec<u32> = (0..600).collect();
    let short = [101_u32, 102];
    let padded = pad_rows(&[&long, &short], 9);
    assert_eq!(padded.seq_len, MAX_TOKENS);
    assert_eq!(padded.ids.len(), 2 * MAX_TOKENS);
    assert_eq!(padded.ids[MAX_TOKENS - 1], 511);
    assert_eq!(padded.ids[MAX_TOKENS], 101);
    assert_eq!(padded.ids[MAX_TOKENS + 2], 9);
    assert_eq!(
        padded.mask.iter().filter(|&&m| m == 1).count(),
        MAX_TOKENS + 2
    );
}

#[test]
fn pad_rows_of_nothing_is_empty() {
    let padded = pad_rows(&[], 0);
    assert_eq!(padded.seq_len, 0);
    assert!(padded.ids.is_empty());
    assert!(padded.mask.is_empty());
}

#[test]
fn prepare_caps_huge_texts_on_a_char_boundary() {
    let huge = vec!["é".repeat(MAX_TEXT_CHARS + 10)];
    let passage = prepare(&huge, EmbedKind::Passage, arctic_profile());
    assert_eq!(passage[0].chars().count(), MAX_TEXT_CHARS);

    let query = prepare(&huge, EmbedKind::Query, arctic_profile());
    assert_eq!(
        query[0].chars().count(),
        ARCTIC_PREFIX.chars().count() + MAX_TEXT_CHARS
    );
}

#[test]
fn prepare_keeps_prose_after_a_long_opening_word() {
    let text = format!("{} the prose that follows", "a".repeat(9000));
    let passage = prepare(
        std::slice::from_ref(&text),
        EmbedKind::Passage,
        arctic_profile(),
    );
    assert_eq!(passage[0], text);
    assert!(passage[0].ends_with(" the prose that follows"));
}

/// Reads the model folder, or says why a model test is skipped.
fn model_dir_or_skip() -> Option<String> {
    let dir = std::env::var("WF_EMBED_MODEL_DIR").ok();
    if dir.is_none() {
        eprintln!("skipped: set WF_EMBED_MODEL_DIR to a folder holding {ARCTIC}");
    }
    dir
}

#[test]
fn model_matches_transformers_js() {
    let Some(model_dir) = model_dir_or_skip() else {
        return;
    };

    let fixture_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/embed-arctic.json");
    let raw = std::fs::read_to_string(&fixture_path).expect("fixture readable");
    let fixture: serde_json::Value = serde_json::from_str(&raw).expect("fixture is JSON");

    let model = fixture["model"]
        .as_str()
        .expect("fixture model")
        .to_string();
    let profile = profile_for(&model);
    let dir = Path::new(&model_dir)
        .join(&model)
        .join("resolve")
        .join("main");
    let mut encoder = Encoder::open(&dir, profile).expect("encoder opens");

    let items = fixture["items"].as_array().expect("fixture items");
    assert!(!items.is_empty(), "fixture has no items");
    for item in items {
        let text = item["text"].as_str().expect("item text").to_string();
        let kind = match item["kind"].as_str().expect("item kind") {
            "query" => EmbedKind::Query,
            _ => EmbedKind::Passage,
        };
        let expected: Vec<f32> =
            serde_json::from_value(item["vector"].clone()).expect("item vector is numbers");

        let got = encoder
            .embed(std::slice::from_ref(&text), kind)
            .expect("embed succeeds");
        let cos = cosine(&got[0], &expected);
        assert!(cos >= 0.999, "cosine {cos} < 0.999 for {text:?}");
    }
}

#[test]
#[ignore = "needs WF_EMBED_MODEL_DIR and a real model; run manually"]
fn embeds_1039_passages_under_a_minute() {
    let Some(model_dir) = model_dir_or_skip() else {
        return;
    };

    let dir = Path::new(&model_dir)
        .join(ARCTIC)
        .join("resolve")
        .join("main");
    let mut encoder = Encoder::open(&dir, arctic_profile()).expect("encoder opens");

    let words = [
        "alpha", "river", "lantern", "cobalt", "garden", "signal", "ember", "harbor",
    ];
    let passages: Vec<String> = (0..1039)
        .map(|i| {
            (0..60)
                .map(|j| words[(i + j) % words.len()])
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();

    let started = Instant::now();
    let vectors = encoder
        .embed(&passages, EmbedKind::Passage)
        .expect("embed succeeds");
    let elapsed = started.elapsed();

    assert!(elapsed.as_secs() < 60, "took {elapsed:?}");
    assert_eq!(vectors.len(), 1039);
    assert!(vectors.iter().all(|v| v.len() == encoder.dimensions()));
}
