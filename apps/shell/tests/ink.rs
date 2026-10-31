//! Tests for the ink recogniser client (ported from apps/desktop/test/ink-recogniser.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{
    AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines, ReadHalf, WriteHalf,
};
use tokio::sync::mpsc;
use weaveforge_shell::ink::{
    HelperIo, InkHapticsMessage, InkOptions, InkRecogniser, InkRecognitionLineInput,
    InkRecognitionRequest, Spawner, ink_recogniser_path, read_ink_request,
};

const NOT_AVAILABLE: &str = "The Windows handwriting recogniser is not available.";
const TIMED_OUT: &str = "The handwriting recogniser did not answer in time.";
const STOPPED: &str = "The handwriting recogniser stopped before answering.";
const DISPOSED: &str = "The handwriting recogniser was stopped.";
const NO_READY: &str = "ink-recogniser: no ready line; giving up on this helper";
const LONG: Duration = Duration::from_secs(5);
const SHORT_READY: Duration = Duration::from_millis(20);

/// The spawner's far ends arrive here, one per spawn, so a test can play the helper.
struct Fixture {
    recogniser: InkRecogniser,
    far: mpsc::UnboundedReceiver<DuplexStream>,
    spawns: Arc<AtomicUsize>,
    diagnostics: Arc<Mutex<Vec<String>>>,
}

fn fixture(timeout: Duration, ready_timeout: Duration) -> Fixture {
    let (far_tx, far) = mpsc::unbounded_channel();
    let spawns = Arc::new(AtomicUsize::new(0));
    let diagnostics = Arc::new(Mutex::new(Vec::<String>::new()));
    let spawner: Spawner = {
        let spawns = Arc::clone(&spawns);
        Arc::new(move |_path: &Path| -> io::Result<HelperIo> {
            let _ = spawns.fetch_add(1, Ordering::SeqCst);
            let (near, peer) = tokio::io::duplex(64 * 1024);
            let _ = far_tx.send(peer);
            let (read, write) = tokio::io::split(near);
            let writer: Box<dyn tokio::io::AsyncWrite + Send + Unpin> = Box::new(write);
            let reader: Box<dyn tokio::io::AsyncRead + Send + Unpin> = Box::new(read);
            Ok((writer, reader))
        })
    };
    let sink = Arc::clone(&diagnostics);
    let recogniser = InkRecogniser::new(InkOptions {
        executable: Some(PathBuf::from("fake.exe")),
        spawner,
        timeout,
        ready_timeout,
        on_diagnostic: Arc::new(move |line: &str| {
            if let Ok(mut lines) = sink.lock() {
                lines.push(line.to_owned());
            }
        }),
    });
    Fixture {
        recogniser,
        far,
        spawns,
        diagnostics,
    }
}

/// The far end of the pipe: plays the helper process.
struct Helper {
    lines: Lines<BufReader<ReadHalf<DuplexStream>>>,
    out: WriteHalf<DuplexStream>,
}

impl Helper {
    fn new(far: DuplexStream) -> Self {
        let (read, out) = tokio::io::split(far);
        Self {
            lines: BufReader::new(read).lines(),
            out,
        }
    }

    async fn send(&mut self, line: &str) {
        self.out
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn say(&mut self, value: Value) {
        self.send(&value.to_string()).await;
    }

    async fn ready(&mut self) {
        self.say(json!({"type": "ready", "engine": "windows-ink@1", "version": "fake"}))
            .await;
    }

    async fn next_text(&mut self) -> String {
        self.lines.next_line().await.unwrap().unwrap()
    }

    async fn next(&mut self) -> Value {
        serde_json::from_str(&self.next_text().await).unwrap()
    }
}

/// Takes the next spawned helper and lets it say ready.
async fn connect(far: &mut mpsc::UnboundedReceiver<DuplexStream>) -> Helper {
    let mut helper = Helper::new(far.recv().await.unwrap());
    helper.ready().await;
    helper
}

/// A recognise request of `lines` lines, one stroke each.
fn request(lines: usize) -> InkRecognitionRequest {
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

/// Answers a recognise request with one line of text per line it asked for.
async fn answer(helper: &mut Helper, request: &Value) {
    let id = request["id"].clone();
    let count = request["lines"].as_array().map_or(0, Vec::len);
    let lines: Vec<Value> = (0..count)
        .map(|i| json!({"text": format!("line {i}"), "confidence": 1}))
        .collect();
    helper.say(json!({"id": id, "type": "recognised", "engine": "windows-ink@1", "ms": 7, "lines": lines})).await;
}

#[test]
fn ink_recogniser_path_is_per_platform_and_architecture() {
    let root = Path::new("C:\\app");
    let exe = |rid: &str| {
        root.join("native")
            .join("ink-recogniser")
            .join(rid)
            .join("ink-recogniser.exe")
    };
    assert_eq!(
        ink_recogniser_path("linux", "x86_64", root),
        None,
        "there is no Windows Ink off Windows"
    );
    assert_eq!(
        ink_recogniser_path("windows", "aarch64", root),
        Some(exe("win-arm64"))
    );
    assert_eq!(
        ink_recogniser_path("windows", "x86_64", root),
        Some(exe("win-x64"))
    );
    assert_eq!(ink_recogniser_path("windows", "x86", root), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_is_correlated_by_id_and_answered_with_its_lines() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(LONG, LONG);
    let input = InkRecognitionRequest {
        lines: request(2).lines,
        vocabulary: Some(vec!["Graph-prior module".to_owned()]),
        lang: Some("en-US".to_owned()),
    };
    let (outcome, sent) = tokio::join!(
        async {
            let available = recogniser.available().await;
            let version = recogniser.version();
            (available, version, recogniser.recognise(input).await)
        },
        async {
            let mut helper = connect(&mut far).await;
            let sent = helper.next().await;
            answer(&mut helper, &sent).await;
            sent
        },
    );
    let (available, version, result) = outcome;
    let result = result.unwrap();
    assert!(available);
    assert_eq!(version.as_deref(), Some("fake"));
    assert_eq!(result.engine, "windows-ink@1");
    assert_eq!(result.ms, 7.0);
    let texts: Vec<&str> = result.lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(texts, ["line 0", "line 1"]);
    // The vocabulary and language travel on the wire even though this engine ignores them.
    assert_eq!(sent["type"], "recognise");
    assert_eq!(sent["lines"].as_array().unwrap().len(), 2);
    assert_eq!(sent["vocabulary"], json!(["Graph-prior module"]));
    assert_eq!(sent["lang"], "en-US");
    recogniser.dispose();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_disposed_recogniser_stays_stopped_and_spawns_nothing_more() {
    let Fixture {
        recogniser,
        mut far,
        spawns,
        ..
    } = fixture(LONG, LONG);
    let (available, _helper) =
        tokio::join!(recogniser.available(), async { connect(&mut far).await });
    assert!(available);
    recogniser.dispose();
    assert!(!recogniser.available().await);
    assert_eq!(
        recogniser.recognise(request(1)).await.err().as_deref(),
        Some(NOT_AVAILABLE)
    );
    assert_eq!(spawns.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_pages_in_flight_are_both_answered_not_serialised() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(LONG, LONG);
    let ((first, second), _helper) = tokio::join!(
        async {
            tokio::join!(
                recogniser.recognise(request(1)),
                recogniser.recognise(request(2))
            )
        },
        async {
            let mut helper = connect(&mut far).await;
            let a = helper.next().await;
            let b = helper.next().await;
            assert_ne!(a["id"], b["id"], "each request carries its own id");
            // Answer the later request first: each page must still get its own lines.
            answer(&mut helper, &b).await;
            answer(&mut helper, &a).await;
            helper
        },
    );
    assert_eq!(first.unwrap().lines.len(), 1);
    assert_eq!(second.unwrap().lines.len(), 2);
    recogniser.dispose();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_helper_with_no_ready_line_is_unavailable_and_diagnosed() {
    let Fixture {
        recogniser,
        far,
        diagnostics,
        ..
    } = fixture(LONG, SHORT_READY);
    // Holding the far ends keeps the silent helper's pipe open.
    let _silent = far;
    assert!(!recogniser.available().await);
    assert!(
        diagnostics
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == NO_READY)
    );
    assert_eq!(
        recogniser.recognise(request(1)).await.err().as_deref(),
        Some(NOT_AVAILABLE)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_helper_that_closes_mid_request_fails_the_pending_call() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(LONG, LONG);
    let (outcome, ()) = tokio::join!(recogniser.recognise(request(1)), async {
        let mut helper = connect(&mut far).await;
        let _request = helper.next().await;
        drop(helper);
    });
    assert_eq!(outcome.err().as_deref(), Some(STOPPED));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_process_that_cannot_start_reports_unavailable_rather_than_throwing() {
    let diagnostics = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&diagnostics);
    let recogniser = InkRecogniser::new(InkOptions {
        executable: Some(PathBuf::from("fake.exe")),
        spawner: Arc::new(|_path: &Path| -> io::Result<HelperIo> {
            Err(io::Error::other("ENOENT"))
        }),
        timeout: LONG,
        ready_timeout: LONG,
        on_diagnostic: Arc::new(move |line: &str| {
            if let Ok(mut lines) = sink.lock() {
                lines.push(line.to_owned());
            }
        }),
    });
    assert!(!recogniser.available().await);
    assert_eq!(
        recogniser.recognise(request(1)).await.err().as_deref(),
        Some(NOT_AVAILABLE)
    );
    let first = diagnostics.lock().unwrap().first().cloned();
    assert_eq!(
        first.as_deref(),
        Some("ink-recogniser: could not start fake.exe: ENOENT")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_helper_for_this_platform_means_unavailable_and_no_spawn() {
    let spawns = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&spawns);
    let recogniser = InkRecogniser::new(InkOptions {
        executable: None,
        spawner: Arc::new(move |_path: &Path| -> io::Result<HelperIo> {
            let _ = counter.fetch_add(1, Ordering::SeqCst);
            Err(io::Error::other("never called"))
        }),
        timeout: LONG,
        ready_timeout: LONG,
        on_diagnostic: Arc::new(|_line: &str| {}),
    });
    assert_eq!(recogniser.executable(), None);
    assert!(!recogniser.available().await);
    assert_eq!(spawns.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn haptics_before_the_helper_runs_starts_nothing_and_samples_go_unanswered() {
    let Fixture {
        recogniser,
        mut far,
        spawns,
        ..
    } = fixture(LONG, LONG);
    recogniser.haptics(&InkHapticsMessage::Update {
        pressure: 0.5,
        velocity: 1.0,
    });
    assert_eq!(
        spawns.load(Ordering::SeqCst),
        0,
        "a sample never starts the helper"
    );
    let (available, mut helper) = tokio::join!(recogniser.haptics_available(), async {
        let mut helper = connect(&mut far).await;
        let probe = helper.next().await;
        assert_eq!(probe, json!({"id": 1, "type": "haptics-probe"}));
        helper
            .say(json!({"id": 1, "type": "haptics", "available": true}))
            .await;
        helper
    });
    assert!(available);
    assert_eq!(spawns.load(Ordering::SeqCst), 1);
    recogniser.haptics(&InkHapticsMessage::Tool {
        tool: "pen".to_owned(),
    });
    recogniser.haptics(&InkHapticsMessage::Update {
        pressure: 0.5,
        velocity: 1.0,
    });
    recogniser.haptics(&InkHapticsMessage::Stop);
    assert_eq!(
        helper.next_text().await,
        r#"{"type":"haptics-tool","tool":"pen"}"#
    );
    assert_eq!(
        helper.next_text().await,
        r#"{"type":"haptics-update","pressure":0.5,"velocity":1.0}"#
    );
    assert_eq!(helper.next_text().await, r#"{"type":"haptics-stop"}"#);
    recogniser.dispose();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_with_no_answer_times_out_and_a_late_answer_is_ignored() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(Duration::from_millis(200), LONG);
    let ((first, second), _helper) = tokio::join!(
        async {
            let first = recogniser.recognise(request(1)).await;
            let second = recogniser.recognise(request(1)).await;
            (first, second)
        },
        async {
            let mut helper = connect(&mut far).await;
            let late = helper.next().await;
            // Past the 200 ms timeout: the answer arrives with no caller waiting for it.
            tokio::time::sleep(Duration::from_millis(300)).await;
            helper
                .say(json!({"id": late["id"], "type": "recognised", "ms": 1, "lines": [{"text": "late", "confidence": 1}]}))
                .await;
            let next = helper.next().await;
            answer(&mut helper, &next).await;
            helper
        },
    );
    assert_eq!(first.err().as_deref(), Some(TIMED_OUT));
    let second = second.unwrap();
    let texts: Vec<&str> = second.lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(texts, ["line 0"]);
    recogniser.dispose();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_malformed_line_is_a_diagnostic_not_a_crash() {
    let Fixture {
        recogniser,
        mut far,
        diagnostics,
        ..
    } = fixture(LONG, LONG);
    let (outcome, _helper) = tokio::join!(recogniser.recognise(request(1)), async {
        let mut helper = connect(&mut far).await;
        let sent = helper.next().await;
        helper.send("not json").await;
        answer(&mut helper, &sent).await;
        helper
    });
    assert_eq!(outcome.unwrap().lines.len(), 1);
    assert!(
        diagnostics
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "ink-recogniser: unparseable line not json")
    );
    recogniser.dispose();
}

// Not ported: the TS "the real helper recognises a page" test runs a Windows Ink helper
// built from apps/desktop/native, which this Rust port does not ship; the protocol above
// is what it checks. NaN and Infinity cases of readInkRequest are not testable here:
// JSON cannot carry them, so serde_json never hands over a non-finite number.

#[test]
fn read_ink_request_accepts_the_web_pages_real_payload() {
    let sent = json!({
        "lines": [{"strokes": [[10, 20, 128, 11, 21, 130], [30, 40, 0.5]]}, {"strokes": []}],
        "vocabulary": ["entropy", "Kalman"],
        "lang": "en-GB",
    });
    assert_eq!(
        read_ink_request(&sent),
        Some(InkRecognitionRequest {
            lines: vec![
                InkRecognitionLineInput {
                    strokes: vec![
                        vec![10.0, 20.0, 128.0, 11.0, 21.0, 130.0],
                        vec![30.0, 40.0, 0.5]
                    ]
                },
                InkRecognitionLineInput { strokes: vec![] },
            ],
            vocabulary: Some(vec!["entropy".to_owned(), "Kalman".to_owned()]),
            lang: Some("en-GB".to_owned()),
        })
    );
    // An absent field is the TS `undefined`.
    assert_eq!(
        read_ink_request(&json!({"lines": [], "vocabulary": []})),
        Some(InkRecognitionRequest {
            lines: vec![],
            vocabulary: Some(vec![]),
            lang: None
        })
    );
    assert_eq!(
        read_ink_request(&json!({"lines": []})),
        Some(InkRecognitionRequest {
            lines: vec![],
            vocabulary: None,
            lang: None
        })
    );
}

#[test]
fn read_ink_request_refuses_anything_else() {
    let bad = [
        json!(null),
        json!("lines"),
        json!([]),
        json!({"lines": "x"}),
        json!({"lines": null}),
        json!({"lines": [null]}),
        json!({"lines": [{}]}),
        json!({"lines": [{"strokes": "x"}]}),
        json!({"lines": [{"strokes": [null]}]}),
        json!({"lines": [{"strokes": [[1, "2", 3]]}]}),
        json!({"lines": [{"strokes": [[1, null, 3]]}]}),
        json!({"lines": [], "vocabulary": "word"}),
        json!({"lines": [], "vocabulary": ["ok", 3]}),
        json!({"lines": [], "vocabulary": null}),
        json!({"lines": [], "lang": 7}),
        json!({"lines": [], "lang": null}),
    ];
    for request in &bad {
        assert!(read_ink_request(request).is_none(), "accepted {request}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_helper_that_died_is_started_again_on_the_next_call() {
    let Fixture {
        recogniser,
        mut far,
        spawns,
        ..
    } = fixture(LONG, LONG);
    let (first, helper) = tokio::join!(recogniser.available(), connect(&mut far));
    assert!(first);
    // The helper dies after it said it was ready.
    drop(helper);
    // Wait until the reader has seen the pipe close.
    for _ in 0..200 {
        if recogniser.version().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(recogniser.version(), None);
    let (second, _helper) = tokio::join!(recogniser.available(), connect(&mut far));
    assert!(second);
    assert_eq!(spawns.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn haptics_are_not_written_when_the_helper_says_it_has_none() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(LONG, LONG);
    let (available, mut helper) = tokio::join!(recogniser.haptics_available(), async {
        let mut helper = connect(&mut far).await;
        let _probe = helper.next().await;
        helper
            .say(json!({"id": 1, "type": "haptics", "available": false}))
            .await;
        helper
    });
    assert!(!available);
    recogniser.haptics(&InkHapticsMessage::Stop);
    // The next line the helper sees is the recognise request, not a haptics line.
    let (_outcome, next) = tokio::join!(
        tokio::time::timeout(Duration::from_millis(200), recogniser.recognise(request(1))),
        helper.next()
    );
    assert_eq!(next["type"], json!("recognise"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disposing_fails_a_page_in_flight() {
    let Fixture {
        recogniser,
        mut far,
        ..
    } = fixture(LONG, LONG);
    let (outcome, _helper) = tokio::join!(recogniser.recognise(request(1)), async {
        let mut helper = connect(&mut far).await;
        let sent = helper.next().await;
        assert_eq!(sent["type"], json!("recognise"));
        recogniser.dispose();
        helper
    });
    assert_eq!(outcome.err().as_deref(), Some(DISPOSED));
}
