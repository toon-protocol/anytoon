/**
 * The buyer's half of the credential protocol.
 *
 * Invariant I1 forbids hand-rolled crypto: every protocol step runs inside
 * @cloudflare/blindrsa-ts. This module only sequences the library's calls and
 * handles encoding, so it can be tested without a running stack.
 */
import { RSABSSA } from '@cloudflare/blindrsa-ts';

/** The suite the issuer's key document must name. */
export const SUITE_NAME = 'RSABSSA-SHA384-PSS-Randomized';

export const suite = RSABSSA.SHA384.PSS.Randomized();

export interface KeyDocument {
  readonly epoch_id: string;
  readonly not_before: string;
  readonly not_after: string;
  readonly alg: string;
  /** Strict-base64 SPKI of the epoch public key. */
  readonly pubkey: string;
}

/** One credential in flight: the serial we will hold, and the blinding factor. */
export interface Blank {
  /** The randomizer-prefixed message the signature will cover. */
  readonly prepared: Uint8Array;
  readonly inv: Uint8Array;
  /** base64 of the blinded blank, as the issuer expects it. */
  readonly blinded: string;
}

export async function importEpochKey(doc: KeyDocument): Promise<CryptoKey> {
  if (doc.alg !== SUITE_NAME) {
    throw new Error(`key document names ${doc.alg}, expected ${SUITE_NAME}`);
  }
  const now = Date.now();
  if (now < Date.parse(doc.not_before) || now >= Date.parse(doc.not_after)) {
    throw new Error(`epoch ${doc.epoch_id} is not currently valid`);
  }
  return crypto.subtle.importKey(
    'spki',
    new Uint8Array(Buffer.from(doc.pubkey, 'base64')),
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['verify'],
  );
}

/**
 * Blinds `count` fresh serials. The issuer sees only `blinded`; invariant I2
 * says it must never see the serial, and this is the buyer-side half of that.
 */
export async function blindBlanks(publicKey: CryptoKey, count: number): Promise<Blank[]> {
  const blanks: Blank[] = [];
  for (let i = 0; i < count; i++) {
    const serial = crypto.getRandomValues(new Uint8Array(32));
    const prepared = suite.prepare(serial);
    const { blindedMsg, inv } = await suite.blind(publicKey, prepared);
    blanks.push({ prepared, inv, blinded: Buffer.from(blindedMsg).toString('base64') });
  }
  return blanks;
}

/**
 * Unblinds and verifies. `finalize` checks the signature against the epoch key,
 * so a stack that returns k blobs of garbage fails here rather than passing as
 * "we got k credentials back".
 */
export async function finalizeCredentials(
  publicKey: CryptoKey,
  blanks: readonly Blank[],
  blindSignatures: readonly string[],
): Promise<Uint8Array[]> {
  if (blindSignatures.length !== blanks.length) {
    throw new Error(`asked for ${blanks.length} signatures, got ${blindSignatures.length}`);
  }

  const credentials: Uint8Array[] = [];
  for (const [i, blank] of blanks.entries()) {
    const blindSig = new Uint8Array(Buffer.from(blindSignatures[i], 'base64'));
    const signature = await suite.finalize(publicKey, blank.prepared, blindSig, blank.inv);
    if (!(await suite.verify(publicKey, signature, blank.prepared))) {
      throw new Error(`credential ${i} does not verify under the epoch key`);
    }
    credentials.push(signature);
  }
  return credentials;
}
