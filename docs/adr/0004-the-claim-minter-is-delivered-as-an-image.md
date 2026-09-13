# 4. The claim minter is delivered as an image

Date: 2026-09-11

## Status

Accepted

## Context

This repository consumes the credentials issuer as a published image,
unmodified, and consumes the connector as a SHA-pinned image. It introduces
exactly one component — the claim minter — and published nothing for it, so
every consumer built it from a checkout of this repository placed next to their
own.

The cost was visible in someone else's repository rather than in this one.
`toon-protocol/infra`'s sandbox carries `ANYTOON_CONTEXT ?= ../../anytoon`, a
build context under it, and a `require-anytoon-context` target that fails
`make up`, `make up-credentials` and `make up-hs` by name with the explanation
"it publishes no image". That sandbox has the same arrangement for the store,
where the required checkout is a branch that is not merged — and the comparison
is the argument. A checkout requirement is the honest answer for a component
under active change. It is the wrong answer for one that is finished.

The minter is finished in the sense that matters: it is small, holds no state,
has no dependencies, and does one thing whose interface is written down in
`docs/payment-claim.md`. What would change it is a change to that interface,
which is upstream's to make and would be a new version either way.

Two properties of this particular component complicate publishing it, and are
the reason this is an ADR rather than a chore. It signs the claim that admits
issuance, so its key material must not be able to reach a layer. And it carries
a price that a second service checks independently, so a default baked into the
image could silently win a disagreement and answer 402 on every paid request —
a failure that names neither side.

## Decision

Publish `ghcr.io/toon-protocol/claim-minter` from a pushed `v*` tag, built for
`linux/amd64` and `linux/arm64`, gated on the minter's own test suite.
Consumers pin by digest.

Three constraints ride with it, and each is enforced by a test rather than by
this document:

- **No configuration is defaulted.** `PROXY_PRIVATE_KEY_PATH`, `BUNDLE_PRICE`,
  `ISSUER_URL` and `ROUTE_ID` are all required, and the entrypoint refuses to
  boot with a one-line message naming what is missing instead of a stack trace.
  A container that will not start is a better failure than one that is Up and
  answers 402.
- **Key material stays outside the image.** The Dockerfile copies `src/` and
  `package.json` by name, `.dockerignore` keeps the test fixtures' throwaway
  private key out of the build context, and the key reaches a running container
  only through a mount.
- **Pin by digest, not by tag.** The version tags exist for a human reading a
  release; the digest is what a compose file names.

This repository's own `compose.yml` keeps its `build:` and adds the published
name at a `dev` tag, so the place the minter is developed is still the place it
is built.

## Consequences

`toon-protocol/infra` deletes `require-anytoon-context` rather than moving it,
and `make up-credentials` stops requiring a sibling checkout at all. What a
reader of that compose file can then tell about the minter they are running is a
digest, which is more than a build context ever told them.

The minter's environment becomes a contract. It was previously read from a
compose file in this repository alongside the source it configured; it is now
read by people who have neither. `docs/claim-minter-image.md` is where that
contract is written down, and the boot refusals are what make a breach of it
loud.

Pinning by digest is the term ADR 0001's security argument needs. That argument
rests on the deployment topology being what the compose file says it is, and a
consumer on a floating tag has a signing path that changes when someone else
pushes, with nothing in their repository to show it happened.

Versioning is now a decision someone has to make per release. The version tracks
the claim wire format and this service's behaviour — not the issuer's release,
not the connector's pin.

Deleting the minter gets harder, and that should be said plainly. ADR 0001 names
an upstream trusted-proxy mode as the path to not needing this component at all;
a published image has consumers, so that path now ends in a deprecation rather
than in a deletion. It is a small cost against a checkout requirement that every
consumer pays on every clone, and it does not change which option is right.
