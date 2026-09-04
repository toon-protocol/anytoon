/**
 * The minter's gate. Each of these guards a way money or credentials could
 * leak: an unwhitelisted path proxies to the issuer with a minted claim, an
 * inbound claim replays a payment the issuer cannot detect, and a missing
 * payer collapses every anonymous caller into one rate-limit bucket.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMinter, forwardableHeaders, PAYER_HEADER } from '../src/server.ts';
import { loadSigningKey } from '../src/keys.ts';
import { canonicalClaimPayload } from '../src/claim.ts';

const keyPath = new URL('./fixtures/proxy.key.pem', import.meta.url).pathname;
const PAYER = 'evm:0x1111111111111111111111111111111111111111';

/** Stands in for the issuer: echoes what it was asked, signs nothing. */
let issuer: Server;
let issuerCalls: { path: string; headers: Record<string, unknown>; body: string }[] = [];
let minter: Server;
let minterUrl: string;

before(async () => {
  issuer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    issuerCalls.push({
      path: req.url ?? '',
      headers: req.headers as Record<string, unknown>,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    res.writeHead(201, { 'content-type': 'application/json', 'x-issuer-header': 'kept' });
    res.end(JSON.stringify({ epoch: '0', blind_signatures: ['AAAA'] }));
  });
  await new Promise<void>((r) => issuer.listen(0, '127.0.0.1', r));
  const issuerUrl = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;

  const config = {
    port: 0,
    issuerUrl,
    proxyPrivateKeyPath: keyPath,
    bundlePrice: '0.01',
    routeId: 'g.anyone.credentials',
  };
  minter = createServer(createMinter(config, await loadSigningKey(keyPath)));
  await new Promise<void>((r) => minter.listen(0, '127.0.0.1', r));
  minterUrl = `http://127.0.0.1:${(minter.address() as AddressInfo).port}`;
});

after(() => {
  minter.close();
  issuer.close();
});

function reset() {
  issuerCalls = [];
}

test('a paid request is forwarded with a minted claim', async () => {
  reset();
  const res = await fetch(`${minterUrl}/v1/bundles`, {
    method: 'POST',
    headers: { [PAYER_HEADER]: PAYER, 'content-type': 'application/json' },
    body: JSON.stringify({ epoch: '0', blinded_blanks: [] }),
  });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('x-issuer-header'), 'kept', 'issuer response headers are relayed');
  assert.equal(issuerCalls.length, 1);

  const claim = JSON.parse(
    Buffer.from(issuerCalls[0].headers['x-payment-claim'] as string, 'base64url').toString('utf8'),
  );
  assert.equal(claim.payment_ref, PAYER, 'payment_ref is the paying channel identity');
  assert.equal(claim.amount, '0.01');
  assert.equal(claim.route_id, 'g.anyone.credentials');
  assert.equal(issuerCalls[0].body, JSON.stringify({ epoch: '0', blinded_blanks: [] }));
});

test("a caller's own X-Payment-Claim never reaches the issuer", async () => {
  reset();
  const forged = Buffer.from(
    JSON.stringify({ payment_ref: 'attacker', amount: '0.01', route_id: 'x', proxy_sig: 'AAAA' }),
  ).toString('base64url');

  await fetch(`${minterUrl}/v1/bundles`, {
    method: 'POST',
    headers: { [PAYER_HEADER]: PAYER, 'x-payment-claim': forged },
    body: '{}',
  });

  const seen = issuerCalls[0].headers['x-payment-claim'] as string;
  assert.notEqual(seen, forged, 'the inbound claim is dropped, not passed through');
  const claim = JSON.parse(Buffer.from(seen, 'base64url').toString('utf8'));
  assert.equal(claim.payment_ref, PAYER, 'the claim is ours, keyed to the attributed payer');
});

test('Idempotency-Key survives, hop-by-hop headers do not', async () => {
  reset();
  await fetch(`${minterUrl}/v1/bundles`, {
    method: 'POST',
    headers: { [PAYER_HEADER]: PAYER, 'idempotency-key': 'abc-123', 'content-type': 'application/json' },
    body: '{}',
  });

  assert.equal(issuerCalls[0].headers['idempotency-key'], 'abc-123');
  assert.equal(issuerCalls[0].headers['content-type'], 'application/json');
});

test('no X-TOON-Payer fails closed and signs nothing', async () => {
  reset();
  const res = await fetch(`${minterUrl}/v1/bundles`, { method: 'POST', body: '{}' });

  assert.equal(res.status, 402);
  assert.equal((await res.json()).error.code, 'PAYER_UNATTRIBUTED');
  assert.equal(issuerCalls.length, 0, 'the issuer is never touched');
});

test('only POST /v1/bundles is proxied', async () => {
  reset();
  for (const [method, path] of [
    ['POST', '/v1/keys/current'],
    ['GET', '/v1/bundles'],
    ['POST', '/v1/bundles/../healthz'],
    ['POST', '/'],
  ] as const) {
    const res = await fetch(`${minterUrl}${path}`, {
      method,
      headers: { [PAYER_HEADER]: PAYER },
      body: method === 'POST' ? '{}' : undefined,
    });
    assert.equal(res.status, 404, `${method} ${path} must not proxy`);
  }
  assert.equal(issuerCalls.length, 0, 'nothing reached the issuer');
});

test('healthz is answered locally and never proxied', async () => {
  reset();
  const res = await fetch(`${minterUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(issuerCalls.length, 0);
});

test('forwardableHeaders drops the claim, host and content-length', () => {
  const out = forwardableHeaders({
    'x-payment-claim': 'forged',
    host: 'minter:8080',
    'content-length': '2',
    connection: 'keep-alive',
    'idempotency-key': 'abc-123',
    'content-type': 'application/json',
  });
  assert.deepEqual(out, { 'idempotency-key': 'abc-123', 'content-type': 'application/json' });
});
