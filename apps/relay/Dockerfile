# WeaveForge relay server (wf-relay-server).
#
# Build from the repo root, because the server is a member of the root workspace
# and builds against its Cargo.lock:
#   docker build -f apps/relay/Dockerfile .

FROM rust:1.98-bookworm AS builder
WORKDIR /src
# Cargo loads every workspace member's manifest and targets, so the core crates
# and the shell come along, though only the server's graph is built.
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps/shell apps/shell
COPY apps/relay apps/relay
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
