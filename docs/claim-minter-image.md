# The claim minter as a published image

*Status: the workflow exists; nothing is published yet. The digest below is a
placeholder until the first `v*` tag is pushed — see "Cutting a release".*

The claim minter is the one component this repository introduces. Everything
else in `compose.yml` is pulled: the issuer by tag, the connector by SHA pin.
The minter was pulled by nobody, because it was published nowhere, so every
consumer built it from a checkout of this repository sitting next to their own.
`.github/workflows/claim-minter-image.yml` ends that; ADR 0004 says why the
minter in particular is the right component to deliver this way.

```
ghcr.io/toon-protocol/claim-minter
```

## Pin it by digest

```yaml
services:
  claim-minter:
    # <!-- FIRST PUBLISHED DIGEST GOES HERE -->
    # Replace the placeholder below with the digest from the publish job's
    # summary. Until the first `v*` tag exists there is nothing to paste.
    image: ghcr.io/toon-protocol/claim-minter@sha256:0000000000000000000000000000000000000000000000000000000000000000 # vX.Y.Z, YYYY-MM
```

The trailing comment is not decoration. A digest says nothing about which
release it is, and the alternative to writing it down is asking someone to run
`docker buildx imagetools inspect` to find out what they are already running.
`toon-protocol/infra` already pins the connector this way.

The digest to paste is the one the publish job prints in its summary. It is an
**index** digest: it resolves to `linux/amd64` on one machine and `linux/arm64`
on another, so the same string is correct on an Apple Silicon laptop and on a CI
runner. Do not pin a per-architecture digest — it will pull, and then it will
fail to run for the next person.

## Why a digest and not a tag

The workflow publishes `1.2.3`, `1.2`, `1` and `latest` for every release, and
all four of those can be made to point somewhere else afterwards. A digest
cannot: it *is* the content.

That matters more for this component than for most, because of what it holds. A
claim minter signs the payment claim that admits issuance, with the private half
of the pair the issuer trusts. A consumer running `latest` is a consumer whose
signing path changes when someone else pushes a tag, with no diff, no review and
nothing in their compose file to show it happened. The security argument in
ADR 0001 rests on deployment topology — on the compose file being what it says
it is — and a floating tag quietly removes one of the terms.

The version tags are for a human reading a release page. The digest is for the
machine.

## What the consumer must supply

The image defaults none of these, and refuses to start when one is missing.

| Variable | Why the image cannot default it |
|---|---|
| `PROXY_PRIVATE_KEY_PATH` | Names the mounted Ed25519 private key. A default would mean the image either carried a signing key or served without one; both are worse than a container that will not start. |
| `BUNDLE_PRICE` | The issuer independently compares the signed amount to **its own** configured price. Three places must agree — `connector.toml`'s `price`, the issuer's `BUNDLE_PRICE`, this one — and a baked default that silently won a disagreement would answer 402 on every paid request. |
| `ISSUER_URL` | The issuer's address on the internal network, which is the consumer's topology and not ours. |
| `ROUTE_ID` | The connector route the payment was collected on. Signed into every claim. |

`PORT` is the one optional value; it defaults to 8080, the port the image
exposes, and exists so a consumer with a port collision can move it.

Key material stays outside the image. `.dockerignore` keeps
`claim-minter/test/fixtures/proxy.key.pem` — a throwaway key that pins the
golden vector — out of the build context entirely, and the Dockerfile copies
`package.json` and `src/` by name rather than copying the context wholesale.
The image runs as uid 1000 (`node`) and needs no write access to anything,
including its own source: `--read-only` is a supported way to run it.

The surest guard against a future convenience is `claim-minter/test/boot.test.ts`,
which fails if any of the four acquires a default, and the publish job is gated
on that suite.

## What `toon-protocol/infra` changes

The sandbox builds this image from `${ANYTOON_CONTEXT:-../../anytoon}/claim-minter`
and gates `make up`, `make up-credentials` and `make up-hs` on a
`require-anytoon-context` target that fails by name when the checkout is absent.
With a published digest, all of it goes — and *goes*, rather than moving
somewhere else, which is the difference this document is for.

In `sandbox/docker-compose.yml`, the `claim-minter` service:

```diff
-    build:
-      context: ${ANYTOON_CONTEXT:-../../anytoon}/claim-minter
+    image: ghcr.io/toon-protocol/claim-minter@sha256:... # vX.Y.Z, YYYY-MM
```

Its `env_file: conf/anytoon.conf` stays exactly as it is: that file is read by
the issuer too, which is how the sandbox already guarantees the two
`BUNDLE_PRICE` values cannot drift apart. Everything else in the service —
`PROXY_PRIVATE_KEY_PATH`, the `anytoon-keys:/keys:ro` mount, the healthcheck,
the unpublished `expose` — is unchanged, because none of it was ever about where
the image came from.

In `sandbox/Makefile`:

- delete the `require-anytoon-context` target and remove it from `.PHONY`,
- delete `export ANYTOON_CONTEXT ?= ../../anytoon`,
- drop it from the prerequisites of `up`, `up-credentials` and `up-hs`
  (`up-credentials` is then prerequisite-free; `up` and `up-hs` keep
  `require-store-context`, which is a different repository's problem),
- delete the second `if` block in `setup`, the one printing "no anytoon checkout
  at ...".

`STORE_CONTEXT` and `require-store-context` stay. The store is built from an
unmerged branch, which is the case where a checkout requirement is the honest
answer; the minter's behaviour is finished, which is why it is not.

Nothing in `sandbox/README.md`'s prerequisites should still tell a reader to
clone this repository to run `make up-credentials`.

## Cutting a release

The workflow publishes on a pushed `v*` tag and on nothing else. A branch or
pull request runs the minter's tests and builds the image without pushing it, so
a Dockerfile that stopped building is caught before a release rather than during
one.

```
git tag -a v0.1.0 -m "claim minter 0.1.0"
git push origin v0.1.0
```

Then read the digest out of the publish job's summary, paste it into the
placeholder above, and open the consumer-side change.

Two things worth knowing before tagging. The publish job needs no secret beyond
`GITHUB_TOKEN` with `packages: write`, so there is nothing to rotate — but the
GHCR package is created **private** on first publish, and a consumer who cannot
pull it sees an authentication error rather than a permissions one. Make the
package public (or grant the consuming repository read access) immediately after
the first release. And the version is the minter's own: it tracks the claim wire
format and this service's behaviour, not the issuer's release, not the
connector's pin, and not this repository's compose file.
