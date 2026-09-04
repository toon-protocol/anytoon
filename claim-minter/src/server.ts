/**
 * The claim minter.
 *
 * The connector collects payment and tells us who paid. The issuer will not
 * sign without a claim signed by a key it trusts. This turns the one into the
 * other, and does nothing else.
 *
 * What it deliberately does NOT do:
 *
 *   - It does not read X-TOON-Amount. The connector's contract is that the app
 *     "must not decide anything about the payment", and that header is absent
 *     whenever a node upstream of us collected. Authorisation here is network
 *     isolation: the connector is the only ingress, and we publish no port.
 *   - It does not proxy anything but POST /v1/bundles. The route's handler_url
 *     is our root, so without a whitelist a caller could reach any issuer path
 *     with a freshly minted claim attached.
 *   - It does not trust a caller's own X-Payment-Claim. The connector relays
 *     caller headers verbatim (it owns only the three X-TOON-* names), and the
 *     issuer has no replay protection, so an inbound claim is always dropped.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, type MinterConfig } from './config.ts';
import { loadSigningKey } from './keys.ts';
import { mintClaim, PAYMENT_CLAIM_HEADER } from './claim.ts';

/** The connector's attribution header naming who paid for this request. */
export const PAYER_HEADER = 'x-toon-payer';

export const BUNDLES_PATH = '/v1/bundles';

/**
 * Header names meaningful only for one hop of a connection (RFC 7230 6.1),
 * never carried across a proxying boundary in either direction. `host` and
 * `content-length` are recomputed from the URL and the body, so carrying the
 * inbound values across would describe the wrong hop.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Every header we pass to the issuer. The caller's own headers ride through
 * the connector verbatim, so Idempotency-Key and content-type must survive —
 * but the claim header is ours alone and is always dropped first.
 */
export function forwardableHeaders(
  incoming: NodeJS.Dict<string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === PAYMENT_CLAIM_HEADER) continue;
    if (value === undefined) continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

export function createMinter(config: MinterConfig, signingKey: CryptoKey) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://minter.invalid');

    // Answered here, never proxied: liveness for the container, not a route.
    if (req.method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method !== 'POST' || url.pathname !== BUNDLES_PATH) {
      send(res, 404, errorBody('NOT_FOUND', `the claim minter serves POST ${BUNDLES_PATH} only`));
      return;
    }

    const payer = req.headers[PAYER_HEADER];
    const paymentRef = Array.isArray(payer) ? payer[0] : payer;
    if (!paymentRef) {
      // Fail closed. Without an attributed payer there is no payment reference,
      // and an unattributed claim would share one rate-limit bucket with every
      // other unattributed caller. This route must be terminated, not forwarded.
      send(res, 402, errorBody('PAYER_UNATTRIBUTED', 'no X-TOON-Payer on this request'));
      return;
    }

    const body = await readBody(req);
    const claim = await mintClaim(
      { payment_ref: paymentRef, amount: config.bundlePrice, route_id: config.routeId },
      signingKey,
    );

    let upstream: Response;
    try {
      upstream = await fetch(`${config.issuerUrl}${BUNDLES_PATH}`, {
        method: 'POST',
        headers: { ...forwardableHeaders(req.headers), [PAYMENT_CLAIM_HEADER]: claim },
        body,
      });
    } catch (cause) {
      // Unreachable issuer is the one case the connector should see as a
      // reject rather than a paid answer, so say so plainly.
      send(res, 502, errorBody('ISSUER_UNREACHABLE', String(cause)));
      return;
    }

    const relayed: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) relayed[name] = value;
    });
    res.writeHead(upstream.status, relayed);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  };
}

/* node:test imports this module; only a direct run starts a listener. */
if (import.meta.filename === process.argv[1]) {
  const config = loadConfig();
  const signingKey = await loadSigningKey(config.proxyPrivateKeyPath);
  createServer(createMinter(config, signingKey)).listen(config.port, () => {
    console.log(`claim minter on :${config.port} -> ${config.issuerUrl} (route ${config.routeId})`);
  });
}
