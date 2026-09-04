/**
 * The issuer's payment claim, minted from the connector's attribution.
 *
 * This is a deliberate, independent reimplementation of
 * `apps/backend/src/payment/claim-signing.ts` in anyone-protocol/credentials-issuer.
 * Upstream keeps its verifier and its buyer harness as two separate copies for
 * exactly this reason: a change on one side that the other does not match must
 * surface as a failing test rather than as a silent 402 in production. We are a
 * third copy, and `test/claim.test.ts` pins us to the same bytes.
 *
 * Do not "improve" the key ordering below. It is the wire format.
 */

/** The three fields `proxy_sig` covers. It does not cover itself. */
export interface SignedClaimFields {
  readonly payment_ref: string;
  readonly amount: string;
  readonly route_id: string;
}

export const PROXY_SIGNATURE_ALGORITHM = 'Ed25519';
export const PAYMENT_CLAIM_HEADER = 'x-payment-claim';

/**
 * The exact bytes `proxy_sig` covers: UTF-8 of a JSON object whose keys are
 * emitted in fixed alphabetical order with no whitespace, so both sides produce
 * identical bytes without a canonical-JSON library.
 */
export function canonicalClaimPayload(fields: SignedClaimFields): Uint8Array {
  const ordered = JSON.stringify({
    amount: fields.amount,
    payment_ref: fields.payment_ref,
    route_id: fields.route_id,
  });
  return new TextEncoder().encode(ordered);
}

/**
 * Returns the `X-Payment-Claim` header value: base64url of the JSON claim,
 * whose `proxy_sig` is base64url of the raw 64-byte Ed25519 signature.
 */
export async function mintClaim(
  fields: SignedClaimFields,
  signingKey: CryptoKey,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: PROXY_SIGNATURE_ALGORITHM },
    signingKey,
    canonicalClaimPayload(fields),
  );

  const claim = {
    payment_ref: fields.payment_ref,
    amount: fields.amount,
    route_id: fields.route_id,
    proxy_sig: Buffer.from(signature).toString('base64url'),
  };

  return Buffer.from(JSON.stringify(claim), 'utf8').toString('base64url');
}
