/**
 * Proves the buyer's credential math against the epoch key `make keys` actually
 * generated -- blind, sign, unblind, verify -- with no stack running. If this
 * passes, a failure end to end is payment or transport, never the crypto.
 *
 * The protocol itself is @toon-protocol/credentials, and its own tests cover it
 * against a key document they generate. What this file adds is the other half
 * of the claim: that the package, as this buyer resolves it, agrees with the
 * key material this repository's issuer will actually load.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  blindBlanks,
  finalizeCredentials,
  importEpochKey,
  suite,
} from '@toon-protocol/credentials';

const KEYS = new URL('../../data/keys/', import.meta.url).pathname;
const BUNDLE_SIZE = 10;

test('a bundle round-trips against the generated epoch key', async () => {
  const doc = JSON.parse(await readFile(`${KEYS}current.json`, 'utf8'));
  const publicKey = await importEpochKey(doc);

  // Stands in for the issuer's signer, using the same epoch key it will load.
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    new Uint8Array(
      Buffer.from(
        (await readFile(`${KEYS}current.pem`, 'utf8'))
          .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
          .replace(/\s+/g, ''),
        'base64',
      ),
    ),
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true, // blindSign needs the key params; this is the test's issuer stand-in
    ['sign'],
  );

  const blanks = await blindBlanks(publicKey, BUNDLE_SIZE);
  assert.equal(blanks.length, BUNDLE_SIZE);
  for (const blank of blanks) {
    assert.equal(
      Buffer.from(blank.blinded, 'base64').length,
      256,
      'a blinded blank must decode to BLANK_SIZE_BYTES',
    );
  }

  const blindSignatures: string[] = [];
  for (const blank of blanks) {
    const sig = await suite.blindSign(
      privateKey,
      new Uint8Array(Buffer.from(blank.blinded, 'base64')),
    );
    blindSignatures.push(Buffer.from(sig).toString('base64'));
  }

  const credentials = await finalizeCredentials(publicKey, blanks, blindSignatures);
  assert.equal(credentials.length, BUNDLE_SIZE);

  // Both halves, and both usable on their own afterwards: a relay verifies
  // `signature` against `prepared`, having never seen the blank or the serial.
  for (const credential of credentials) {
    assert.equal(credential.signature.length, 256);
    assert.ok(await suite.verify(publicKey, credential.signature, credential.prepared));
  }
});

test('a garbage signature is rejected, not counted', async () => {
  const doc = JSON.parse(await readFile(`${KEYS}current.json`, 'utf8'));
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 1);

  await assert.rejects(
    () => finalizeCredentials(publicKey, blanks, [Buffer.alloc(256).toString('base64')]),
    'k blobs of the right size must not pass as k credentials',
  );
});

test('a short bundle is rejected', async () => {
  const doc = JSON.parse(await readFile(`${KEYS}current.json`, 'utf8'));
  const publicKey = await importEpochKey(doc);
  const blanks = await blindBlanks(publicKey, 2);
  await assert.rejects(() => finalizeCredentials(publicKey, blanks, []));
});
