#!/usr/bin/env bash
# Restart a container Docker has marked unhealthy.
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
# restart. Worst case from wedge to recovery: ~2 min of failed checks plus one
# timer tick.
#
# Postgres is deliberately not in the list: restarting the database on a failed
# probe is a bigger decision than restarting a stateless proxy.

set -uo pipefail

CONTAINERS=${CONTAINERS:-"weaveforge-postgrest weaveforge-realtime"}

for name in $CONTAINERS; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null) || continue
  [ "$health" = unhealthy ] || continue

  logger -t weaveforge-api-watch -p user.warning "$name is unhealthy; restarting"
  if docker restart "$name" >/dev/null; then
    logger -t weaveforge-api-watch "$name restarted"
  else
    logger -t weaveforge-api-watch -p user.err "$name restart failed"
  fi
done
