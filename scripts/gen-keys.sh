#!/usr/bin/env bash
#
# Generates every key the stack needs, into ./data. DEVELOPMENT KEYS.
#
# Nothing here is safe for mainnet. The epoch signing key is the issuer's whole
# security story and belongs in Vault, mounted at runtime and rotated, and the
# settlement key on a live chain holds real funds. These are throwaway keys,
# right for `make local-e2e` and for a testnet, wrong for real money.
#
# Idempotent: an existing key is left alone. Delete ./data to start over.
set -euo pipefail

cd "$(dirname "$0")/.."
DATA="./data"
KEYS="$DATA/keys"
mkdir -p "$KEYS"

note() { printf '  %s\n' "$*"; }
have() { [ -s "$1" ]; }

echo "Generating key material into $DATA (dev/testnet only)"

# --- Connector -------------------------------------------------------------
# The README specifies a 32-byte raw or 64-character hex key.
if have "$DATA/signer.key"; then note "signer.key exists, kept"; else
  openssl rand -hex 32 > "$DATA/signer.key"
  note "signer.key            connector packet signer"
fi

# The connector's settlement identity. It pays gas and receives redeemed claims,
# so it needs Base Sepolia ETH and holds the node's earnings.
if have "$DATA/evm.key"; then note "evm.key exists, kept"; else
  openssl rand -hex 32 > "$DATA/evm.key"
  note "evm.key               EVM settlement key -- MUST BE FUNDED, see below"
fi

# --- Operator surface ------------------------------------------------------
if have "$DATA/operator-bearer-token"; then note "operator token exists, kept"; else
  openssl rand -hex 32 > "$DATA/operator-bearer-token"
  note "operator-bearer-token read access to /peers /routes /channels /claims"
fi

if have "$DATA/operator-write-keys"; then note "operator write keys exist, kept"; else
  openssl genpkey -algorithm ed25519 -out "$KEYS/operator.key.pem" 2>/dev/null
  # Raw 32-byte public key: an Ed25519 SPKI DER is 44 bytes, the last 32 of
  # which are the key itself.
  openssl pkey -in "$KEYS/operator.key.pem" -pubout -outform DER 2>/dev/null \
    | tail -c 32 | od -An -v -tx1 | tr -d ' \n' > "$DATA/operator-write-keys"
  echo >> "$DATA/operator-write-keys"
  note "operator-write-keys   signs RFC 9421 writes (fund, redeem-latest)"
fi

# --- The proxy pair --------------------------------------------------------
# The minter signs claims with the private half; the issuer verifies with the
# public half and never holds the private one.
if have "$KEYS/proxy.key.pem"; then note "proxy pair exists, kept"; else
  openssl genpkey -algorithm ed25519 -out "$KEYS/proxy.key.pem" 2>/dev/null
  openssl pkey -in "$KEYS/proxy.key.pem" -pubout -out "$KEYS/proxy.pub.pem" 2>/dev/null
  note "proxy.key.pem         claim minter signs with this"
  note "proxy.pub.pem         issuer verifies with this, and only this"
fi

# --- The issuer's epoch key ------------------------------------------------
# RSA-2048: 256-byte blanks and 256-byte signatures are 2048 bits. The issuer
# refuses to boot if the pubkey published in current.json does not match this
# private key, so both are written together and never separately.
if have "$KEYS/current.pem"; then note "epoch key exists, kept"; else
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$KEYS/current.pem" 2>/dev/null

  # Strict base64, no line breaks: the issuer validates this as strict base64.
  PUBKEY="$(openssl rsa -in "$KEYS/current.pem" -pubout -outform DER 2>/dev/null | base64 -w0)"
  NOT_BEFORE="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  NOT_AFTER="$(date -u -d '+365 days' +%Y-%m-%dT%H:%M:%S.000Z)"

  cat > "$KEYS/current.json" <<JSON
{
  "epoch_id": "0",
  "not_before": "$NOT_BEFORE",
  "not_after": "$NOT_AFTER",
  "alg": "RSABSSA-SHA384-PSS-Randomized",
  "pubkey": "$PUBKEY"
}
JSON
  note "current.pem           epoch signing key (RSA-2048)"
  note "current.json          published key document, epoch 0"
fi

chmod 700 "$DATA" "$KEYS"
find "$DATA" -type f -exec chmod 600 {} +

echo
echo "Done. These are DEVELOPMENT keys."
echo
echo "  For local development, which costs nothing:"
echo "    make local-e2e"
echo
echo "  The default config in config/connector.toml settles on ETHEREUM MAINNET"
echo "  in ANYONE. Do not point these keys at it: generate the settlement key"
echo "  and the epoch key out of band and mount them in the same paths."
echo
echo "  The settlement address appears in the settlements block of"
echo "  http://127.0.0.1:3000/ilp once it is running."
