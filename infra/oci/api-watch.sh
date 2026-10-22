#!/usr/bin/env bash
# Restart a container Docker has marked unhealthy, and restart PostgREST when
# a real API request through it fails.
#
# Install on the OCI VM:
#   sudo install -m 755 api-watch.sh /usr/local/bin/weaveforge-api-watch
#   sudo systemctl enable --now weaveforge-api-watch.timer
#
# with these two units in /etc/systemd/system/:
#
#   weaveforge-api-watch.service
#     [Unit]
#     Description=Restart unhealthy WeaveForge containers
#     [Service]
#     Type=oneshot
#     ExecStart=/usr/local/bin/weaveforge-api-watch
#
#   weaveforge-api-watch.timer
#     [Unit]
#     Description=Check WeaveForge container health every minute
#     [Timer]
#     OnBootSec=2min
#     OnUnitActiveSec=1min
#     [Install]
#     WantedBy=timers.target
#
# Why: Docker runs health checks but never acts on them outside Swarm, and
# `restart: unless-stopped` only fires when the process exits. On 2026-10-22
# PostgREST's connection pool wedged while the process stayed up, and every API
# call answered 504 until someone restarted it by hand. The health check in
# docker-compose.yml now catches that state; this turns "unhealthy" into a
# restart.
#
# PostgREST also gets a direct HTTP probe: its image has no shell, so its
# in-container healthcheck can only use `postgrest --ready`, which may not see a
# wedged pool. `GET /` goes through the pool, so it fails exactly when the API
# does. Three failures 10 s apart trigger a restart, so one slow request does
# not. Worst case from wedge to recovery: about 1.5 min.
#
# Postgres is deliberately not in the list: restarting the database on a failed
# probe is a bigger decision than restarting a stateless proxy.

set -uo pipefail

CONTAINERS=${CONTAINERS:-"weaveforge-postgrest weaveforge-realtime"}
PROBE_CONTAINER=${PROBE_CONTAINER:-weaveforge-postgrest}
PROBE_URL=${PROBE_URL:-http://127.0.0.1:3000/}

restart() {
  if docker restart "$1" >/dev/null; then
    logger -t weaveforge-api-watch "$1 restarted"
  else
    logger -t weaveforge-api-watch -p user.err "$1 restart failed"
  fi
}

for name in $CONTAINERS; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null) || continue
  [ "$health" = unhealthy ] || continue

  logger -t weaveforge-api-watch -p user.warning "$name is unhealthy; restarting"
  restart "$name"
done

# Direct probe of the PostgREST API. Skipped while the container is stopped or
# still starting, so deliberate stops and boots are left alone.
state=$(docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$PROBE_CONTAINER" 2>/dev/null) || exit 0
case "$state" in "true starting" | false*) exit 0 ;; esac

for attempt in 1 2 3; do
  curl -fsS -o /dev/null -m 8 "$PROBE_URL" 2>/dev/null && exit 0
  [ "$attempt" -lt 3 ] && sleep 10
done
logger -t weaveforge-api-watch -p user.warning "$PROBE_URL failed 3 times"
restart "$PROBE_CONTAINER"
