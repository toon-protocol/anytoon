/**
 * Buys one bundle of credentials, end to end.
 *
 *   TOON_CONNECTOR=http://127.0.0.1:3000 TOON_MNEMONIC="..." npm run buy
 *
 * The loop this proves: fetch the epoch key for free, blind k serials, pay for
 * issuance over ILP, unblind, verify. It is a demo and a smoke test, not an
 * SDK -- the interesting parts are in credentials.ts, which is unit-tested
 * without a running stack.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ToonClient } from '@toon-protocol/client';

import { blindBlanks, finalizeCredentials, importEpochKey, type KeyDocument } from './credentials.ts';

const CONNECTOR = process.env.TOON_CONNECTOR ?? 'http://127.0.0.1:3000';
const BUNDLES_ROUTE = process.env.TOON_ROUTE ?? 'g.anyone.credentials';
const KEYS_ROUTE = `${BUNDLES_ROUTE}.keys`;
const BUNDLE_SIZE = Number(process.env.BUNDLE_SIZE ?? '10');
/** Base units of collateral to open with, if there is no channel yet. */
const DEPOSIT = BigInt(process.env.TOON_DEPOSIT ?? '100000');

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const client = await ToonClient.create({
  connector: CONNECTOR,
  // A mnemonic for normal use; a raw key for a local chain, where the funded
  // accounts are anvil's own and there is no keystore to import.
  mnemonic: process.env.TOON_MNEMONIC,
  evmPrivateKey: process.env.TOON_EVM_PRIVATE_KEY,
  // Defaults to the package's devnet preset, which is not a local chain.
  rpcUrl: process.env.TOON_RPC_URL,
  // Not 'auto'. A client picks its transport from the carriages the node
  // advertises, and resolving that automatically fails outright when the node
  // exposes none -- so name the one this bundle exposes.
  transport: 'http',
  // The collateral an auto-opened channel starts with. `ensure()` takes no
  // options, so the deposit is a client-level setting, not a per-call one.
  deposit: DEPOSIT,
  autoOpenChannel: true,
  channelStore: process.env.TOON_CHANNEL_STORE ?? join(homedir(), '.toon', 'channels.json'),
});

try {
  // --- 1. The key document, free -------------------------------------------
  // A buyer needs the epoch key before it can blind anything, which is why this
  // route is priced at zero.
  console.log(`Fetching the epoch key from ${KEYS_ROUTE} ...`);
  const keys = await client.send(KEYS_ROUTE, { method: 'GET', target: 'current' });
  if (!keys.fulfilled) fail(`could not read the key document: ${keys.code} ${keys.message}`);
  if (keys.status !== 200) fail(`key document returned HTTP ${keys.status}: ${keys.text()}`);

  const doc = keys.json() as KeyDocument;
  const publicKey = await importEpochKey(doc);
  console.log(`  epoch ${doc.epoch_id}, valid until ${doc.not_after}`);

  // --- 2. Collateral --------------------------------------------------------
  // Resolves an existing channel, or opens one with the configured deposit.
  const channelId = await client.channel.ensure();
  console.log(`  channel ${channelId}`);

  // --- 3. Blind k serials ---------------------------------------------------
  console.log(`Blinding ${BUNDLE_SIZE} blanks ...`);
  const blanks = await blindBlanks(publicKey, BUNDLE_SIZE);

  // --- 4. Pay for issuance --------------------------------------------------
  // Idempotency-Key rides through the connector and the minter untouched, so a
  // retry after a timeout returns the same bundle rather than buying a second.
  console.log(`Buying a bundle from ${BUNDLES_ROUTE} ...`);
  const answer = await client.send(BUNDLES_ROUTE, {
    method: 'POST',
    target: 'v1/bundles',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      epoch: doc.epoch_id,
      blinded_blanks: blanks.map((b) => b.blinded),
    }),
  });

  if (!answer.fulfilled) {
    fail(`the packet was refused by ${answer.refusedBy}: ${answer.code} ${answer.message}`);
  }

  console.log(`  paid ${answer.claim?.amount ?? '?'} base units, issuer answered ${answer.status}`);

  // A 4xx is a real, paid answer -- it rides home on a FULFILL and costs the
  // same as a 200. Report it as what it is.
  if (answer.status !== 201) {
    fail(`issuance failed (still charged): HTTP ${answer.status} ${answer.text()}`);
  }

  // --- 5. Unblind and verify ------------------------------------------------
  const { epoch, blind_signatures } = answer.json() as {
    epoch: string;
    blind_signatures: string[];
  };
  const credentials = await finalizeCredentials(publicKey, blanks, blind_signatures);

  console.log(`\n  ${credentials.length} credentials, epoch ${epoch}, all verified.\n`);
} finally {
  await client.close();
}
