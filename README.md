# anytoon

Operator guide for running the [Anyone Protocol credentials issuer][issuer]
behind the [TOON connector][connector].

A buyer pays in tokens over ILP and receives blind-signed credentials. The
issuer runs as its published image, unmodified.

```
buyer ──sealed ILP packet──▶ connector ──▶ claim minter ──▶ issuer ──▶ Postgres
                            collects      vouches for      signs      Redis
                            payment       the payment      blindly
```

---

## 1. Why there is a component in the middle

The connector requires the app behind it to be payment-oblivious: it decides
nothing about payment and holds no key toward a packet's fulfilment. The issuer
is the opposite — it refuses to sign without a payment claim signed by a key it
trusts, its verifier cannot be turned off, and its invariant I6 says no free
class exists anywhere in the service.

The **claim minter** is the translation. It turns the connector's statement of
*who paid* into the claim the issuer requires, and does nothing else. It
collects no money and authorises nothing.

- [ADR 0001](docs/adr/0001-a-claim-minter-not-a-fork.md) — why this rather than a fork
- [ADR 0002](docs/adr/0002-payment-reference-is-the-paying-channel-identity.md) — what the payment reference is
- [docs/payment-claim.md](docs/payment-claim.md) — the claim interface, which neither upstream project had written down
- [CONTEXT.md](CONTEXT.md) — glossary, because two systems here use the same words differently

---

## 2. Quick start

Requires Docker and Node 24+. Nothing else, and no testnet money:

```bash
make local-e2e
```

That runs the whole loop on a local chain — generate keys, run the tests, start
anvil with the settlement contracts, migrate the database, start the stack, buy
a bundle with real payment over ILP, and check the routes. It ends by printing
ten verified credentials.

The chain comes from the connector repository, which deploys the settlement
contracts at deterministic addresses on start; `make chain-up` clones it into
`.local-chain/` the first time. The buyer uses anvil's second test account,
which that deploy pre-funds with mock USDC.

### Commands

| Command | What it does |
|---|---|
| `make local-e2e` | The whole loop on a local chain. Start here. |
| `make local-up` / `make local-down` | Start / stop anvil and the stack against it |
| `make up` / `make down` | Start / stop the stack against Base Sepolia |
| `make buy` | Buy one bundle |
| `make verify-routes` | Negative checks against a running stack |
| `make keys` | Generate dev key material into `./data` |
| `make verify` | Check `./data/keys` against the issuer's boot rules |
| `make test` | Both unit suites — no chain, no containers |
| `make logs` | Follow the stack's logs |
| `make clean` | Stop everything and remove generated files |

---

## 3. Deploying

> **The default configuration settles on Ethereum mainnet, in ANYONE. That is
> real money.** `config/connector.toml` points at chain 1; `data/evm.key` pays
> real gas and holds this node's real earnings. The keys `make keys` generates
> are throwaway and are not suitable for it. For development, use
> `make local-e2e`, which settles on a local anvil and costs nothing.

### Networks

| Network | Registry | Token | Decimals |
|---|---|---|---|
| **Ethereum mainnet** (chain 1, default) | `0x61d31e7F…8B3427` | ANYONE `0xFeAc2Eae…F9C0F9` | 18 |
| Base mainnet (chain 8453) | `0x61d31e7F…8B3427` | USDC `0x833589fc…bdA02913` | 6 |
| Base Sepolia (chain 84532) | `0x0c41D9D4…7a8CCa5` | USDC `0x49beE1Bc…119a9Ce` | 6 |
| Local anvil (chain 31337) | `0xe7f1725E…bb3F0512` | mock USDC `0x5FbDB231…64180aa3` | 6 |

The mainnet registry and token network were verified on chain before being
made the default: `getTokenNetwork(ANYONE)` resolves to
`0xc24a18F1…4ec60Fa8`, and ANYONE reports 18 decimals. The connector re-checks
both at boot and refuses to start if either has changed.

**ANYONE settles on chain 1 only.** The token network is deployed at the same
address on Base, but bound there to USDC, not ANYONE — the same contract
address is a different binding on each chain. So the choice today is ANYONE on
L1, or USDC on an L2.

That matters for a micropayments node, because redemption costs L1 gas. It is
not per request: a channel claim is cumulative, so many packets are banked
off-chain and `redeem-latest` converts the running total in one transaction.
Gas therefore amortises across everything since the last redemption — but the
price per bundle still has to clear it at whatever cadence you redeem. Set the
price accordingly, and redeem in batches rather than per sale.

### Steps

```bash
make keys                       # generate key material
make verify                     # confirm the issuer will accept it
docker compose up -d --build
```

Then fund the connector's settlement key. `make keys` writes it to
`data/evm.key`; its address appears in the `settlements` block of
`http://127.0.0.1:3000/ilp` once the connector is up. It needs:

- **native gas** on the settlement chain, to fund channels and redeem claims
- **the settlement token**, only if this node will also *pay* others

A node that only receives needs gas alone. It banks claims off-chain and
converts them with `redeem-latest` (§6).

Replace the public RPC in `config/connector.toml` with your own node. The
default is shared and rate limited: fine for a trial, wrong for production.

Only the connector is published, on `127.0.0.1:3000`. The claim minter, the
issuer and their datastores have no published ports and no route off the host.
Put your own TLS termination in front of the connector; set
`[node].http_endpoint` to that public URL, ending in `/ilp`.

## 4. Configuration

### The price is coupled across three places

The issuer verifies the amount inside the signed claim against its *own*
configured price. If these disagree, **every paid request returns 402**:

| Where | Setting | Value |
|---|---|---|
| `config/connector.toml` | `price` | `10000000000000000` base units |
| `compose.yml`, claim-minter | `BUNDLE_PRICE` | `0.01` |
| `compose.yml`, issuer | `BUNDLE_PRICE` | `0.01` |

10¹⁶ base units ÷ 10¹⁸ (ANYONE decimals) = 0.01 ANYONE for a bundle of 10
credentials. **Change all three together.**

Only the base-unit figure moves with the token; the decimal the minter signs
and the issuer checks stays `0.01`. That is why `config/connector.local.toml`
carries `10000` — the same 0.01, against a 6-decimal token. Recompute it
whenever the token changes: the exponent is the token's own `decimals()`, not
a constant.

0.01 ANYONE is a placeholder. Set a price that is commercially real for you
before taking payment from anyone.

### Routes

| ILP prefix | Price | Handler | Notes |
|---|---|---|---|
| `g.anyone.credentials` | `10000` | claim minter | Bundle issuance |
| `g.anyone.credentials.keys` | `0` | issuer `/v1/keys/` | The epoch key document |

`/healthz` is deliberately not routed. The connector's free, unauthenticated
`/ilp` is the public liveness and self-description endpoint.

The keys route's handler is scoped to `/v1/keys/` **on purpose**. A request
target resolves *beneath* the handler path, so pointing a free route at the
issuer root would let anyone reach `v1/bundles` at price zero.

### Claim minter

| Variable | Meaning |
|---|---|
| `ISSUER_URL` | Where to forward. Internal network only. |
| `PROXY_PRIVATE_KEY_PATH` | Ed25519 PKCS#8 PEM. Its public half is the issuer's `PROXY_PUBLIC_KEY_PATH`. |
| `BUNDLE_PRICE` | Exact decimal. Must equal the issuer's. |
| `ROUTE_ID` | Signed into every claim; the issuer records but does not check it. |
| `PORT` | Default 8080. |

### Pointing at a different chain or token

All four must hold, or the connector refuses to start:

1. The connector's **TokenNetworkRegistry is deployed on that chain**, at the
   address in `contract_address`.
2. A **TokenNetwork is registered in that registry for that token**. The
   connector resolves it at boot; a token with no network cannot be settled in.
3. `decimals` **matches the token's own `decimals()`**. The connector reads it
   on-chain and refuses to start on a mismatch.
4. The **price is recomputed** for the new exponent (§4.1). An 18-decimal token
   makes `10000` base units dust, not 0.01.

Confirm all three on-chain facts before editing anything. `0x313ce567` is
`decimals()`; `0x9e455119` is `getTokenNetwork(address)`:

```bash
RPC=<your rpc>
TOKEN=<token>           # no 0x prefix in the padded argument below
REGISTRY=<registry>

# 1. the registry exists on this chain
curl -s -X POST $RPC -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$REGISTRY\",\"latest\"]}"

# 2. it has a token network for this token
curl -s -X POST $RPC -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$REGISTRY\",\"data\":\"0x9e455119000000000000000000000000${TOKEN:2}\"},\"latest\"]}"

# 3. the token's own decimals
curl -s -X POST $RPC -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$TOKEN\",\"data\":\"0x313ce567\"},\"latest\"]}"
```

A `0x` result from 1 means the contract is not on that chain. An all-zero
address from 2 means the token has no network and cannot be settled in.
Beware that a token can exist at the same address on several chains and be a
different contract on each — check the chain you are actually configuring.

---

## 5. Key material

`make keys` writes everything into `./data`, mode `0600`. It is idempotent:
existing keys are kept, so re-running it is safe.

| File | Held by | Purpose |
|---|---|---|
| `data/signer.key` | connector | Packet signing |
| `data/evm.key` | connector | Settlement identity — **on mainnet this holds real funds** |
| `data/operator-bearer-token` | connector | Read access to the operator surface |
| `data/operator-write-keys` | connector | Signs operator writes (fund, redeem) |
| `data/keys/proxy.key.pem` | claim minter | Signs payment claims |
| `data/keys/proxy.pub.pem` | issuer | Verifies them |
| `data/keys/current.pem` | issuer | **Epoch signing key** |
| `data/keys/current.json` | issuer | The published key document |

`make verify` replays the issuer's own boot validation against `data/keys`, so
a bad key document fails in a second rather than as a container that will not
start.

The connector's keys are staged into a volume by the `connector-keys` service
rather than bind-mounted, for two reasons: the connector runs as uid 10001 and
cannot read host files written at `0600` by another user, and the staging step
names the four files explicitly so the epoch signing key cannot reach the
connector even by accident.

**`make keys` produces development key material.** It is right for the local
chain and for a testnet, and wrong for mainnet: the epoch signing key is the
issuer's entire security story and belongs in Vault, mounted at runtime and
rotated, and the settlement key on a live chain holds real funds. Generate
those out of band and mount them in the same paths.

---

## 6. Operations

### Health

| Check | Meaning |
|---|---|
| `GET http://127.0.0.1:3000/ilp` | Config loaded, settlement connected, router serving. Free and unauthenticated. |
| `docker compose ps` | Every service should be `healthy` |

`/ilp` also reports the live route table, prices and settlement addresses — the
fastest way to confirm a config change took effect.

### The operator surface

Bound to the internal network and never published. Reads take the bearer token;
writes need an RFC 9421 signature from a key in `operator-write-keys`.

```bash
TOKEN=$(cat data/operator-bearer-token)
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3000/claims
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3000/channels
```

`/claims` shows what the node has banked. A row like
`{"channel_id":"evm:0x…","nonce":1,"cumulative_amount":10000,"book":"client"}`
is one paid request. **Claims are money the node has not yet collected**:
`POST /channels/:id/redeem-latest` converts them on-chain, and a node that
never redeems banks nothing.

### Accounting

The issuer keeps its own books, which should agree with the connector's:

```bash
docker compose exec -T postgres psql -U app -d app \
  -c 'SELECT epoch,bundles_paid,signatures_issued FROM epoch_counter;' \
  -c 'SELECT reason,count FROM claim_rejection;'
```

`claim_rejection` should stay **empty**. Any row means the minter produced a
claim the issuer would not accept — see §7.

### Schema migrations

A one-shot `migrate` service runs the image's own TypeORM migrations and exits;
the issuer waits for it to succeed, so no replica can race another to migrate.
Upgrading the issuer image runs any new migrations on the next `up`.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Issuer exits: `key document validity window must use ISO-8601 UTC instants` | Timestamps without milliseconds. The issuer requires `new Date(v).toISOString() === v`, and `toISOString()` always emits `.000Z`. | `make keys` writes this correctly. Run `make verify`. |
| Issuer exits: published pubkey mismatch | `current.json` and `current.pem` are from different keypairs | Delete both and re-run `make keys`; they are generated as a pair |
| Connector exits: `signer key_file does not exist` | Keys not staged, or `./data` unreadable by uid 10001 | Run `make keys`, then let `connector-keys` re-run (`docker compose up -d`) |
| Connector exits: `[node] http_endpoint is not set` | A carriage is exposed but the node has no public name | Set `[node].http_endpoint`, ending in `/ilp` |
| Client fails with `TRANSPORT_REQUIRED` | `peer_expose` advertises no carriage, so the client cannot pick one | Set `peer_expose = "http"`. Exposing a carriage is not peering. |
| `migrate` exits 1 with `ECONNREFUSED` on a cold volume | `pg_isready` on the local socket passes against the temporary server the postgres image runs during `initdb` | Already fixed: the healthcheck uses `-h 127.0.0.1` to force a TCP check |
| Every paid request returns **402 CLAIM_INVALID** | The three prices disagree (§4.1) | Align them, then `docker compose up -d` |
| Buyer gets 402 `PAYER_UNATTRIBUTED` | No `X-TOON-Payer` — the request was forwarded by another node rather than terminated here | This route must be terminated, not forwarded. See ADR 0002. |
| Connector refuses to start on a settlement backend | Registry or token missing on that chain, or a `decimals` mismatch | Check all four conditions in §4.3 |

---

## 8. Security model

**Network isolation is what authorises issuance.** The minter does not check how
much was paid, and must not: the connector's contract forbids the app deciding
anything about payment, and the amount header is absent whenever a node upstream
collected. Reaching the minter at all is the proof that the connector collected.

Three properties hold this up, each covered by a test in
`buyer/src/verify-routes.ts`:

- **The minter proxies exactly `POST /v1/bundles`.** The route's handler target
  is the minter's root, so without that whitelist a caller could reach any
  issuer path with a freshly minted claim attached.
- **An inbound `X-Payment-Claim` is always discarded.** The connector relays
  caller headers verbatim — it owns only its own three `X-TOON-*` names — and
  the issuer has no replay protection. A claim a caller supplies is a forgery
  attempt by construction.
- **The keys route cannot climb into the paid one.** Both `../v1/bundles` and
  `/v1/bundles` are refused `F00` before the app is touched.

**Everything is billable.** A packet pays for *an* answer, not the answer the
buyer wanted. A `400`, `409` or `429` from the issuer rides home as a successful
delivery and costs the buyer full price; only an unreachable app produces a
refusal. This is a property of the protocol, not something configuration can
fix. It is why the issuer's rate limit here is a safety net well above practical
throughput rather than its default — a paid request answered `429` is money for
nothing.

---

## 9. Layout

```
config/connector.toml         routes, pricing, settlement, operator surface
config/connector.local.toml   the same, settling on a local anvil
compose.yml                   the stack, and the trust boundary
compose.local.yml             overlay pointing settlement at the local chain
claim-minter/                 the only new service (~200 lines, no dependencies)
buyer/                        demo buyer: blind, pay, unblind, verify
buyer/src/verify-routes.ts    negative checks against a running stack
scripts/gen-keys.sh           dev key material
scripts/verify-keys.ts        replays the issuer's boot checks locally
docs/payment-claim.md         the claim interface, written down
docs/adr/                     why the minter exists; what the payment reference is
CONTEXT.md                    glossary
```

---

## 10. Notes

The claim minter runs on Node rather than Bun, which the issuer uses. The reason
is testability: Node's native TypeScript execution runs the golden-vector suite
directly, with no toolchain to install and no container to build. The code is
standard-library only — WebCrypto and `node:http` — so the choice is reversible.

`config/connector.local.toml` duplicates `config/connector.toml` because the
connector reads exactly one TOML and has no include. If you change a route or a
price, change it in both; `make local-e2e` is what catches the drift.

The issuer is GPL-3.0. This repository composes its published image; it does not
modify, link to, or redistribute it.

[issuer]: https://github.com/anyone-protocol/credentials-issuer
[connector]: https://github.com/toon-protocol/connector
