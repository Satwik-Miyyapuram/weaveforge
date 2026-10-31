//! Native sentence embeddings matching transformers.js q8 ONNX models, on `ort` and `tokenizers`.

use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

/// Longest input in tokens; longer texts are cut to this.
pub const MAX_TOKENS: usize = 512;
/// Longest text in chars handed to the tokenizer, so one huge note cannot stall a batch.
///
/// 16 chars per token is far above real text, so the cut never changes the first [`MAX_TOKENS`]
/// tokens unless the text opens with thousands of blank chars.
pub const MAX_TEXT_CHARS: usize = MAX_TOKENS * 16;
/// Texts per model run; bounds the padded batch size.
pub const BATCH: usize = 32;
/// Files transformers.js fetches for a q8 encoder, relative to `<repo>/resolve/main/`.
pub const MODEL_FILES: [&str; 3] = ["onnx/model_quantized.onnx", "tokenizer.json", "config.json"];

const ARCTIC: &str = "Snowflake/snowflake-arctic-embed-m-v1.5";
const ARCTIC_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

/// How token vectors become one sentence vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pooling {
    /// Use the first token (`[CLS]`).
    Cls,
    /// Average the unpadded tokens.
    Mean,
}

/// Whether a text is a passage to be searched or a query searching for passages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedKind {
    /// A document or passage.
    Passage,
    /// A search query.
    Query,
}

/// Per-model settings: pooling and the query prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Profile {
    /// How token vectors are pooled.
    pub pooling: Pooling,
    /// Text put in front of each query.
    pub query_prefix: &'static str,
}

/// A failed embedding step, with a plain message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbedError(pub String);

impl fmt::Display for EmbedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for EmbedError {}

/// Settings for a model id; unknown ids use mean pooling and no prefix.
#[must_use]
pub fn profile_for(model_id: &str) -> Profile {
    if model_id == ARCTIC {
        Profile {
            pooling: Pooling::Cls,
            query_prefix: ARCTIC_PREFIX,
        }
    } else {
        Profile {
            pooling: Pooling::Mean,
            query_prefix: "",
        }
    }
}

/// Applies the query prefix (after trimming) to queries; passages pass through unchanged.
///
/// Each text is first cut to [`MAX_TEXT_CHARS`] chars.
#[must_use]
pub fn prepare(texts: &[String], kind: EmbedKind, profile: Profile) -> Vec<String> {
    texts
        .iter()
        .map(|text| match kind {
            EmbedKind::Query => format!("{}{}", profile.query_prefix, cap_chars(text.trim())),
            EmbedKind::Passage => cap_chars(text).to_string(),
        })
        .collect()
}

/// The first [`MAX_TEXT_CHARS`] chars of `text`.
fn cap_chars(text: &str) -> &str {
    text.char_indices()
        .nth(MAX_TEXT_CHARS)
        .map_or(text, |(end, _)| text.get(..end).unwrap_or(text))
}

/// Row-major token ids and attention mask for a batch, every row `seq_len` long.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Padded {
    /// Tokens per row.
    pub seq_len: usize,
    /// Token ids, `rows × seq_len`.
    pub ids: Vec<i64>,
    /// 1 for a real token, 0 for padding.
    pub mask: Vec<i64>,
}

/// Cuts each row to [`MAX_TOKENS`], then pads ids with `pad_id` and the mask with 0 to the longest row.
///
/// The cut comes after the special tokens were added, so a long text loses its closing `[SEP]`,
/// as in transformers.js; vectors then match the ones it stored.
#[must_use]
pub fn pad_rows(rows: &[&[u32]], pad_id: u32) -> Padded {
    let seq_len = rows
        .iter()
        .map(|row| row.len().min(MAX_TOKENS))
        .max()
        .unwrap_or(0);
    let capacity = rows.len().saturating_mul(seq_len);
    let mut ids = Vec::with_capacity(capacity);
    let mut mask = Vec::with_capacity(capacity);
    for row in rows {
        let kept = row.len().min(seq_len);
        ids.extend(row.iter().take(kept).map(|&id| i64::from(id)));
        mask.extend(std::iter::repeat_n(1, kept));
        let pad = seq_len.saturating_sub(kept);
        ids.extend(std::iter::repeat_n(i64::from(pad_id), pad));
        mask.extend(std::iter::repeat_n(0, pad));
    }
    Padded { seq_len, ids, mask }
}

/// Takes the first token of each item from row-major `[batch, seq_len, dim]` hidden states.
///
/// Missing values in a short `hidden` read as zero.
#[must_use]
pub fn pool_cls(hidden: &[f32], batch: usize, seq_len: usize, dim: usize) -> Vec<Vec<f32>> {
    (0..batch)
        .map(|b| read_or_zero(hidden, b.saturating_mul(seq_len).saturating_mul(dim), dim))
        .collect()
}

/// Averages the unmasked tokens of each item; `mask` is 0 for padding and 1 otherwise.
///
/// An item with no unmasked tokens gives a zero vector. Missing values read as zero.
#[must_use]
pub fn pool_mean(
    hidden: &[f32],
    mask: &[i64],
    batch: usize,
    seq_len: usize,
    dim: usize,
) -> Vec<Vec<f32>> {
    (0..batch)
        .map(|b| {
            let mut sum = vec![0.0_f32; dim];
            let mut count = 0.0_f32;
            for t in 0..seq_len {
                let token = b.saturating_mul(seq_len).saturating_add(t);
                if mask.get(token).copied().unwrap_or(0) == 0 {
                    continue;
                }
                count += 1.0;
                for (s, v) in
                    sum.iter_mut()
                        .zip(read_or_zero(hidden, token.saturating_mul(dim), dim))
                {
                    *s += v;
                }
            }
            if count > 0.0 {
                for s in &mut sum {
                    *s /= count;
                }
            }
            sum
        })
        .collect()
}

/// Divides `vector` by its L2 length in place; a zero vector is left unchanged.
pub fn normalize(vector: &mut [f32]) {
    let length = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
    if length > 0.0 {
        for x in vector.iter_mut() {
            *x /= length;
        }
    }
}

/// Copies `dim` values from `start`, reading past the end of `hidden` as zero.
fn read_or_zero(hidden: &[f32], start: usize, dim: usize) -> Vec<f32> {
    (0..dim)
        .map(|d| hidden.get(start.saturating_add(d)).copied().unwrap_or(0.0))
        .collect()
}

/// A loaded sentence encoder: tokenizer, ONNX session and the model's profile.
pub struct Encoder {
    session: Session,
    tokenizer: Tokenizer,
    profile: Profile,
    dimensions: usize,
    pad_id: u32,
    wants_types: bool,
    output_name: String,
}

// The shell moves an encoder to a worker thread, so it must stay `Send`.
const _: () = {
    const fn assert_send<T: Send>() {}
    assert_send::<Encoder>();
};

/// ONNX Runtime allows one environment per process; it is built under the lock, once.
static ENVIRONMENT: Mutex<Option<Environment>> = Mutex::new(None);

impl Encoder {
    /// Opens `tokenizer.json`, `config.json` and `onnx/model_quantized.onnx` from `dir`.
    ///
    /// # Errors
    ///
    /// Returns [`EmbedError`] when a file is missing or unreadable, or the model cannot load.
    pub fn open(dir: &Path, profile: Profile) -> Result<Self, EmbedError> {
        let tokenizer = load_tokenizer(&dir.join("tokenizer.json"))?;
        let dimensions = read_dimensions(&dir.join("config.json"))?;
        let session = load_session(&dir.join("onnx").join("model_quantized.onnx"))?;
        // BERT-style vocabularies put [PAD] at 0; padded positions are masked out anyway.
        let pad_id = tokenizer.token_to_id("[PAD]").unwrap_or(0);
        let wants_types = session
            .inputs()
            .iter()
            .any(|o| o.name() == "token_type_ids");
        let output_name = output_name(&session)?;
        Ok(Self {
            session,
            tokenizer,
            profile,
            dimensions,
            pad_id,
            wants_types,
            output_name,
        })
    }

    /// Length of each vector this encoder returns.
    #[must_use]
    pub fn dimensions(&self) -> usize {
        self.dimensions
    }

    /// Embeds `texts` as `kind` in batches of [`BATCH`]; each vector has unit length.
    ///
    /// # Errors
    ///
    /// Returns [`EmbedError`] when tokenizing or running the model fails.
    pub fn embed(
        &mut self,
        texts: &[String],
        kind: EmbedKind,
    ) -> Result<Vec<Vec<f32>>, EmbedError> {
        let prepared = prepare(texts, kind, self.profile);
        let mut vectors = Vec::with_capacity(prepared.len());
        for chunk in prepared.chunks(BATCH) {
            vectors.extend(self.embed_chunk(chunk)?);
        }
        Ok(vectors)
    }

    fn embed_chunk(&mut self, chunk: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let tokens = self.tokenize(chunk)?;
        let batch = chunk.len();
        let shape = [to_i64(batch)?, to_i64(tokens.seq_len)?];
        let expected = [shape[0], shape[1], to_i64(self.dimensions)?];
        let (profile, dimensions) = (self.profile, self.dimensions);

        let count = tokens.ids.len();
        let input_ids = int_tensor(&shape, tokens.ids)?;
        let attention = int_tensor(&shape, tokens.mask.clone())?;
        let result = if self.wants_types {
            let token_types = int_tensor(&shape, vec![0; count])?;
            self.session.run(ort::inputs![
                "input_ids" => input_ids,
                "attention_mask" => attention,
                "token_type_ids" => token_types
            ])
        } else {
            self.session
                .run(ort::inputs!["input_ids" => input_ids, "attention_mask" => attention])
        };
        let outputs = result.map_err(|e| EmbedError(format!("the model could not run: {e}")))?;

        let name = self.output_name.as_str();
        let value = outputs
            .get(name)
            .ok_or_else(|| EmbedError(format!("the model did not return {name}")))?;
        let (got, hidden) = value
            .try_extract_tensor::<f32>()
            .map_err(|e| EmbedError(format!("the model output could not be read: {e}")))?;
        // A wrong shape would be pooled into wrong vectors without any error, so refuse it.
        if got[..] != expected[..] {
            return Err(EmbedError(format!(
                "the model returned shape {:?}, expected {expected:?}",
                &got[..]
            )));
        }
        let mut vectors = match profile.pooling {
            Pooling::Cls => pool_cls(hidden, batch, tokens.seq_len, dimensions),
            Pooling::Mean => pool_mean(hidden, &tokens.mask, batch, tokens.seq_len, dimensions),
        };
        for vector in &mut vectors {
            normalize(vector);
        }
        Ok(vectors)
    }

    fn tokenize(&self, chunk: &[String]) -> Result<Padded, EmbedError> {
        let inputs: Vec<&str> = chunk.iter().map(String::as_str).collect();
        let encodings = self
            .tokenizer
            .encode_batch(inputs, true)
            .map_err(|e| EmbedError(format!("the text could not be tokenized: {e}")))?;
        let rows: Vec<&[u32]> = encodings
            .iter()
            .map(tokenizers::Encoding::get_ids)
            .collect();
        Ok(pad_rows(&rows, self.pad_id))
    }
}

/// The token-states output: `last_hidden_state`, else the first output.
fn output_name(session: &Session) -> Result<String, EmbedError> {
    let outputs = session.outputs();
    outputs
        .iter()
        .find(|o| o.name() == "last_hidden_state")
        .or_else(|| outputs.first())
        .map(|o| o.name().to_string())
        .ok_or_else(|| EmbedError("the model has no outputs".to_string()))
}

/// Reads the tokenizer with its own truncation and padding off; [`pad_rows`] does both.
fn load_tokenizer(path: &Path) -> Result<Tokenizer, EmbedError> {
    let mut tokenizer = Tokenizer::from_file(path)
        .map_err(|e| EmbedError(format!("the tokenizer could not be read: {e}")))?;
    let _ = tokenizer
        .with_truncation(None)
        .map_err(|e| EmbedError(format!("the tokenizer could not clear truncation: {e}")))?;
    let _ = tokenizer.with_padding(None);
    Ok(tokenizer)
}

/// Reads `hidden_size` from `config.json`.
fn read_dimensions(path: &Path) -> Result<usize, EmbedError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| EmbedError(format!("config.json could not be read: {e}")))?;
    let config: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| EmbedError(format!("config.json could not be parsed: {e}")))?;
    config
        .get("hidden_size")
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
        .ok_or_else(|| EmbedError("config.json has no hidden_size".to_string()))
}

/// Builds the ONNX session for the quantized encoder at `path`.
fn load_session(path: &Path) -> Result<Session, EmbedError> {
    let env = environment()?;
    let mut builder = Session::builder(&env)
        .map_err(|e| EmbedError(format!("ONNX Runtime could not create a session: {e}")))?;
    builder.commit_from_file(path).map_err(|e| {
        EmbedError(format!(
            "the model could not be loaded from onnx/model_quantized.onnx: {e}"
        ))
    })
}

/// Returns the shared ONNX Runtime environment, creating it on first use.
///
/// A failed start leaves the slot empty, so the next call tries again.
fn environment() -> Result<Environment, EmbedError> {
    let mut slot = ENVIRONMENT
        .lock()
        .map_err(|_| EmbedError("ONNX Runtime start was interrupted".to_string()))?;
    if let Some(env) = slot.as_ref() {
        return Ok(env.clone());
    }
    let env = ort::environment::init()
        .build()
        .map_err(|e| EmbedError(format!("ONNX Runtime could not start: {e}")))?;
    *slot = Some(env.clone());
    Ok(env)
}

/// Builds an `i64` tensor of `shape` from row-major `data`.
fn int_tensor(shape: &[i64], data: Vec<i64>) -> Result<Tensor<i64>, EmbedError> {
    Tensor::<i64>::from_array((shape.to_vec(), data))
        .map_err(|e| EmbedError(format!("the model input could not be built: {e}")))
}

/// Converts a length to `i64` for a tensor shape.
fn to_i64(n: usize) -> Result<i64, EmbedError> {
    i64::try_from(n).map_err(|e| EmbedError(format!("the batch is too large: {e}")))
}
