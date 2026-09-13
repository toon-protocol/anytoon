# 3. The bundle price stays a placeholder

Date: 2026-09-11

## Status

Accepted

## Context

The price of a bundle is 0.01 ANYONE, and the README has always said that is a
placeholder. The default configuration now settles real ANYONE on Ethereum
mainnet, so the placeholder is one `make up` away from being a real price
charged to a real buyer. Either it becomes a number this node would actually
charge, or it stays and the reason is written down. This record is the second.

Four things bear on the number. None of them was written down beside it.

### The gas floor is a cadence question, not a per-sale one

Redemption costs L1 gas, but not per request. A channel claim is cumulative:
packets bank off-chain and `POST /channels/:id/redeem-latest` converts the
running total in one transaction. So the floor is not "more than one
redemption's gas". It is

    price  ≥  C / N

where `C` is the gas cost of one redemption expressed in the settlement token
and `N` is the number of bundles bought since that channel was last redeemed.
Rearranged for the price we already have, at 0.01 ANYONE a bundle:

    N  ≥  C / 0.01  =  100 × C          (C in ANYONE)

Every 1 ANYONE of gas needs 100 bundles to break even, and ten times that for
gas to stay under a tenth of revenue.

| `C` per redemption | Break-even `N` | `N` at gas ≤ 10% of revenue |
|---|---|---|
| 1 ANYONE | 100 | 1,000 |
| 10 ANYONE | 1,000 | 10,000 |
| 30 ANYONE | 3,000 | 30,000 |
| 100 ANYONE | 10,000 | 100,000 |

To place `C` on that table, one worked conversion — every figure in it is an
assumption, and the point of writing it this way is that an operator can
substitute their own:

    100,000 gas × 10 gwei            =  0.001 ETH
    0.001 ETH at 3,000 USD/ETH       =  3.00 USD
    3.00 USD at 0.10 USD/ANYONE      =  30 ANYONE  =  C
    break-even N                     =  30 / 0.01  =  3,000 bundles

Two properties make `N` harder to reach than a sales figure suggests.

**Redemption is per channel.** `redeem-latest` takes a channel id. Gas
amortises across one payer's purchases, not across the node's turnover. A
hundred buyers of one bundle each is a hundred redemptions, and the
amortisation never happens. The cadence that matters is depth per payer.

**`N` is bounded above by the channel deposit.** A payer can bank only as much
as it funded, so cadence cannot be lengthened indefinitely to chase the floor —
past a point the answer is a deeper channel, which is the buyer's cost, not
this node's.

The honest reading is that 0.01 ANYONE clears no plausible `C` at any cadence a
single buyer would reach, and that an operator who redeems per sale loses money
on every sale. It is not that 0.01 is the wrong number; it is that the floor is
unknown until an operator knows the gas they pay and the ANYONE price they
redeem at, and both are theirs, not ours.

### A `u64` packet ceiling sets the hard maximum

Amounts are `u64` on the wire, so a single packet on an 18-decimal leg caps at
`u64::MAX / 10^18` — `18446744073709551615 / 10^18` = **18.446744073709551615
ANYONE** (connector ADR 0071). A bundle priced above that cannot be paid in one
packet at all, and a bundle is indivisible, so there is no second packet to
carry the remainder.

0.01 sits 1,844× under the ceiling. That is headroom rather than a constraint
today, which is exactly why it is worth recording before someone proposes a
bundle ten thousand times this size. Note the ceiling is a property of the
leg's decimals and not of value: the same `u64` against a 6-decimal token caps
at about 18.4 trillion USDC, which is why this is an ANYONE-on-L1 fact
specifically.

### A buyer does not see this price

Through a hub that crosses a denomination boundary, a buyer is quoted the
**hub's** price: this node's price, converted, plus the hub's fee and its
spread. The TOON sandbox quotes 11000 µUSDC against a 0.04 ANYONE bundle,
set generously on purpose.

Two things follow. The posted price has to be commercially real on its own
terms, because it is an input to what a buyer pays rather than the number a
buyer compares against anything. And nobody should calibrate it by reading a
hub's quote back: that number carries someone else's margin and someone else's
exchange rate, and calibrating against it imports both.

This node has no peers (ADR 0002), so every buyer that reaches it today reaches
it directly and is quoted exactly the price configured here. The hub case is
what the first peer introduces — the same change ADR 0002 already flags.

### Price and `k` are one decision

A bundle is exactly `k` credentials, indivisible: no partial bundle, no
variable amount. So the smallest purchase anyone can make is `k` credentials at
the bundle price. That sets the granularity of everything downstream — how deep
a buyer must fund a channel before it can buy at all, how much it over-buys
when it needs one credential, and what each credential costs, which is
`price / k`. Changing `k` changes the per-credential price without touching any
of the three price settings. The two cannot be decided separately.

`k` is **10** here, and this repository pins it in exactly one place:
`BUNDLE_SIZE` in `buyer/src/buy.ts`, defaulting to 10 and overridable from the
environment. It is a buyer-side convention. Neither the connector's route table
nor the issuer's environment names a bundle size, so nothing under this
repository's control makes the issuer refuse a request carrying a different
number of blanks at the same price; whatever cap exists is a property of the
upstream image. "0.01 ANYONE for 10 credentials" is therefore the price of this
buyer's bundle, not an invariant of the interface, and that bounds how much the
price can be said to mean.

## Decision

**The price stays 0.01 ANYONE, and `k` stays 10. Nothing moves.**

The reason is not that 0.01 is defensible. It is that no commercial input
exists here that would justify any other number, and a different figure chosen
without one would be the same placeholder wearing a larger number — worse than
this one, because it would look decided.

Setting a real price requires four things this repository does not have and
cannot invent:

1. the measured gas of a `redeem-latest` on the chain this node settles on,
2. the ANYONE price at which the operator will actually convert earnings,
3. the redemption cadence the operator will actually keep, per payer, which is
   the `N` above,
4. what a credential is worth to whoever buys one — the only one of the four
   that is a commercial judgement rather than a measurement, and the one that
   decides whether there is a business at all.

An operator who has those can compute the floor from the relation above in a
minute. Nobody who has them is reading this file to find out what to charge.

What this record replaces is the re-derivation: the next reader does not have
to rediscover that the floor is a cadence, that the ceiling is 18.4 ANYONE,
that a hub's quote is not a calibration, or that `k` travels with the price.

## Consequences

The placeholder stays visible as a placeholder. README section 4 points here
rather than only warning, so the warning now carries the argument behind it.

**The three-places coupling is unchanged, and a disagreement returns 402 on
every paid request.** The issuer verifies the amount inside the signed claim
against its own configured price, so all three must agree exactly:

| Where | Setting | Value |
|---|---|---|
| `config/connector.toml` | `price` | `10000000000000000` base units |
| `compose.yml`, claim-minter | `BUNDLE_PRICE` | `0.01` |
| `compose.yml`, issuer | `BUNDLE_PRICE` | `0.01` |

Only the base-unit figure moves with the token; the decimal the minter signs
and the issuer checks stays `0.01`. That is why `config/connector.local.toml`
carries `10000` — the same 0.01 against a 6-decimal token — and why the
exponent to recompute with is the token's own `decimals()`, not a constant.
`make local-e2e` is what catches the drift.

Anyone who does change the price changes all three together, and should record
the redemption cadence it assumes beside it, because that is the input that
makes the number more than a guess.

### What reopens this

Any one of these, and the placeholder stops standing:

- **This node takes payment from someone other than its operator.** That is the
  plain trigger, and the one the README names.
- **A measured `C` exists.** Once the gas of a real `redeem-latest` and a real
  ANYONE conversion price are known, the floor is arithmetic. Standing on 0.01
  then requires the arithmetic to clear, not a rationale.
- **`k` changes.** Per-credential price moves with it even when no price
  setting is touched.
- **A peer is added.** From then on buyers are quoted by hubs, this price stops
  being what a buyer pays, and ADR 0002 is being revisited anyway.
- **The settlement token or chain changes.** Base units must be recomputed from
  the new `decimals()`, and `C` on an L2 is smaller by orders of magnitude —
  which is the single change most likely to make a small price clear its floor
  comfortably.
- **A large bundle is proposed.** At roughly 18.4 ANYONE the `u64` ceiling
  stops being headroom and starts being a wall, with no partial payment to fall
  back on.
