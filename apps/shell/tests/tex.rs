//! Tests for the LaTeX compile (ported from apps/desktop/test/tex.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::fs;

use common::TempDir;
use weaveforge_shell::tex::{
    COMPILE_FAILED, MAX_FILES, MAX_TOTAL_BYTES, NO_ENGINE, TOO_LARGE, TOO_MANY_FILES,
    TexCompileResult, TexEngine, TexError, TexSourceFile, TexTool, args_for, compile_tex_in,
    parse_tex_log, probe_engine, safe_relative, tail,
};

/// The smallest document that is actually a document.
const MINIMAL: &str = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";

fn file(path: &str, content: &str) -> TexSourceFile {
    TexSourceFile {
        path: path.to_string(),
        content: content.to_string(),
    }
}

fn error(file: &str, line: u32, message: &str) -> TexError {
    TexError {
        file: file.to_string(),
        line,
        message: message.to_string(),
    }
}

fn pdflatex_missing() -> TexTool {
    TexTool {
        kind: TexEngine::Pdflatex,
        command: "weaveforge-no-such-binary-xyz".to_string(),
        version: String::new(),
    }
}

fn tmp_is_empty(tmp: &TempDir) -> bool {
    fs::read_dir(tmp.path()).unwrap().count() == 0
}

#[test]
fn safe_relative_cases() {
    assert_eq!(safe_relative("a.tex"), Ok("a.tex".to_string()));
    assert_eq!(safe_relative("./a.tex"), Ok("a.tex".to_string()));
    assert_eq!(safe_relative("sub\\b.tex"), Ok("sub/b.tex".to_string()));
    // TS strips only one leading "./", so the second one is an ordinary "." segment.
    assert_eq!(safe_relative(".\\./a"), Ok("./a".to_string()));
    assert_eq!(
        safe_relative("latexmkrc.tex"),
        Ok("latexmkrc.tex".to_string())
    );

    for bad in ["", "/etc/x", "C:/x", "c:x", "a/../b", "a//b", "../a", "a/"] {
        assert!(
            safe_relative(bad)
                .unwrap_err()
                .starts_with("Refusing to write '"),
            "{bad}"
        );
    }
    assert_eq!(
        safe_relative("../a"),
        Err("Refusing to write '../a': it leaves the build directory.".to_string())
    );
    // The refusal names the path as given, before any slash rewriting (TS).
    assert_eq!(
        safe_relative(".\\..\\a"),
        Err("Refusing to write '.\\..\\a': it leaves the build directory.".to_string())
    );
    assert_eq!(
        safe_relative("latexmkrc"),
        Err("Refusing to write 'latexmkrc': latexmk would run it as a script.".to_string())
    );
    assert!(
        safe_relative("sub/.LatexMkRc")
            .unwrap_err()
            .ends_with("latexmk would run it as a script.")
    );
}

#[test]
fn args_cases() {
    assert_eq!(
        args_for(TexEngine::Latexmk, "main.tex"),
        [
            "-norc",
            "-pdf",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "./main.tex"
        ]
    );
    assert_eq!(
        args_for(TexEngine::Tectonic, "main.tex"),
        ["--keep-logs", "--", "main.tex"]
    );
    assert_eq!(
        args_for(TexEngine::Pdflatex, "main.tex"),
        [
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "./main.tex"
        ]
    );
    // Tectonic must write the PDF, not print it, and nothing may redirect output.
    for engine in TexEngine::ALL {
        let args = args_for(engine, "main.tex");
        assert!(!args.iter().any(|arg| arg == "--print"), "{engine:?}");
        assert!(
            !args
                .iter()
                .any(|arg| arg.starts_with("--outdir") || arg == "-output-directory"),
            "{engine:?}"
        );
        assert!(
            args.iter().any(|arg| arg.contains("main.tex")),
            "{engine:?}"
        );
    }
}

#[test]
fn engine_commands() {
    assert_eq!(TexEngine::Latexmk.command(), "latexmk");
    assert_eq!(TexEngine::Tectonic.command(), "tectonic");
    assert_eq!(TexEngine::Pdflatex.command(), "pdflatex");
}

#[test]
fn parse_located() {
    let errors = parse_tex_log(
        "./main.tex:12: Undefined control sequence.\nchapters/intro.tex:3: Missing $ inserted.",
        "main.tex",
    );
    assert_eq!(
        errors,
        vec![
            error("main.tex", 12, "Undefined control sequence."),
            error("chapters/intro.tex", 3, "Missing $ inserted."),
        ]
    );
}

#[test]
fn parse_bang_with_l_line() {
    let errors = parse_tex_log(
        "! LaTeX Error: File `missing.sty' not found.\n\nSee the LaTeX manual.\nl.7 \\usepackage{missing}",
        "main.tex",
    );
    assert_eq!(
        errors,
        vec![error(
            "main.tex",
            7,
            "LaTeX Error: File `missing.sty' not found."
        )]
    );
}

#[test]
fn parse_bang_without_l_line_is_zero() {
    let errors = parse_tex_log("! Undefined control sequence.\nno line here", "main.tex");
    assert_eq!(
        errors,
        vec![error("main.tex", 0, "Undefined control sequence.")]
    );
}

#[test]
fn parse_bang_l_line_beyond_five_ignored() {
    // The window is the next five lines: an `l.` line at index 5 counts, index 6 does not.
    let within = parse_tex_log("! Oops\na\nb\nc\nd\nl.5 x", "main.tex");
    assert_eq!(within, vec![error("main.tex", 5, "Oops")]);
    let beyond = parse_tex_log("! Oops\na\nb\nc\nd\ne\nl.9 x", "main.tex");
    assert_eq!(beyond, vec![error("main.tex", 0, "Oops")]);
}

#[test]
fn parse_dedupes() {
    let errors = parse_tex_log(
        "./main.tex:12: Undefined control sequence.\n./main.tex:12: Undefined control sequence.",
        "main.tex",
    );
    assert_eq!(errors.len(), 1);
}

#[test]
fn parse_clean_log_is_empty() {
    assert!(
        parse_tex_log(
            "This is pdfTeX\nOutput written on main.pdf (42 pages).",
            "main.tex"
        )
        .is_empty()
    );
}

#[test]
fn parse_crlf() {
    // A located line ending in CR does not match (JS `.` excludes CR), so TS yields nothing for it.
    assert!(parse_tex_log("./main.tex:12: Undefined.\r\n", "main.tex").is_empty());
    // A `!` line keeps its CR only past the trim, so the message is clean.
    let errors = parse_tex_log("! Undefined control sequence.\r\nl.7 x\r\n", "main.tex");
    assert_eq!(
        errors,
        vec![error("main.tex", 7, "Undefined control sequence.")]
    );
}

#[test]
fn parse_strips_dot_slash() {
    assert_eq!(
        parse_tex_log("./main.tex:1: x", "main.tex"),
        vec![error("main.tex", 1, "x")]
    );
    // One "./" is consumed by the prefix; the capture then strips a second one, as TS does.
    assert_eq!(
        parse_tex_log("././a.tex:1: x", "main.tex"),
        vec![error("a.tex", 1, "x")]
    );
}

#[test]
fn tail_cases() {
    assert_eq!(tail("hello", 10), "hello");
    assert_eq!(tail("abcdef", 3), "def");
    // A surrogate pair straddling the cut is dropped whole, not split.
    assert_eq!(tail("😀a", 2), "a");
    assert_eq!(tail("a😀", 2), "😀");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn probe_missing_binary_is_none() {
    assert_eq!(
        probe_engine(TexEngine::Latexmk, "weaveforge-no-such-binary-xyz").await,
        None
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn probe_real_binary() {
    let tool = probe_engine(TexEngine::Tectonic, "cargo")
        .await
        .expect("cargo is on PATH");
    assert_eq!(tool.kind, TexEngine::Tectonic);
    assert_eq!(tool.command, "cargo");
    assert!(tool.version.starts_with("cargo "), "{}", tool.version);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_without_engine() {
    let tmp = TempDir::new();
    let files = [file("main.tex", MINIMAL)];
    let result = compile_tex_in(tmp.path(), &files, "main.tex", None).await;
    assert_eq!(
        result,
        TexCompileResult {
            ok: false,
            pdf: None,
            log: String::new(),
            errors: vec![error("main.tex", 0, NO_ENGINE)],
            engine: None,
        }
    );
    assert!(tmp_is_empty(&tmp));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_missing_binary_cleans_up() {
    let tmp = TempDir::new();
    let tool = pdflatex_missing();
    let files = [file("main.tex", MINIMAL)];
    let result = compile_tex_in(tmp.path(), &files, "main.tex", Some(&tool)).await;
    assert!(!result.ok);
    assert_eq!(result.pdf, None);
    assert_eq!(result.engine, Some(TexEngine::Pdflatex));
    assert_eq!(result.errors, vec![error("main.tex", 0, COMPILE_FAILED)]);
    assert!(tmp_is_empty(&tmp));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_refuses_traversal_entry() {
    let tmp = TempDir::new();
    let tool = pdflatex_missing();
    let result = compile_tex_in(tmp.path(), &[], "../main.tex", Some(&tool)).await;
    assert!(!result.ok);
    assert_eq!(
        result.errors,
        vec![error(
            "../main.tex",
            0,
            "Refusing to write '../main.tex': it leaves the build directory."
        )]
    );
    assert!(tmp_is_empty(&tmp));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_refuses_traversal_source() {
    let tmp = TempDir::new();
    let tool = pdflatex_missing();
    let files = [file("../escape.tex", "x")];
    let result = compile_tex_in(tmp.path(), &files, "main.tex", Some(&tool)).await;
    assert_eq!(
        result.errors,
        vec![error(
            "main.tex",
            0,
            "Refusing to write '../escape.tex': it leaves the build directory."
        )]
    );
    assert!(tmp_is_empty(&tmp));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_refuses_latexmkrc_file() {
    let tool = pdflatex_missing();
    for path in [".latexmkrc", "latexmkrc", "sub/.LatexMkRc"] {
        let tmp = TempDir::new();
        let files = [file(path, "system('id')")];
        let result = compile_tex_in(tmp.path(), &files, "main.tex", Some(&tool)).await;
        let message = format!("Refusing to write '{path}': latexmk would run it as a script.");
        assert_eq!(
            result.errors,
            vec![error("main.tex", 0, &message)],
            "{path}"
        );
        assert!(tmp_is_empty(&tmp), "{path}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_refuses_501_files() {
    assert_eq!(MAX_FILES, 500);
    let tmp = TempDir::new();
    let tool = pdflatex_missing();
    let files: Vec<TexSourceFile> = (0..=MAX_FILES)
        .map(|i| file(&format!("f{i}.tex"), "x"))
        .collect();
    let result = compile_tex_in(tmp.path(), &files, "main.tex", Some(&tool)).await;
    assert_eq!(result.errors, vec![error("main.tex", 0, TOO_MANY_FILES)]);
    assert!(tmp_is_empty(&tmp));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_refuses_over_40mb() {
    let tmp = TempDir::new();
    let tool = pdflatex_missing();
    let files = [file("main.tex", &"x".repeat(MAX_TOTAL_BYTES + 1))];
    let result = compile_tex_in(tmp.path(), &files, "main.tex", Some(&tool)).await;
    assert_eq!(result.errors, vec![error("main.tex", 0, TOO_LARGE)]);
    assert!(tmp_is_empty(&tmp));
}

#[test]
fn result_json() {
    let result = TexCompileResult {
        ok: true,
        pdf: Some(vec![1, 2]),
        log: "log".to_string(),
        errors: vec![error("main.tex", 3, "msg")],
        engine: Some(TexEngine::Tectonic),
    };
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "ok": true,
            "pdf": [1, 2],
            "log": "log",
            "errors": [{"file": "main.tex", "line": 3, "message": "msg"}],
            "engine": "tectonic",
        })
    );
}

#[test]
fn parse_line_number_past_u32_is_kept() {
    assert_eq!(
        parse_tex_log("main.tex:99999999999: boom", "main.tex"),
        vec![error("main.tex", u32::MAX, "boom")]
    );
}

/// An executable shell script standing in for the engine.
#[cfg(unix)]
fn fake_engine(dir: &TempDir, body: &str) -> TexTool {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.path().join("engine.sh");
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    TexTool {
        kind: TexEngine::Pdflatex,
        command: path.to_string_lossy().into_owned(),
        version: String::new(),
    }
}

/// Compiles with a fake engine, retrying while the kernel says the new script is busy.
///
/// Another test thread can fork while `fake_engine` still holds the script open for writing; the
/// child keeps that handle until it execs, and running the script then fails with ETXTBSY.
#[cfg(unix)]
async fn compile_fake(tmp: &TempDir, files: &[TexSourceFile], tool: &TexTool) -> TexCompileResult {
    let mut result = compile_tex_in(tmp.path(), files, "main.tex", Some(tool)).await;
    for _ in 0..20 {
        if !result.log.contains("Text file busy") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        result = compile_tex_in(tmp.path(), files, "main.tex", Some(tool)).await;
    }
    result
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compile_output_flood_is_stopped() {
    let bin = TempDir::new();
    let tmp = TempDir::new();
    let tool = fake_engine(&bin, "exec head -c 40000000 /dev/zero");
    let files = [file("main.tex", MINIMAL)];
    let result = compile_fake(&tmp, &files, &tool).await;
    assert!(!result.ok);
    assert!(
        result.log.contains("stdout maxBuffer length exceeded"),
        "log: {}",
        result.log
    );
    assert!(result.log.len() < 1_000);
    assert!(tmp_is_empty(&tmp));
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn build_dir_is_private() {
    let bin = TempDir::new();
    let tmp = TempDir::new();
    let out = bin.path().join("mode.txt");
    let tool = fake_engine(
        &bin,
        &format!("ls -ld . | cut -c1-10 > '{}'", out.display()),
    );
    let files = [file("main.tex", MINIMAL)];
    let _ = compile_fake(&tmp, &files, &tool).await;
    assert_eq!(fs::read_to_string(&out).unwrap().trim(), "drwx------");
    assert!(tmp_is_empty(&tmp));
}
