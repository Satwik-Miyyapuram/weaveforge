#!/usr/bin/env bash
# Warn before a volume fills, not after.
#
# Install on the OCI VM:
#   sudo install -m 755 disk-watch.sh /usr/local/bin/weaveforge-disk-watch
#   sudo systemctl enable --now weaveforge-disk-watch.timer
#
# There is no email on this box and no monitoring agent, so "alert" here means
# two things that cost nothing and cannot silently stop working: a line in the
# system journal, and a banner on the SSH login screen. You will see it the next
# time you log in, which for a box you administer by hand is the moment that
# matters.
#
# Why it matters more than usual: Postgres and MinIO share a 200 GB Always Free
# allowance across separate volumes. MinIO has a bucket quota so it cannot eat
# its own disk, but nothing stops Postgres growing into its own — and a Postgres
# that runs out of disk stops accepting writes.

set -uo pipefail

WARN=${WARN:-75}
CRIT=${CRIT:-90}
STATUS=/var/lib/weaveforge/disk.status

mkdir -p "$(dirname "$STATUS")"
: > "$STATUS"

worst=0

for mount in /mnt/pgdata /mnt/minio /; do
  mountpoint -q "$mount" 2>/dev/null || [ "$mount" = "/" ] || continue

  read -r used size pct <<<"$(df -h --output=used,size,pcent "$mount" | tail -1)"
  n=${pct%\%}

  if   (( n >= CRIT )); then level=CRITICAL; (( worst < 2 )) && worst=2
  elif (( n >= WARN )); then level=WARNING;  (( worst < 1 )) && worst=1
  else                       level=ok
  fi

  printf '%-12s %5s / %-5s %4s  %s\n' "$mount" "$used" "$size" "$pct" "$level" >> "$STATUS"

  if [ "$level" != ok ]; then
    logger -t weaveforge-disk -p "user.$([ "$level" = CRITICAL ] && echo err || echo warning)" \
      "$mount at $pct ($used of $size) — expand the volume: see infra/oci/disk-watch.sh"
  fi
done

# The cold blob bucket, by size rather than by percentage.
#
# Deliberately an alert and not a block. MinIO's own quota is a hard stop set
# just under the volume size — that exists so a runaway upload fails cleanly
# instead of filling the filesystem and taking Postgres' neighbour down with it.
# This warns long before that, so growth is a decision rather than an incident.
BUCKET_WARN_GB=${BUCKET_WARN_GB:-40}

if [ -f /home/ubuntu/weaveforge-infra/.env ]; then
  # shellcheck disable=SC1091
  set -a; . /home/ubuntu/weaveforge-infra/.env; set +a

  used_bytes=$(docker run --rm --entrypoint sh --network weaveforge-infra_default \
    -e MC_HOST_local="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
    minio/mc:latest -c "mc du --json local/weaveforge-cold" 2>/dev/null \
    | sed -n 's/.*"size":\([0-9]*\).*/\1/p' | head -1)

  if [ -n "${used_bytes:-}" ]; then
    used_gb=$(( used_bytes / 1000000000 ))
    printf '%-12s %5s GB %-11s %s\n' "cold bucket" "$used_gb" "of ${BUCKET_WARN_GB} GB" \
      "$( (( used_gb >= BUCKET_WARN_GB )) && echo WARNING || echo ok )" >> "$STATUS"

    if (( used_gb >= BUCKET_WARN_GB )); then
      (( worst < 1 )) && worst=1
      logger -t weaveforge-disk -p user.warning \
        "cold bucket at ${used_gb} GB — hard quota stops writes near the volume size; expand the volume and raise the quota"
    fi
  fi
fi

# Login banner. Only present when something needs attention, so an empty MOTD
# is itself the all-clear.
BANNER=/etc/update-motd.d/99-weaveforge-disk
if (( worst > 0 )); then
  {
    echo '#!/bin/sh'
    echo "cat <<'EOF'"
    echo ''
    echo "  Disk pressure on this box:"
    echo ''
    sed 's/^/    /' "$STATUS"
    echo ''
    echo "  Expand a volume (online, no downtime, no rebuild):"
    echo "    oci bv volume update --volume-id <ocid> --size-in-gbs <bigger>"
    echo "    echo 1 | sudo tee /sys/class/block/<sdX>/device/rescan"
    echo "    sudo resize2fs /dev/<sdX>"
    echo ''
    echo "  Volumes only grow — never shrink. Always Free covers 200 GB total,"
    echo "  boot volume included."
    echo ''
    echo 'EOF'
  } > "$BANNER"
  chmod 755 "$BANNER"
else
  rm -f "$BANNER"
fi

cat "$STATUS"
