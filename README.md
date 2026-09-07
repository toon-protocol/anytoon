# anytoon

Operator guide for running the [Anyone Protocol credentials issuer][issuer]
behind the [TOON connector][connector].

A buyer pays in tokens over ILP and receives blind-signed credentials. The
issuer runs as its published image, unmodified.

**This node is reached at a `.anyone` hidden-service address.** It publishes no
clearnet endpoint and no public port; the circuit is the only way in.

```
buyer ──sealed ILP packet──▶ .anyone ──▶ connector ──▶ claim minter ──▶ issuer ──▶ Postgres
                             circuit     collects      vouches for      signs      Redis
                             the only    payment       the payment      blindly
                             way in
```

A hidden-service endpoint hides **where this node is reachable**, and nothing
else — §8 says what that does and does not buy, in the one place it matters
most here.

Requires `@toon-protocol/client` **3.0.0 or newer** and a connector image at
**`rust-sha-97f45a0`** or newer. Those two are a matched pair; §4 says why.

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

**The local path runs no daemon and needs no circuit.** It settles on anvil and
the buyer reaches the connector on loopback, so there is nothing for a hidden
service to do — and a gate that waits on a third-party anonymity network
bootstrapping is a gate that goes red when that network has a bad day. The
connector repository keeps its own hidden-service rehearsals off CI on the same
argument.

To exercise the **ingress** without spending anything:

```bash
make hs-e2e
```

Same stack, same anvil, but the connector publishes no port and is reached only
at its `.anyone` address, by the real toon client, over a circuit. That is the
rehearsal for `make up`; run it deliberately, not on every change.

The chain comes from the connector repository, which deploys the settlement
contracts at deterministic addresses on start; `make chain-up` clones it into
`.local-chain/` the first time. The buyer uses anvil's second test account,
which that deploy pre-funds with mock USDC.

### Commands

| Command | What it does |
|---|---|
| `make local-e2e` | The whole loop on a local chain. Start here. |
| `make local-up` / `make local-down` | Start / stop anvil and the stack against it |
| `make hs-e2e` / `make hs-down` | The same on a local chain, reached **only** over a circuit |
| `make up` / `make down` | Start / stop the stack on mainnet, behind a hidden service |
| `make hs-address` | Print this node's address and re-render the config |
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
make up                         # daemon, then its address, then the stack
```

**Use `make up`, not a bare `docker compose up -d`.** Three things have to
happen in order and cannot be collapsed into one, because the second does not
exist until the first has run:

1. `docker compose up -d anon` — the daemon starts and **generates this node's
   `.anyone` address** into its `HiddenServiceDir`. On a cold volume this takes a
   minute or two; the healthcheck gates on `Bootstrapped 100%`, because a
   container that is `Up` is not a container that has a circuit.
2. `scripts/hs-address.sh` — reads that address and renders
   `config/connector.toml` into `config/.rendered/connector.toml`, **which is
   what compose mounts.** The committed file holds a placeholder.
3. `docker compose up -d --build` — the rest of the stack.

Step 2 is a script and not a connector feature on purpose. The connector never
reads the daemon's `hostname` file and never speaks its control protocol
(connector [ADR 0070] decision 7): both would couple a node's own
self-description to a sidecar's filesystem layout, for a value that never
changes once generated. The script is only doing by hand what the operator
runbook tells an operator to do by hand.

Tell buyers the address `make up` prints. They reach this node at
`http://<address>.anyone`, and they need a SOCKS5 proxy of their own to dial
it — see §4, *Reaching this node*.

### Gates, in order

Do not reorder these, and do not tell anyone the address until (b) passes.

- **(a) The daemon has a circuit.** `Bootstrapped 100%` in `make logs`, and
  `make hs-address` prints 56 characters of `[a-z2-7]` then `.anyone`. A
  `.onion` address means the daemon is the **old** release — see §4.
- **(b) The address survives a restart.** `docker compose restart anon`, then
  `make hs-address` again: it must print **the same address**. If it does
  not, the `anon-data` volume is not doing its job — stop, fix it, and tell no
  buyer the address you read before now. See §5.
- **(c) A bundle actually issues.** `make buy` over loopback proves the stack;
  point `TOON_CONNECTOR` at the `.anyone` address (with `TOON_SOCKS_PROXY`) and
  run it again to prove the ingress. `make hs-e2e` is that check, on a chain
  that costs nothing.
- **(d) The dial took the circuit.** A dial that silently fell back to a direct
  connection would succeed identically, so the honest check is the negative
  one: this node publishes no clearnet endpoint and no public port, so there is
  nothing else a buyer could have reached. **If you put a reverse proxy in front
  of it, this gate proves nothing** and you are running a clearnet node that
  also has a hidden-service address.

Then fund the connector's settlement key. `make keys` writes it to
`data/evm.key`; its address appears in the `settlements` block of
`http://127.0.0.1:3000/ilp` once the connector is up. It needs:

- **native gas** on the settlement chain, to fund channels and redeem claims
- **the settlement token**, only if this node will also *pay* others

A node that only receives needs gas alone. It banks claims off-chain and
converts them with `redeem-latest` (§6).

Replace the public RPC in `config/connector.toml` with your own node. The
default is shared and rate limited: fine for a trial, wrong for production —
**and on a hidden-service node it is also the leak described in §8.**

Nothing is published off the host. `127.0.0.1:3000` is the operator's own
console — `make buy`, `make verify-routes` and the curls in §6 — and the claim
minter, the issuer and their datastores have no published ports and no route
off the host at all.

**There is no TLS to terminate and no certificate to obtain.** That is not a
gap: the address *is* the ed25519 public key the circuit is
authenticated to, so a buyer that reached `<address>.anyone` reached the holder
of that key or reached nothing. The connector's usual TLS-only endpoint rule is
satisfied by a different mechanism rather than waived, which is why the
exemption keys on the hidden-service suffix and on nothing else, and why
`peer_allow_plaintext_endpoints` is **not** set anywhere here.

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

### Reaching this node

`[node].http_endpoint` is this node's public name, and it is a `.anyone` URL. It
is **not** a new config key: a hidden-service address is a legal value for the
endpoint that section already had, because the address is a **host** — not a
scheme, not a carriage and not a transport. `peer_expose` is unchanged, the route table is
unchanged, and the client edge behind a circuit is the same client edge.

The committed `config/connector.toml` carries a placeholder host. The rendered
`config/.rendered/connector.toml` carries the real one and is gitignored;
`make hs-address` regenerates it.

**There is no `socks_proxy` here, and that is a decision rather than an
omission.** That key selects a SOCKS5 proxy for *outbound* dials whose host
is a hidden service. This node has no `[[peers]]` and no `[[pay_channels]]` — it
terminates its own routes and always collects — so it dials nothing over ILP
and the key would select nothing. Adding a peer is the change that forces this
to be revisited, alongside [ADR 0002].

**A buyer needs a proxy; this node does not.** The buyer in `buyer/` takes one
as an env var:

```bash
TOON_SOCKS_PROXY=socks5h://127.0.0.1:9050 \
TOON_CONNECTOR=http://<56-char-address>.anyone \
  npm run buy
```

`socks5h://`, not `socks5://`, and the buyer refuses the latter by name. The
`h` is what makes the **proxy** resolve the name: no local resolver resolves a
a `.anyone` name, so a `socks5://` proxy would resolve locally, fail, and give
you a reason nothing in the output explains.

The client sends the buyer's **chain RPC through the same proxy by default**
(`proxyRpc`, its ADR 0002), and leaving that on is the point: reading chain
state on the clearnet would broadcast the buyer's settlement address either side
of every paid request. `TOON_PROXY_RPC=false` turns it off, and is right only
when the RPC is already private — your own node on loopback, which is why
`make hs-e2e` sets it against anvil.

Note this is the buyer's decision about the buyer. It is not the same question
as §8's, which is about **this node's** settlement RPC and is not covered by any
proxy.

### The TLD is `.anyone`, and `.onion` is a different network

Anyone Protocol renamed the hidden-service TLD, and the rename is total in both
directions:

| | `anon` v0.4.9.7 | `anon` v0.4.10.2 |
|---|---|---|
| Hidden-service TLD | `.onion` | `.anyone` |
| The other spelling, in the binary | `.anyone` absent | `.onion` — **0 occurrences** |

v0.4.10.2 writes `<56-base32>.anyone`, routes it, and **refuses the same address
spelled `.onion`**. The toon client accepts `.anyone` alone and rejects `.onion`
by name, because that is Tor and this is not.

ghcr publishes **no image** for v0.4.10.2 — its tags stop at v0.4.9.7, from
October 2024 — so `anon-image/Dockerfile` overlays the official release binary,
sha256-verified, onto that image. Do not "simplify" it back to the ghcr tag: a
daemon at the older pin publishes an address every buyer refuses.

### Two version pins that are a matched pair

| | Minimum | Why |
|---|---|---|
| Connector image | `rust-sha-97f45a0` | `fe996af` removed the execution condition from the wire; `97f45a0` made `is_onion_endpoint` match `.anyone`. Without the first, no 3.x client can talk to it; without the second, a `.anyone` endpoint needs `peer_allow_plaintext_endpoints`, which must never be set here. |
| `@toon-protocol/client` | `3.0.0` | It vendored that wire change and gained `socksProxy`. A 2.x client against this image is refused `invalid packet type byte`, which reads like a transport fault and is not one. |

Older pairings fail at the **first packet**, on the free keys route, before
anything is paid for.

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
4. The **price is recomputed** for the new exponent (§4, *The price is coupled across three places*). An 18-decimal token
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
| `anon-data` volume | anon daemon | **This node's `.anyone` address, and the key behind it** |

### The hidden-service key is operational state, like `state_dir`

The daemon generates this node's address on first start and keeps the private
key beside it, inside the `anon-data` volume. `make keys` does not produce it,
nothing here can regenerate it, and it is never committed — a fixed key
in a repository is an address anyone who cloned it can impersonate.

**If that volume is lost, the address changes and nothing tells your buyers.**
Their URL still parses, still selects a carriage, still loads — and resolves to
nothing. That is `state_dir`'s failure mode one indirection out, so keep the
two in the same place in your head:

| Volume | Whose | Lost, you lose | How it fails |
|---|---|---|---|
| `connector-state` | the connector's | every channel's replay watermark | a restarted node accepts a nonce it already spent — free service, silently |
| `anon-data` | the daemon's | the address, and every buyer's configuration | every buyer dials an address that is gone — silently, on their side |

`make down` and `make clean` keep both: only `docker compose down -v` discards
them. `make hs-address` after a restart is the cheap check that the address
survived — it warns loudly when the address it reads differs from the one it
last rendered. Back the volume up if losing the address would cost more than
telling every buyer a new one.

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
| `make hs-address` | The daemon has published an address, and it is the same one as before |

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
| Every paid request returns **402 CLAIM_INVALID** | The three prices disagree (§4, *The price is coupled across three places*) | Align them, then `docker compose up -d` |
| Buyer gets 402 `PAYER_UNATTRIBUTED` | No `X-TOON-Payer` — the request was forwarded by another node rather than terminated here | This route must be terminated, not forwarded. See ADR 0002. |
| Connector refuses to start on a settlement backend | Registry or token missing on that chain, or a `decimals` mismatch | Check all four conditions in §4, *Pointing at a different chain or token* |
| `anon` exits at once: `User has not agreed to the terms and conditions` | The daemon refuses to run until terms are accepted, and fails fast rather than prompting in a container | `AgreeToTerms 1` is in `config/anonrc`. If you replaced that file, put it back. |
| `anon` exits at once, with no message about terms | The image's entrypoint appends a `Nickname` when it finds none, and `anonrc` is mounted read-only — so `set -o errexit` kills it | Keep the explicit `Nickname` line in `config/anonrc`. It is load-bearing. |
| `make up` waits ten minutes and gives up on the daemon | It is `Up` but has no circuit. A container that is running is not a container that has bootstrapped. | `make logs` and look for `Bootstrapped 100%`. A cold volume is slow; a blocked network never finishes. |
| Connector exits: cannot read its config, or reads a directory | `config/.rendered/connector.toml` does not exist, so the bind mount created a directory in its place | Run `make up`, which renders it. Never `docker compose up -d` on a cold checkout. |
| `make hs-address` warns **the address has changed** | `anon-data` is not persisting `HiddenServiceDir` | Every buyer's config is now stale. Fix the volume before telling anyone the new address — see §5. |
| Buyer fails to resolve a `.anyone` host | No SOCKS proxy: nothing local resolves one | Set `TOON_SOCKS_PROXY=socks5h://127.0.0.1:19050` (§4) |
| Buyer refuses the address, naming `.onion` | The daemon is `anon` v0.4.9.7, from before the TLD rename | Build `anon-image/` (v0.4.10.2). The ghcr tag is the old one — §4 |
| Every packet is refused **`invalid packet type byte`** | Client and connector are on opposite sides of the wire change. Reproduces with no circuit at all, over plain loopback. | Client ≥ 3.0.0 **and** image ≥ `rust-sha-97f45a0`. They are a matched pair — §4 |
| `anon` exits with `Unparseable address in hidden service port` / `free(): invalid size` | `HiddenServicePort` names a container that does not exist yet. `anon` resolves that target when it **parses** its config. | It must be a fixed IP, and `compose.yml` pins the connector to it. Do not put `connector` there. |
| `Bind for 127.0.0.1:8545 failed: port is already allocated` | Another local stack holds it | Already handled: the chain is published on **18545** (`config/chain-ports.yml`) |
| `Bind for 127.0.0.1:19050 failed: port is already allocated` | Another `anon`/Tor daemon holds the buyer proxy's port | `make hs-e2e ANON_SOCKS_PORT=<free port>` |
| Buyer exits `ChannelResumeError … watermark is missing from the channel store` | The nonce store was deleted while its channel is still open on chain. It is **two files** — the store and a `.peers.json` sibling holding the binding — and removing only one leaves exactly this state. | `make hs-down` / `make local-down` remove both, and the chain with them. Never delete one by hand. |
| Buyer gets `F01 … names a channel this connector has no record of` | A channel store outliving the chain it was opened on — the mirror image of the row above | Same fix. Each rehearsal now keeps its own store rather than sharing `~/.toon`. |
| Buyer refuses `TOON_SOCKS_PROXY` by name | It is `socks5://`, which resolves the name **locally** | Use `socks5h://`. The `h` makes the proxy resolve it, which is the only thing that can. |

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

**A hidden-service endpoint hides where this node is reachable, and nothing else.**
Make no claim beyond that sentence to anyone deciding whether to buy here. Every
claim names an on-chain channel and address, and every operator write is
RFC 9421-signed under a keyid: **who paid whom is on a public chain either way.**

And one specific leak follows, which matters more here than in most places
because this node settles real ANYONE on L1:

- The **settlement RPC is not proxied**, by design ([ADR 0070] decision 4).
  Routing settlement through a circuit interacts with confirmation semantics and
  nonce handling, and is a separate decision with its own evidence to gather.
- So this node reaches its RPC provider **from its real address**, and that same
  provider sees **the transactions it submits** — including `redeem-latest`,
  which banks this node's earnings.
- An observer positioned there can link the operator's network location to their
  on-chain identity. Running the ILP wire over a circuit does not prevent it.

The default `config/connector.toml` points at a **shared public RPC**, which is
the worst case for this: a third party with no relationship to you, holding both
halves. Running your own node closes it, and is the only lever here that does.
`handler_url` is unproxied too, but reaches only the claim minter on an internal
network, so it leaves nothing.

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
config/connector.toml         routes, pricing, settlement, operator surface --
                              a TEMPLATE: its .anyone host is a placeholder
config/.rendered/             the same with the real address, generated, ignored
config/connector.local.toml   the same, on a local anvil, reached on loopback
config/connector.local-hs.toml the same, on anvil, reached ONLY over a circuit
config/anonrc-client          the buyer's SOCKS proxy, for make hs-e2e
config/chain-ports.yml        publishes the local chain on 18545, not 8545
anon-image/                   anon v0.4.10.2 -- ghcr publishes no image for it
config/anonrc                 the daemon that holds this node's address
compose.yml                   the stack, the trust boundary, and the ingress
compose.local.yml             overlay: local chain, loopback, no daemon
compose.local-hs.yml          overlay: local chain, reached only over a circuit
claim-minter/                 the only new service (~200 lines, no dependencies)
buyer/                        demo buyer: blind, pay, unblind, verify
buyer/src/hidden-service.ts   deciding when a SOCKS5 proxy is needed, and why
buyer/src/verify-routes.ts    negative checks against a running stack
scripts/gen-keys.sh           dev key material
scripts/hs-address.sh      reads the daemon's address, renders the config
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
price, change it in both; `make local-e2e` is what catches the drift. The local
file is *not* rendered and names no hidden-service host — it is mounted
directly, which is what keeps the local loop free of a daemon.
`config/connector.local-hs.toml` is the third copy, and it exists because the
ingress has to be rehearsed on a chain that costs nothing.

Each rehearsal keeps **its own channel store** — `.hs-channels.json` and
`.local-channels.json` — rather than the client's default `~/.toon`. A shared
store holds a nonce watermark for whatever chain the developer last used, and
carrying that into a fresh anvil fails as `F01 … names a channel this connector
has no record of`, which reads like a connector fault and is not one. Each store
is really two files: the watermark, and a `.peers.json` sibling holding the
channel binding. They are created together, removed together by `make hs-down`
and `make local-down`, and must never be deleted one at a time.

The buyer gained no dependency for the hidden service. `@toon-protocol/client`
3.0.0 takes a `socksProxy` and dials the address itself, so
`buyer/src/hidden-service.ts` only decides **when** to pass one — and refuses
the near-misses (`.onion`, `.anon`, a proxy set against a clearnet connector)
with a message that says what went wrong, rather than letting them surface much
later as an opaque SOCKS "host unreachable".

The issuer is GPL-3.0. This repository composes its published image; it does not
modify, link to, or redistribute it.

[issuer]: https://github.com/anyone-protocol/credentials-issuer
[connector]: https://github.com/toon-protocol/connector
[ADR 0070]: https://github.com/toon-protocol/connector/blob/main/docs/adr/0070-an-onion-address-is-a-host-not-a-carriage.md
[ADR 0002]: docs/adr/0002-payment-reference-is-the-paying-channel-identity.md
