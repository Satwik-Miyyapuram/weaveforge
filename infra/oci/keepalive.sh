#!/usr/bin/env bash
# Stop Oracle reclaiming this instance as idle.
#
# Install on the OCI VM:
#   sudo install -m 755 keepalive.sh /usr/local/bin/weaveforge-keepalive
#   sudo systemctl enable --now weaveforge-keepalive.timer
#
# Oracle reclaims an Always Free compute instance when, across a 7-day window,
# *all three* of these hold:
#
#   CPU     95th percentile  < 20%
#   Network                  < 20%
#   Memory (A1 shapes only)  < 20%
#
# It is an AND, so keeping any single one above the line is enough. That matters
# because it means this can be cheap.
#
# CPU is the one worth targeting. A 95th percentile means the threshold is
# crossed once more than 5% of samples sit above 20% — so a short burst each
# hour is sufficient, and there is no need to hold load continuously. Eight
# minutes an hour on one core is ~13% of one of two OCPUs, with enough margin
# that a few missed runs do not matter.
#
# Memory looks like the cheaper lever and is not. `shared_buffers=3GB` reserves
# address space but Postgres pages it in lazily, so a quiet box still reports
# ~7% used and still counts as idle. It only becomes real once the database is
# genuinely being read, which is exactly when you least need the protection.

set -uo pipefail

SECONDS_OF_LOAD=${SECONDS_OF_LOAD:-480}

# One core, deliberately. Two would double the cost for no benefit — the
# threshold is a percentage of the instance, and one busy core out of two is
# already 50%, comfortably above 20%.
timeout "$SECONDS_OF_LOAD" bash -c 'while :; do :; done' || true

# A little network too. Cheap, and it means the instance is not relying on a
# single metric staying above the line.
curl -fsS -m 30 -o /dev/null https://www.google.com/generate_204 2>/dev/null || true

logger -t weaveforge-keepalive "kept instance warm: ${SECONDS_OF_LOAD}s CPU"
