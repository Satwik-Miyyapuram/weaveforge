#!/usr/bin/env bash
# Vercel install step. packages/wf-wasm/pkg is not committed, so the web build
# compiles crates/wf-wasm and the build image needs Rust and the wasm-bindgen CLI.
# rust-toolchain.toml picks the toolchain and the wasm32 target; the CLI version
# comes from Cargo.lock, which build-wasm.mjs checks again.
set -euo pipefail

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
export PATH="$HOME/.cargo/bin:$PATH"
rustup show active-toolchain || rustup toolchain install

wb=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')
dir="wasm-bindgen-$wb-x86_64-unknown-linux-musl"
curl --proto '=https' -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$wb/$dir.tar.gz" |
  tar -xz -C "$HOME/.cargo/bin" --strip-components=1 "$dir/wasm-bindgen"

npm install
