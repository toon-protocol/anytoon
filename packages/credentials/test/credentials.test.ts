/**
 * The protocol, proved against a key document this test generates itself.
 *
 * A published package cannot reach for `make keys` output, so the issuer's
 * signer is stood in for here by a freshly generated RSA-PSS key and a key
 * document built around it. What is being proved is the buyer's half: blind,
 * sign, unblind, verify -- and that what survives to disk still verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUITE_NAME,
  blindBlanks,
  finalizeCredentials,
  importEpochKey,
  suite,
  type Blank,
  type KeyDocument,
} from '../src/index.ts';

const BUNDLE_SIZE = 10;
const DAY = 86_400_000;

/** An epoch, as the issuer would publish it, plus the signer behind it. */
async function makeEpoch(
  window: { not_before: number; not_after: number } = {
    not_before: Date.now() - DAY,
    not_after: Date.now() + DAY,
  },
): Promise<{ doc: KeyDocument; privateKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-384',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    doc: {
      epoch_id: '0',
      not_before: new Date(window.not_before).toISOString(),
      not_after: new Date(window.not_after).toISOString(),
      alg: SUITE_NAME,
      pubkey: Buffer.from(spki).toString('base64'),
    },
    privateKey: pair.privateKey,
  };
}

/** The issuer's side: sign blanks, positionally, seeing only the blinded form. */
async function blindSign(privateKey: CryptoKey, blanks: readonly Blank[]): Promise<string[]> {
  const signatures: string[] = [];
  for (const blank of blanks) {
    const sig = await suite.blindSign(
      privateKey,
      new Uint8Array(Buffer.from(blank.blinded, 'base64')),
    );
    signatures.push(Buffer.from(sig).toString('base64'));
  }
  return signatures;
}

test('a bundle round-trips, and every credential carries both halves', async () => {
  const { doc, privateKey } = await makeEpoch();
  const publicKey = await importEpochKey(doc);

  const blanks = await blindBlanks(publicKey, BUNDLE_SIZE);
  assert.equal(blanks.length, BUNDLE_SIZE);
  for (const blank of blanks) {
    assert.equal(
      Buffer.from(blank.blinded, 'base64').length,
      256,
      'a blinded blank must decode to BLANK_SIZE_BYTES',
    );
  }

  const credentials = await finalizeCredentials(
    publicKey,
    blanks,
    await blindSign(privateKey, blanks),
  );
  assert.equal(credentials.length, BUNDLE_SIZE);
  for (const credential of credentials) {
    assert.equal(credential.signature.length, 256);
    // `prepared` is the randomizer-prefixed serial: 32 random bytes of
    // randomizer in front of the 32-byte serial under the Randomized variant.
    assert.equal(credential.prepared.length, 64);
  }
});

test('credentials come back in the order their blanks went out', async () => {
  const { doc, privateKey } = await makeEpoch();
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 3);

  const credentials = await finalizeCredentials(
    publicKey,
    blanks,
    await blindSign(privateKey, blanks),
  );
  for (const [i, credential] of credentials.entries()) {
    assert.deepEqual(
      credential.prepared,
      blanks[i]!.prepared,
      'credential i must belong to blank i -- the issuer signs positionally',
    );
  }
});

test('a credential survives base64 and JSON and still verifies on its own', async () => {
  // This is what a holder actually does: persist the pair, reload it later, and
  // present it to a relay, which has nothing but the epoch key and what it was
  // given. `prepared` is not recoverable from the signature, so a holder that
  // stored only the signature would fail here.
  const { doc, privateKey } = await makeEpoch();
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 1);
  const [credential] = await finalizeCredentials(
    publicKey,
    blanks,
    await blindSign(privateKey, blanks),
  );

  const persisted = JSON.stringify({
    prepared: Buffer.from(credential!.prepared).toString('base64'),
    signature: Buffer.from(credential!.signature).toString('base64'),
  });

  const reloaded = JSON.parse(persisted) as { prepared: string; signature: string };
  const relayKey = await importEpochKey(doc); // the relay has only the key document
  assert.ok(
    await suite.verify(
      relayKey,
      new Uint8Array(Buffer.from(reloaded.signature, 'base64')),
      new Uint8Array(Buffer.from(reloaded.prepared, 'base64')),
    ),
    'a persisted (prepared, signature) pair must verify under the epoch key alone',
  );
});

test('a garbage signature is rejected, not counted', async () => {
  const { doc } = await makeEpoch();
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 1);

  await assert.rejects(
    () => finalizeCredentials(publicKey, blanks, [Buffer.alloc(256).toString('base64')]),
    'k blobs of the right size must not pass as k credentials',
  );
});

test('a short bundle is rejected', async () => {
  const { doc } = await makeEpoch();
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 2);
  await assert.rejects(() => finalizeCredentials(publicKey, blanks, []));
});

test('an expired epoch is refused before anything is blinded', async () => {
  const { doc } = await makeEpoch({ not_before: Date.now() - 2 * DAY, not_after: Date.now() - DAY });
  await assert.rejects(
    () => importEpochKey(doc),
    /epoch 0 is not currently valid/,
    'blinding under a dead epoch buys signatures nothing will accept',
  );
});

test('an epoch that has not started is refused too', async () => {
  const { doc } = await makeEpoch({ not_before: Date.now() + DAY, not_after: Date.now() + 2 * DAY });
  await assert.rejects(() => importEpochKey(doc), /epoch 0 is not currently valid/);
});

test('a key document naming another suite is refused', async () => {
  const { doc } = await makeEpoch();
  await assert.rejects(
    () => importEpochKey({ ...doc, alg: 'RSABSSA-SHA384-PSS-Deterministic' }),
    /expected RSABSSA-SHA384-PSS-Randomized/,
  );
});
