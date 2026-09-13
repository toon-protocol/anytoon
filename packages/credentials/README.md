# @toon-protocol/credentials

The buyer's half of the [credentials-issuer](https://github.com/anyone-protocol/credentials-issuer)
blind-signature protocol, and nothing else: import an epoch key, blind `k`
serials, unblind the issuer's answer, verify.

There is no client here, no transport and no connector. Paying for issuance is
the buyer's business and differs per buyer; this is the part every buyer has to
get bit-identical to the issuer's, which is why it is a package and not a file
to copy.

```
npm install @toon-protocol/credentials
```

Node >= 24. The module calls `crypto.subtle` and `Buffer`, and nothing else.

## Use

```ts
import {
  blindBlanks,
  finalizeCredentials,
  importEpochKey,
  suite,
  type KeyDocument,
} from '@toon-protocol/credentials';

// 1. The epoch key, from the issuer's key document. Refuses a document that
//    names another suite, or an epoch that is over or has not started: blinding
//    under a dead epoch buys signatures nothing will accept.
const doc: KeyDocument = await (await fetch(`${issuer}/v1/keys/current`)).json();
const publicKey = await importEpochKey(doc);

// 2. Blind k fresh serials. The issuer sees only `blinded`.
const blanks = await blindBlanks(publicKey, 10);

// 3. Pay for issuance, however your buyer pays. Send `blanks.map(b => b.blinded)`.
const { blind_signatures } = await buyABundle(doc.epoch_id, blanks);

// 4. Unblind and verify. Throws unless all k verify under the epoch key.
const credentials = await finalizeCredentials(publicKey, blanks, blind_signatures);
```

## Why `finalizeCredentials` returns a pair

Each credential is `{ prepared, signature }`, and a holder needs both.

`suite.verify(key, signature, prepared)` is the check a relay makes.
`prepared` is the randomizer-prefixed serial the signature actually covers, and
it is **not recoverable from the signature** — the randomizer is 32 fresh bytes.
A holder that persists only the signature has thrown away half of what it paid
for, and will discover this at the relay rather than at issuance.

Persist both. They are plain bytes:

```ts
const stored = credentials.map((c) => ({
  prepared: Buffer.from(c.prepared).toString('base64'),
  signature: Buffer.from(c.signature).toString('base64'),
}));
```

Credentials come back in the order the blanks went out: the issuer signs blanks
positionally, so credential `i` belongs to blank `i`.

## Invariants this package carries

These are the **issuer's** invariants, not conveniences of this module. Both
ends must agree with the issuer, not merely with each other; a divergence does
not present as a bug, it presents as credentials that do not verify, discovered
after they have been paid for.

- **I1 — no hand-rolled crypto.** Every protocol step runs inside
  [`@cloudflare/blindrsa-ts`](https://github.com/cloudflare/blindrsa-ts). This
  module sequences that library's calls and handles base64; it implements no
  step of RSABSSA itself.
- **I2 — the issuer must never see a serial.** `blindBlanks` generates the
  serial locally and hands out only `blinded`. The unblinding factor `inv` never
  leaves the process either. This is the buyer-side half of that guarantee.

## API

| export | what it is |
| --- | --- |
| `SUITE_NAME` | `'RSABSSA-SHA384-PSS-Randomized'` — the suite an epoch key document must name |
| `suite` | the `@cloudflare/blindrsa-ts` suite instance, exposed so a holder can `verify` later |
| `KeyDocument` | the issuer's published epoch: id, validity window, `alg`, strict-base64 SPKI |
| `importEpochKey(doc)` | `Promise<CryptoKey>`; throws on a wrong suite or an epoch that is not currently valid |
| `blindBlanks(publicKey, count)` | `Promise<Blank[]>`; each blank carries `prepared`, `inv`, and base64 `blinded` |
| `finalizeCredentials(publicKey, blanks, blindSignatures)` | `Promise<Credential[]>` of `{ prepared, signature }`, each verified before return |

`finalizeCredentials` throws if the count of signatures does not match the count
of blanks, and if any credential fails to verify — so `k` blobs of the right
size cannot pass as `k` credentials.

## How this ships its types: compiled `.js` + `.d.ts`

The repository this is extracted from runs raw TypeScript through Node
(`node src/buy.ts`) and relies on Node's type stripping, so shipping the `.ts`
sources directly and pointing `exports` at them looks like the smaller option.
It does not work, and the reason is not version skew:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]:
Stripping types is currently unsupported for files under node_modules
```

Node refuses to strip types for **any** file under `node_modules`, on every
version that has type stripping — a dependency is exactly the case it excludes.
So a `.ts`-only package is unusable by the consumer it was written for, before
any question of older Node or a bundler arises.

Therefore: `tsc` emits `dist/*.js` and `dist/*.d.ts`, `exports` points at those,
and the `.ts` sources ship alongside with source maps and declaration maps so
stepping into the code lands in the original file. A consumer on Node 24+, on an
older Node, or behind a bundler gets the same plain ESM either way.

The sources stay strippable all the same (`erasableSyntaxOnly`), because the
repository of origin still runs them directly from the workspace.

## Licence

MIT.
