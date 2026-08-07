#!/usr/bin/env bash
# Keep asking Oracle for an Always Free Ampere instance until one is free.
#
#   ./scripts/oci-launch-retry.sh
#
# Always Free A1 capacity in popular regions is contended, and `Out of host
# capacity` can persist for days. This retries on a schedule and stops the
# moment it succeeds.
#
# The reason it is not a one-line `until oci … ; do sleep 60; done`: that loop
# cannot tell "no capacity right now" from "your subnet OCID has a typo", so a
# malformed request retries silently until morning. This aborts immediately on
# anything that will never succeed, and only retries the one error that is
# genuinely worth waiting on.
#
# Reads .env.oci if present. Everything can also be passed as an environment
# variable. Nothing here is a secret — OCIDs are identifiers, not credentials —
# but .env.oci is gitignored anyway.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ -f .env.oci ]] && { set -a; . ./.env.oci; set +a; }

# The CLI's "permissions are too open" check misparses ACLs on some Windows
# setups and prints a paragraph of nonsense before every call. Check the real
# permissions once — `icacls "$USERPROFILE\.oci\config"` on Windows, `ls -l` on
# Unix — then keep the log readable.
export OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING=True

BLUE=$'\033[34m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
note() { printf '%s%s%s\n' "$DIM" "$*" "$OFF"; }
die()  { printf '\n%s✖ %s%s\n\n' "$RED" "$*" "$OFF"; exit 1; }

command -v oci >/dev/null || die "The OCI CLI is not installed. See docs/backend/oracle-shift-guide.md §1.5."

# Check authentication before anything else. Every discovery step below fails
# when the CLI is unconfigured, but each fails with a message about the thing it
# was looking for — "could not find a compartment" sends you hunting for an
# OCID when the real answer is that no credentials exist yet.
if ! oci iam region list >/dev/null 2>&1; then
  [[ -f "$HOME/.oci/config" ]] \
    && die "The OCI CLI is installed but its credentials are not working.
      Check ~/.oci/config, and that the API key is uploaded at
      Profile → My profile → API keys. Test with: oci iam region list" \
    || die "The OCI CLI is installed but not configured yet. Run:

      oci setup config

    It asks for your user OCID, tenancy OCID and region, then writes an API
    key. Upload the public half at Profile → My profile → API keys in the
    console. Then test with: oci iam region list"
fi

# ── Settings ────────────────────────────────────────────────────────────────

DISPLAY_NAME="${DISPLAY_NAME:-weaveforge}"
SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
BOOT_VOLUME_GB="${BOOT_VOLUME_GB:-50}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/oci_weaveforge.pub}"
INTERVAL="${INTERVAL:-90}"          # seconds between attempts
MAX_HOURS="${MAX_HOURS:-12}"        # give up after this long

# Shapes to try, largest first, as "ocpus:memory_gb".
#
# Oracle has to place the whole shape on a single host, so a smaller request
# fits gaps a larger one cannot. Asking for 2/12 all night while 1/6 slots go
# free is a common way to wait much longer than necessary. The free allowance
# is 2 OCPUs and 12 GB total since 15 June 2026 — do not raise this to 4/24.
SHAPE_LADDER="${SHAPE_LADDER:-2:12 1:6}"

# ── Discover what was not given ─────────────────────────────────────────────

say "${BLUE}Resolving${OFF}"

if [[ -z "${COMPARTMENT_ID:-}" ]]; then
  COMPARTMENT_ID="$(oci iam compartment list --all \
    --query "data[?\"lifecycle-state\"=='ACTIVE'] | [0].id" --raw-output 2>/dev/null)"
  [[ -n "$COMPARTMENT_ID" && "$COMPARTMENT_ID" != "null" ]] \
    || die "Could not find a compartment. Set COMPARTMENT_ID in .env.oci."
fi
note "  compartment  ${COMPARTMENT_ID:0:28}…"

if [[ -z "${AVAILABILITY_DOMAIN:-}" ]]; then
  AVAILABILITY_DOMAIN="$(oci iam availability-domain list \
    --query 'data[0].name' --raw-output 2>/dev/null)"
  [[ -n "$AVAILABILITY_DOMAIN" ]] || die "Could not list availability domains. Is the CLI configured? Run: oci setup config"
fi
note "  domain       $AVAILABILITY_DOMAIN"

if [[ -z "${SUBNET_ID:-}" ]]; then
  SUBNET_ID="$(oci network subnet list --compartment-id "$COMPARTMENT_ID" --all \
    --query "data[?contains(\"subnet-domain-name\",'sub')] | [0].id" --raw-output 2>/dev/null)"
  [[ -n "$SUBNET_ID" && "$SUBNET_ID" != "null" ]] \
    || die "Could not find a subnet. Set SUBNET_ID in .env.oci (Networking → VCN → Subnets)."
fi
note "  subnet       ${SUBNET_ID:0:28}…"

# Substring the image's display name must contain. The default picks the plain
# Ubuntu 24.04 ARM image: 'Canonical-Ubuntu-24.04-Minimal-aarch64' does not
# contain '24.04-aarch64', so Minimal is excluded — it omits nano and
# iptables-persistent, both of which the guide needs.
IMAGE_PATTERN="${IMAGE_PATTERN:-24.04-aarch64}"

if [[ -z "${IMAGE_ID:-}" ]]; then
  # Two filters, both load-bearing: --shape because the x86 images share a
  # display name and will not boot on Ampere, and the pattern because matching
  # only 'aarch64' also matches 22.04 and the Minimal variants. `--sort-by
  # TIMECREATED` does not save you — a 22.04 image published after a 24.04 one
  # sorts first, so you silently get the older release.
  IMAGE_ID="$(oci compute image list --compartment-id "$COMPARTMENT_ID" \
    --operating-system "Canonical Ubuntu" --shape "$SHAPE" \
    --query "data[?contains(\"display-name\",'$IMAGE_PATTERN')] | [0].id" --raw-output 2>/dev/null)"
  [[ -n "$IMAGE_ID" && "$IMAGE_ID" != "null" ]] \
    || die "No Ubuntu image matching '$IMAGE_PATTERN'. Set IMAGE_ID or IMAGE_PATTERN in .env.oci."
fi
IMAGE_NAME="$(oci compute image get --image-id "$IMAGE_ID" \
  --query 'data."display-name"' --raw-output 2>/dev/null)"
note "  image        ${IMAGE_NAME:-$IMAGE_ID}"

[[ -f "$SSH_KEY_FILE" ]] || die "No public key at $SSH_KEY_FILE. Generate one (guide §0.4) or set SSH_KEY_FILE."
note "  ssh key      $SSH_KEY_FILE"

# ── Attempt ─────────────────────────────────────────────────────────────────

LOG="oci-launch-retry.log"
started=$(date +%s)
deadline=$(( started + MAX_HOURS * 3600 ))
attempt=0

# Errors that will still be errors in an hour. Retrying these just hides them.
fatal_pattern='NotAuthenticated|NotAuthorizedOrNotFound|LimitExceeded|QuotaExceeded|InvalidParameter|CannotParseRequest|InvalidImage|MissingParameter'

launch() {
  local ocpus="$1" mem="$2"
  oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$AVAILABILITY_DOMAIN" \
    --shape "$SHAPE" \
    --shape-config "{\"ocpus\":$ocpus,\"memoryInGBs\":$mem}" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --display-name "$DISPLAY_NAME" \
    --assign-public-ip true \
    --boot-volume-size-in-gbs "$BOOT_VOLUME_GB" \
    --ssh-authorized-keys-file "$SSH_KEY_FILE" \
    --wait-for-state RUNNING \
    2>&1
}

# Did an instance appear despite the client giving up on the request?
#
# A launch can succeed on Oracle's side while the connection times out on ours
# — `RequestException: The connection to endpoint timed out` is exactly that
# shape of failure, and it says nothing about whether the VM was created. Retry
# blindly after one and you get a second instance, quietly over the free
# allowance. So look before every attempt, not just the first.
existing_instance() {
  oci compute instance list --compartment-id "$COMPARTMENT_ID" --all --raw-output \
    --query "data[?\"display-name\"=='$DISPLAY_NAME' && \"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" \
    2>/dev/null | grep -E '^ocid1\.instance\.' || true
}

show_landed() {
  local id="$1" why="$2" ip
  ip="$(oci compute instance list-vnics --instance-id "$id" \
        --query 'data[0]."public-ip"' --raw-output 2>/dev/null)"
  printf '\n\n%s✓ %s%s\n\n' "$GREEN" "$why" "$OFF"
  if [[ -n "$ip" && "$ip" != "null" ]]; then
    say "  Public IP: $ip"
    say "  ssh -i ${SSH_KEY_FILE%.pub} ubuntu@$ip"
  else
    say "  Instance: $id (no public IP yet — give it a minute)"
  fi
  say ""
  note "  Next: guide §1.6, then §1.4 for the firewall inside the VM."
  say ""
}

if found="$(existing_instance)" && [[ -n "$found" ]]; then
  show_landed "$found" "An instance named '$DISPLAY_NAME' already exists — not creating another."
  exit 0
fi

say ""
say "${BLUE}Trying${OFF} — ladder: $SHAPE_LADDER, every ${INTERVAL}s, giving up after ${MAX_HOURS}h"
note "  log: $LOG        stop with Ctrl-C"
say ""

while (( $(date +%s) < deadline )); do
  for pair in $SHAPE_LADDER; do
    ocpus="${pair%%:*}"; mem="${pair##*:}"
    attempt=$(( attempt + 1 ))

    printf '%s  [%s] attempt %d — %s OCPU / %s GB … %s' \
      "$DIM" "$(date +%H:%M:%S)" "$attempt" "$ocpus" "$mem" "$OFF"

    output="$(launch "$ocpus" "$mem")"
    status=$?

    printf '%s\n%s\n' "--- $(date -Is) ${ocpus}/${mem}" "$output" >> "$LOG"

    if (( status == 0 )); then
      id="$(printf '%s' "$output" | grep -o 'ocid1\.instance\.[^"[:space:]]*' | head -1)"
      show_landed "$id" \
        "Got one. $ocpus OCPU / $mem GB after $attempt attempt$( ((attempt == 1)) || printf s )."
      exit 0
    fi

    if printf '%s' "$output" | grep -qE "$fatal_pattern"; then
      printf '\n'
      say "$output" | tail -20
      die "That will not fix itself — stopping rather than retrying all night. Full output in $LOG."
    fi

    if printf '%s' "$output" | grep -qiE 'out of (host )?capacity|OutOfHostCapacity'; then
      printf '%sno capacity%s\n' "$DIM" "$OFF"
    elif printf '%s' "$output" | grep -qiE 'RequestException|connection to endpoint timed out|ConnectTimeout|ReadTimeout|Max retries exceeded'; then
      # Client-side: the request never got a verdict. It may still have landed.
      printf '%snetwork timeout — verifying nothing was created%s\n' "$DIM" "$OFF"
      if found="$(existing_instance)" && [[ -n "$found" ]]; then
        show_landed "$found" "The request timed out, but the instance was created anyway."
        exit 0
      fi
    else
      printf '%sfailed (see log)%s\n' "$DIM" "$OFF"
    fi
  done

  sleep "$INTERVAL"
done

die "Gave up after ${MAX_HOURS}h and $attempt attempts. Capacity genuinely scarce — try a different time of day, or see the Pay As You Go note in the guide."
