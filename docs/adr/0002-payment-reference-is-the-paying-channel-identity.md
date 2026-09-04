# 2. The payment reference is the paying channel identity

Date: 2026-09-04

## Status

Accepted

## Context

Every payment claim carries a payment reference. In the issuer it does far more
than name a payment:

- it is the rate-limiter's key, deliberately chosen over the client IP so that
  limits follow the payer,
- it is half of the composite key for idempotent retries, alongside the caller's
  idempotency key,
- it is one of only four fields retained per purchase under invariant I5.

The minter must therefore choose what to put there. The candidates were the
paying channel identity from the connector's attribution, a per-request unique
value, or a random value per request.

## Decision

The payment reference is the paying channel identity — the payer the connector
attributes the request to.

Where that attribution is absent, the minter fails closed: it answers 402 and
signs nothing.

## Consequences

Rate limits follow the payer, which is the behaviour the issuer was designed
for. A buyer retrying with the same idempotency key presents the same payment
reference, so the composite key matches and the retry returns the original
bundle rather than buying a second one.

A per-request value would have defeated both: every request would land in a
fresh rate-limit bucket, and a retry would never match the composite key it was
supposed to match.

The reference is not a secret, but it is an identity, and it is retained. It
names a channel, not a person, which is the weakest identifier that still makes
the issuer's accounting mean anything.

Failing closed has a real consequence: it means this route must be terminated by
our own node and never forwarded, because the attribution header is absent
whenever an upstream node collected. That is why the connector is configured
with no peering. **Adding a peer is the change that forces this decision to be
revisited** — at that point either the fallback becomes a real design question,
or forwarded requests simply stop working, and the second is much easier to
diagnose than a shared rate-limit bucket that quietly degrades.

This decision depends on the issuer not gaining replay protection keyed on the
payment reference being unique per request. If upstream adds a nonce, revisit.
