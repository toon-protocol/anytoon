# The payment claim

*Status: proposal. This is the TOON side of an interface both projects have
flagged as unsettled, written down so it can be argued with.*

The credentials issuer requires a signed proof of payment on every issuance
request. Its scope document calls this "the one interface requiring TOON
agreement", its type carries the comment "provisional shape, pending TOON
agreement", and the document it points at for the specification is, at the time
of writing, a copy of an unrelated page. This file describes what the two sides
actually do today, which is the only specification that currently exists.

## Roles

The issuer expects a **fronting proxy**: something that collects payment and
vouches for it. On TOON that role is filled by two components.

| | Collects payment | Signs the claim | Sees the epoch key |
|---|---|---|---|
| Connector | yes | no | no |
| Claim minter | no | yes | no |
| Issuer | no | no | yes |

The split matters: the component that takes the money is not the component that
vouches for it, and neither can sign credentials.

## Wire format

The claim travels in the `X-Payment-Claim` request header. Its value is the
base64url encoding of a UTF-8 JSON object:

```json
{
  "payment_ref": "<identity the payment is attributed to>",
  "amount": "<exact decimal, e.g. 0.01>",
  "route_id": "<the route the payment was collected on>",
  "proxy_sig": "<base64url of a raw 64-byte Ed25519 signature>"
}
```

`proxy_sig` covers the other three fields and not itself. The signed bytes are
the UTF-8 encoding of a JSON object with **exactly these three keys in
alphabetical order and no whitespace**:

```
{"amount":"0.01","payment_ref":"evm:0x1111…","route_id":"g.anyone.credentials"}
```

The fixed ordering stands in for canonical JSON, so both sides produce identical
bytes without a canonicalisation library. It is load-bearing: any difference
produces a signature that verifies nowhere, and the only symptom is a 402 on a
request the buyer already paid for.

The signature is pure Ed25519 (RFC 8032, no prehash, no context) over those
bytes. The signing key is held only by the minter; the issuer holds the public
half and verifies with it.

## Verification

The issuer, in order:

1. parses the header as base64url JSON and requires a non-empty `payment_ref`,
2. requires `amount`, `route_id` and `proxy_sig` to be present and non-empty,
3. verifies `proxy_sig` over the canonical bytes under the proxy public key,
4. compares `amount` to its own configured bundle price, by exact decimal value.

The order of steps 3 and 4 is deliberate: an unsigned caller cannot learn the
price by observing which error comes back.

Step 4 means **the price is enforced in two places at once**. The proxy prices
the route, and the issuer independently refuses an amount that is not its own
configured price. A proxy cannot mint a mismatched amount without invalidating
its own signature. It also means the two configured prices must agree exactly,
or nothing can ever be bought.

## Field semantics

**`payment_ref`** — the identity the payment is attributed to. This is not an
opaque receipt id: the issuer rate-limits on it, keys idempotent retries on it,
and retains it. It should be stable for a given payer across requests, and
should name a payer rather than a request. This deployment uses the paying
channel identity; see ADR 0002.

**`amount`** — an exact decimal string, compared by value rather than by
spelling, so trailing zeros do not matter. It carries no currency or chain, and
is meaningful only against a bundle price the two sides agreed out of band.

**`route_id`** — the route the payment was collected on. Signed, retained, and
not otherwise checked.

## Known gaps

These are properties of the interface as it stands, not of any one deployment.

**A claim is replayable.** It carries no nonce, no timestamp and no expiry, and
nothing records that one has been used. Anyone holding a valid claim can buy
bundles with it until the payment reference's rate limit stops them. Upstream
documents this. Two things follow for anyone implementing the proxy role: a
claim must never leave the trusted network, and an inbound claim from a caller
must always be discarded rather than forwarded — the issuer cannot tell the
difference.

**The claim does not bind to the request.** Nothing ties a claim to the specific
blanks it paid for, so a claim that is valid for one issuance is valid for any
issuance at the same price.

**`amount` is unitless.** Two deployments agreeing on `"1.00"` may not agree on
what was paid.

## Suggested change

Adding a nonce and an expiry to the signed fields, and recording spent nonces
for the expiry window, would close the replay gap and let a claim safely cross a
boundary less trusted than a private network. That is upstream's decision to
make; this deployment is built so that it does not depend on the gap staying
open, and would need only to start populating the new fields.
