#!/usr/bin/env bash
#
# Reads this node's hidden-service address out of the `anon` sidecar and renders it into
# the config the connector mounts.
#
# THIS SCRIPT IS THE OPERATOR, not the connector. The connector never reads the
# daemon's hostname file and never speaks its control protocol -- connector
# ADR 0070 decision 7 rejects both, because they couple a node's own
# self-description to a sidecar's filesystem layout for a value that never
# changes once generated. So the copying is a step outside the binary, and this
# script is only doing by hand what the runbook tells an operator to do by hand.
#
#   config/connector.toml           committed, holds a placeholder .anyone host
#   config/.rendered/connector.toml generated, holds the real one, gitignored
#                                   -- and is what compose mounts
#
# Idempotent: re-running it against an unchanged address rewrites the same file.
set -euo pipefail

cd "$(dirname "$0")/.."

# The template and its rendered twin. Defaults are the mainnet pair; the local
# rehearsal passes its own, because it settles on anvil rather than on chain 1.
# `docker compose` finds the right stack through COMPOSE_FILE, which the Makefile
# exports -- there is no second copy of the file list here.
TEMPLATE="${1:-config/connector.toml}"
RENDERED="${2:-config/.rendered/connector.toml}"
PLACEHOLDER="placeholderplaceholderplaceholderplaceholderplaceholdera.anyone"
HOSTNAME_FILE="/var/lib/anon/hidden_service/hostname"

die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

[ -f "$TEMPLATE" ] || die "$TEMPLATE is missing."

# --- Read it out of the daemon ----------------------------------------------
if [ -z "$(docker compose ps -q anon 2>/dev/null)" ]; then
  die "The \`anon\` sidecar is not running, so no address exists to read.
  Start it first:  docker compose up -d anon
  Then wait for it:  docker compose logs -f anon   (look for Bootstrapped 100%)"
fi

ADDRESS="$(docker compose exec -T anon cat "$HOSTNAME_FILE" 2>/dev/null | tr -d '[:space:]' || true)"

if [ -z "$ADDRESS" ]; then
  die "The daemon has not generated an address yet.
  A container that is Up is not a container that has a circuit -- wait for
  \`Bootstrapped 100%\` in \`docker compose logs anon\` and run this again.
  If it exits immediately, check that config/anonrc still says AgreeToTerms 1."
fi

# An address is 56 characters of the base32 alphabet, then `.anyone`. Checked
# here rather than left to the connector, because a truncated read is the
# plausible failure and it would otherwise surface as an address that parses,
# loads, and resolves to nothing.
if ! printf '%s' "$ADDRESS" | grep -Eqx '[a-z2-7]{56}\.anyone'; then
  die "Read something that is not a hidden-service address: '$ADDRESS'
  Expected 56 characters of [a-z2-7] followed by .anyone.
  A `.onion` address means the daemon is the OLD v0.4.9.7 release, whose TLD
  every buyer now refuses -- see anon-image/Dockerfile."
fi

# --- Gate (b): the address must survive a restart ---------------------------
# The runbook puts HiddenServiceDir beside state_dir for a reason. If it is not
# persisted, the daemon generates a NEW address on every restart and every
# buyer's configuration goes stale silently -- their URL still parses and still
# resolves to nothing. A changed address here is the only cheap warning of it.
if [ -f "$RENDERED" ]; then
  PREVIOUS="$(grep -oE '[a-z2-7]{56}\.anyone' "$RENDERED" | head -1 || true)"
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$ADDRESS" ]; then
    cat >&2 <<WARN

  ================================================================
  THIS NODE'S ADDRESS HAS CHANGED.

    was  $PREVIOUS
    now  $ADDRESS

  Every buyer holding the old one now dials an address that does not
  exist, and nothing tells them. If you did not deliberately discard the
  daemon's volume, HiddenServiceDir is not persisted -- fix that before
  telling anyone this new address, or you will do this again on the next
  restart. See README section 5.
  ================================================================

WARN
  fi
fi

# --- Render ------------------------------------------------------------------
mkdir -p "$(dirname "$RENDERED")"

grep -q "$PLACEHOLDER" "$TEMPLATE" \
  || die "$TEMPLATE no longer contains the placeholder host this script
  substitutes ($PLACEHOLDER).
  If you edited [node].http_endpoint by hand, put the placeholder back --
  the committed file is a template, and the rendered one is the config."

sed "s|$PLACEHOLDER|$ADDRESS|g" "$TEMPLATE" > "$RENDERED"

printf '\n  %s\n\n' "$ADDRESS"
printf '  rendered into %s\n' "$RENDERED"
printf '  buyers reach this node at:  http://%s/ilp\n\n' "$ADDRESS"
