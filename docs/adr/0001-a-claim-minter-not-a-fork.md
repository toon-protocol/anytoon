# 1. A claim minter, not a fork

Date: 2026-09-04

## Status

Accepted

## Context

The credentials issuer is built to sit behind a fronting proxy that collects
payment and forwards a signed payment claim. The TOON connector is a paid
reverse proxy that collects payment. They do not compose directly.

The connector's contract is that the app behind it is payment-oblivious: it
receives an ordinary HTTP request and "must not decide anything about the
payment". It communicates three optional attribution headers — payer, amount and
chain — and states that these are informational, present only when that node
collected the payment itself, and absent when a node upstream did.

The issuer is not payment-oblivious and cannot be configured to be. Its claim
verifier is unconditional, the proxy public key is required at boot, and
invariant I6 states that no free class exists anywhere in the service. Without a
valid claim, every request is answered 402.

So something must produce a claim. The options were:

1. A small service that mints claims from the connector's attribution.
2. A change upstream adding a trusted-proxy mode, removing the need entirely.
3. A single static claim, mounted as configuration and reused for every request.
4. Reimplementing the issuer natively for TOON.

## Decision

Build a claim minter: one small service, between the connector and the issuer,
that signs a payment claim per request with a key generated here, whose public
half the issuer mounts. The issuer image is consumed unmodified.

**Network isolation is what authorises issuance.** The minter does not inspect
the amount header, and must not. Doing so would violate the connector's contract
and would break outright whenever a node upstream legitimately collected. Instead
the connector is the only ingress: the minter, the issuer and their datastores
sit on a network with no route off the host and publish no ports. Reaching the
minter at all means the connector already collected.

Two consequences of that boundary are load-bearing enough to state here:

- The minter proxies exactly one method and path. The route's handler target is
  the minter's root, so without a whitelist a caller could reach any issuer path
  with a freshly minted claim attached.
- The minter always discards an inbound claim header before setting its own. The
  connector relays caller headers verbatim — it owns only its own three names —
  and the issuer has no replay protection, no nonce and no expiry. A claim that
  ever leaked would otherwise be reusable by anyone who presented it.

## Consequences

The issuer stays on its own release cadence and we consume its published image;
nothing here is blocked on another organisation. The blind-signature work, the
reconciliation counters and the invariants are all reused rather than
reimplemented.

The cost is a component that should not need to exist, and a security argument
that rests on deployment topology rather than on cryptography. That argument is
only as good as the compose file, which is why the trust boundary is stated in
the compose file itself and not only here.

Option 2 remains the right long-term answer and is the path to deleting the
minter; it was rejected only as a starting point, because it blocks this work on
another organisation's roadmap. Option 3 was rejected because a static claim is
precisely the replay hole upstream already documents, and it would make the
issuer's retained payment references meaningless. Option 4 throws away audited
crypto to solve a header-shaped problem.
