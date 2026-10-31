//! Tests for the handwriting commands (no helper is run; a counting spawner proves starts).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use weaveforge_shell::cmd_ink::{NOT_A_PAGE, available, haptics, haptics_available, recognise};
use weaveforge_shell::ink::{
    HelperIo, INK_NOT_AVAILABLE, InkHapticsMessage, InkOptions, InkRecogniser,
    InkRecognitionLineInput, InkRecognitionRequest, Spawner,
};

const LONG: Duration = Duration::from_secs(5);

/// A recogniser whose spawner counts every start attempt and always fails.
fn recogniser(executable: Option<PathBuf>) -> (InkRecogniser, Arc<AtomicUsize>) {
    let spawns = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&spawns);
    let spawner: Spawner = Arc::new(move |_path: &Path| -> io::Result<HelperIo> {
        let _ = counter.fetch_add(1, Ordering::SeqCst);
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no helper in tests",
        ))
    });
    let ink = InkRecogniser::new(InkOptions {
        executable,
        spawner,
        timeout: LONG,
        ready_timeout: LONG,
        on_diagnostic: Arc::new(|_line: &str| {}),
    });
    (ink, spawns)
}

/// A page of `lines` lines, one stroke each.
fn page(lines: usize) -> InkRecognitionRequest {
    InkRecognitionRequest {
        lines: (0..lines)
            .map(|_| InkRecognitionLineInput {
                strokes: vec![vec![0.0, 0.0, 128.0, 1.0, 1.0, 128.0]],
            })
            .collect(),
        vocabulary: None,
        lang: None,
    }
}

fn with_strokes(strokes: Vec<Vec<f64>>) -> InkRecognitionRequest {
    InkRecognitionRequest {
        lines: vec![InkRecognitionLineInput { strokes }],
        vocabulary: None,
        lang: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_a_helper_ink_is_not_available() {
    let (ink, _spawns) = recogniser(None);
    assert!(!available(&ink).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_a_helper_haptics_are_not_available() {
    let (ink, _spawns) = recogniser(None);
    assert!(!haptics_available(&ink).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_a_helper_recognise_says_ink_is_not_available() {
    let (ink, _spawns) = recogniser(None);
    assert_eq!(
        recognise(&ink, page(1)).await,
        Err(INK_NOT_AVAILABLE.to_owned())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_empty_page_is_refused_before_the_helper_starts() {
    let (ink, spawns) = recogniser(Some(PathBuf::from("fake.exe")));
    assert_eq!(recognise(&ink, page(0)).await, Err(NOT_A_PAGE.to_owned()));
    assert_eq!(spawns.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_line_without_strokes_is_refused() {
    let (ink, spawns) = recogniser(Some(PathBuf::from("fake.exe")));
    assert_eq!(
        recognise(&ink, with_strokes(Vec::new())).await,
        Err(NOT_A_PAGE.to_owned())
    );
    assert_eq!(spawns.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_nan_coordinate_is_refused() {
    let (ink, spawns) = recogniser(Some(PathBuf::from("fake.exe")));
    assert_eq!(
        recognise(&ink, with_strokes(vec![vec![f64::NAN, 0.0, 0.0]])).await,
        Err(NOT_A_PAGE.to_owned())
    );
    assert_eq!(spawns.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn haptics_without_a_helper_does_nothing() {
    let (ink, spawns) = recogniser(Some(PathBuf::from("fake.exe")));
    haptics(&ink, &InkHapticsMessage::Stop);
    assert_eq!(spawns.load(Ordering::SeqCst), 0);
}
