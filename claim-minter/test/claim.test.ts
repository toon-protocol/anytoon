/**
 * Golden vectors for the claim wire format.
 *
 * These pin the bytes `proxy_sig` covers. Ed25519 is deterministic, so a fixed
 * key and fixed fields have exactly one correct signature: if the key ordering
 * in `canonicalClaimPayload` ever changes, the literal below stops matching.
 * That is the entire point — upstream's verifier would otherwise reject every
 * claim we mint, and the only symptom in production is a 402 on a paid request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalClaimPayload, mintClaim } from '../src/claim.ts';
import { loadSigningKey, pemToDer } from '../src/keys.ts';

const FIELDS = {
  payment_ref: 'evm:0x1111111111111111111111111111111111111111',
  amount: '0.01',
  route_id: 'g.anyone.credentials',
} as const;

const CANONICAL =
  '{"amount":"0.01","payment_ref":"evm:0x1111111111111111111111111111111111111111","route_id":"g.anyone.credentials"}';

const GOLDEN_HEADER =
  'eyJwYXltZW50X3JlZiI6ImV2bToweDExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJhbW91bnQiOiIwLjAxIiwicm91dGVfaWQiOiJnLmFueW9uZS5jcmVkZW50aWFscyIsInByb3h5X3NpZyI6Im82LU1nWmYzUlNHSTNRdkNPZFBIbDJiYXR1LTEycVJNYTZPWVNzRi1nSTNkTFY0M1VEaVp5dmhDaHRtdHFDRXRsa2h3M3dteUFCVDZFUEtEdnhoM0NRIn0';

const keyPath = new URL('./fixtures/proxy.key.pem', import.meta.url).pathname;
const pubPath = new URL('./fixtures/proxy.pub.pem', import.meta.url).pathname;

test('canonical payload is alphabetical, unspaced JSON', () => {
  assert.equal(new TextDecoder().decode(canonicalClaimPayload(FIELDS)), CANONICAL);
});

test('field order in the input does not change the signed bytes', () => {
  const shuffled = {
    route_id: FIELDS.route_id,
    payment_ref: FIELDS.payment_ref,
    amount: FIELDS.amount,
  };
  assert.deepEqual(canonicalClaimPayload(shuffled), canonicalClaimPayload(FIELDS));
});

test('minted header matches the golden vector', async () => {
  const key = await loadSigningKey(keyPath);
  assert.equal(await mintClaim(FIELDS, key), GOLDEN_HEADER);
});

/**
 * Replays the issuer's ClaimVerifier against our output: parse base64url JSON,
 * verify proxy_sig over the canonical bytes under the SPKI public key, then
 * compare the amount to the configured bundle price.
 */
test('a minted claim satisfies the issuer verification procedure', async () => {
  const header = await mintClaim(FIELDS, await loadSigningKey(keyPath));

  const claim = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  for (const field of ['payment_ref', 'amount', 'route_id', 'proxy_sig']) {
    assert.equal(typeof claim[field], 'string', `${field} must be a string`);
    assert.ok(claim[field].length > 0, `${field} must not be empty`);
  }

  const publicKey = await crypto.subtle.importKey(
    'spki',
    pemToDer(await readFile(pubPath, 'utf8'), 'PUBLIC KEY'),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );

  const signature = new Uint8Array(Buffer.from(claim.proxy_sig, 'base64url'));
  assert.equal(signature.length, 64, 'raw Ed25519 signature is 64 bytes');

  const verified = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    signature,
    canonicalClaimPayload(claim),
  );
  assert.ok(verified, 'proxy_sig must verify under the proxy public key');
  assert.equal(claim.amount, '0.01', 'amount must equal BUNDLE_PRICE exactly');
});

test('a tampered amount no longer verifies', async () => {
  const header = await mintClaim(FIELDS, await loadSigningKey(keyPath));
  const claim = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  claim.amount = '0.02';

  const publicKey = await crypto.subtle.importKey(
    'spki',
    pemToDer(await readFile(pubPath, 'utf8'), 'PUBLIC KEY'),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    new Uint8Array(Buffer.from(claim.proxy_sig, 'base64url')),
    canonicalClaimPayload(claim),
  );
  assert.equal(verified, false, 'the amount is inside the signed payload');
});
