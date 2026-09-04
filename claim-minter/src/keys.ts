/**
 * PEM loading. The minter holds one key: the private half of the pair whose
 * public half the issuer mounts at PROXY_PUBLIC_KEY_PATH. It never sees the
 * issuer's epoch key, and the issuer never sees this one.
 */
import { readFile } from 'node:fs/promises';
import { PROXY_SIGNATURE_ALGORITHM } from './claim.ts';

/** Strips the armour from a PEM block and returns the DER bytes. */
export function pemToDer(pem: string, label: string): Uint8Array {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = pem.indexOf(begin);
  const stop = pem.indexOf(end);
  if (start === -1 || stop === -1) {
    throw new Error(`not a ${label} PEM block`);
  }
  const body = pem.slice(start + begin.length, stop).replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

/** Loads the Ed25519 signing key from a PKCS#8 PEM file. */
export async function loadSigningKey(path: string): Promise<CryptoKey> {
  const pem = await readFile(path, 'utf8');
  return crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem, 'PRIVATE KEY'),
    { name: PROXY_SIGNATURE_ALGORITHM },
    false,
    ['sign'],
  );
}
