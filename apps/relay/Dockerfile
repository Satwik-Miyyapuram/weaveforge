# WeaveForge relay server (wf-relay-server).
#
# Build from the repo root, because the server depends on crates/wf-core by a
# relative path and wf-core inherits its version, lints and pins from the root
# Cargo.toml:
#   docker build -f apps/relay/Dockerfile .

FROM rust:1.98-bookworm AS builder
WORKDIR /src
# Root manifest and lock for wf-core's `workspace = true` keys. The build itself
# runs in apps/relay, which is its own workspace and reads its own Cargo.lock.
COPY Cargo.toml Cargo.lock ./
COPY crates/wf-core crates/wf-core
COPY apps/relay apps/relay
WORKDIR /src/apps/relay
RUN cargo build --release --locked -p wf-relay-server \
 && cp target/release/wf-relay-server /usr/local/bin/wf-relay-server

FROM debian:bookworm-slim AS runtime
# ca-certificates: the server makes HTTPS calls (Supabase, PostgREST, upstreams).
# git: the Overleaf report content route clones projects over HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 relay \
 && useradd --system --uid 10001 --gid relay --no-create-home --shell /usr/sbin/nologin relay
COPY --from=builder /usr/local/bin/wf-relay-server /usr/local/bin/wf-relay-server
ENV RELAY_BIND=0.0.0.0:8787
USER relay
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/wf-relay-server"]
