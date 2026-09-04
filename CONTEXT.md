# Context

The vocabulary of this repository. Two systems meet here, and each has a word
for the thing the other also has a word for, so the terms below are the ones
that win. This file is a glossary and nothing else: no configuration, no
rationale for decisions (those live in `docs/adr/`), no implementation.

## Connector

The TOON node that fronts the issuer. It collects payment per request in tokens
over ILP, opens the sealed request, makes exactly that HTTP request of the app
behind it, and seals the app's response back. It is the only ingress.

Not "proxy" (ambiguous here — see **Fronting proxy**), and not "terminator".

## App / handler

Any ordinary HTTP service behind a **connector** route. An app is
**payment-oblivious**: it receives an ordinary HTTP request, holds no key toward
the packet's fulfilment, and decides nothing about payment. Both the **claim
minter** and the **issuer** are apps in this sense.

## Claim minter

The service between the connector and the issuer. It turns the connector's
statement of *who paid* into the **payment claim** the issuer requires, and does
nothing else — it collects no money, prices nothing, and authorises nothing.

Introduced by this repository; it exists in neither upstream project.

## Fronting proxy

The issuer's term for whatever sits in front of it and collects payment. It
names a role, not a component: here that role is filled by the **connector** and
the **claim minter** together. Avoid the term except when quoting upstream.

## Issuer

`anyone-protocol/credentials-issuer`. Sells fixed-size **bundles** of blind-
signed **credentials**. Consumed here as a published image, unmodified.

## Payment claim

The issuer's proof that a request was paid for: a payment reference, an amount,
a route id, and a signature over those three made by a key the issuer trusts.
It is the interface between the fronting-proxy role and the issuer.

Distinct from a **channel claim**, which is TOON's signed, cumulative record of
what a payer owes on a payment channel. The two never meet: a channel claim pays
the connector, a payment claim admits issuance.

## Payment reference

The identity a payment claim is attributed to. It is what the issuer rate-limits
on, half of what it keys idempotent retries on, and one of the four fields it
retains per purchase. Here it is the paying channel identity.

## Bundle

Exactly `k` credentials, issued in one call, at one price. There is no partial
bundle and no variable amount.

## Blank

A blinded message a buyer submits for signing. The issuer sees only blanks and
never the unblinded serial inside one.

## Credential

An unblinded signature over a buyer's serial, valid under an **epoch** key. The
buyer holds it; the issuer cannot recognise it.

## Epoch

The period over which one issuer signing key is current. A **key document**
publishes the epoch's identity, validity window, suite and public key; every
credential is signed under exactly one epoch.

## Route

A priced destination on the connector, selected by longest matching prefix. A
route is never silently free: a free route says so explicitly.

## Payer

The channel identity the connector collected from, and the value this repository
uses as the **payment reference**.
