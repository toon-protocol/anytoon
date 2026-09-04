/**
 * Replays the issuer's boot-time validation against ./data/keys, so a bad key
 * document fails here in a second rather than as a container that will not
 * start. Every check below mirrors one the issuer performs on itself.
 *
 *   node scripts/verify-keys.ts
 */
import { readFile } from 'node:fs/promises';
import { createPublicKey, createPrivateKey } from 'node:crypto';

const KEYS = new URL('../data/keys/', import.meta.url).pathname;
const SUITE = 'RSABSSA-SHA384-PSS-Randomized';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail && !ok ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

/** The issuer requires strict base64: no line breaks, no URL alphabet. */
function isStrictBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
  );
}

/**
 * Copied from the issuer, not approximated. A regex that merely looks
 * ISO-shaped accepts "…:03Z", which the issuer rejects: toISOString always
 * emits milliseconds, so only "…:03.000Z" survives the round trip.
 */
function isIsoInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

console.log('Verifying ./data/keys against the issuer\'s boot checks\n');

// --- The published key document -------------------------------------------
const doc = JSON.parse(await readFile(`${KEYS}current.json`, 'utf8'));

for (const field of ['epoch_id', 'not_before', 'not_after', 'alg', 'pubkey']) {
  check(typeof doc[field] === 'string' && doc[field].length > 0, `current.json has ${field}`);
}
check(doc.alg === SUITE, 'alg is the blind-signature suite', `got ${doc.alg}`);
check(isIsoInstant(doc.not_before), 'not_before round-trips through toISOString', doc.not_before);
check(isIsoInstant(doc.not_after), 'not_after round-trips through toISOString', doc.not_after);
check(Date.parse(doc.not_before) < Date.parse(doc.not_after), 'not_before precedes not_after');
check(isStrictBase64(doc.pubkey), 'pubkey is strict base64');

// The issuer refuses to boot if the published key is not the one it signs with.
const privatePem = await readFile(`${KEYS}current.pem`, 'utf8');
const derived = createPublicKey(createPrivateKey(privatePem))
  .export({ type: 'spki', format: 'der' })
  .toString('base64');
check(derived === doc.pubkey, 'published pubkey matches current.pem');

const modulusBits = (createPrivateKey(privatePem).asymmetricKeyDetails?.modulusLength ?? 0);
check(modulusBits === 2048, '256-byte blanks require an RSA-2048 epoch key', `${modulusBits} bits`);

// --- The proxy pair --------------------------------------------------------
// A round trip proves the minter's key and the issuer's key are the same pair.
const { loadSigningKey, pemToDer } = await import('../claim-minter/src/keys.ts');
const { canonicalClaimPayload, mintClaim } = await import('../claim-minter/src/claim.ts');

const signingKey = await loadSigningKey(`${KEYS}proxy.key.pem`);
const verifyKey = await crypto.subtle.importKey(
  'spki',
  pemToDer(await readFile(`${KEYS}proxy.pub.pem`, 'utf8'), 'PUBLIC KEY'),
  { name: 'Ed25519' },
  false,
  ['verify'],
);

const fields = { payment_ref: 'verify', amount: '0.01', route_id: 'g.anyone.credentials' };
const claim = JSON.parse(
  Buffer.from(await mintClaim(fields, signingKey), 'base64url').toString('utf8'),
);
check(
  await crypto.subtle.verify(
    { name: 'Ed25519' },
    verifyKey,
    new Uint8Array(Buffer.from(claim.proxy_sig, 'base64url')),
    canonicalClaimPayload(claim),
  ),
  'a claim signed by proxy.key.pem verifies under proxy.pub.pem',
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
