/**
 * Negative-path checks against a running stack. These are the failures that
 * would cost money or credentials quietly, so they are asserted against the
 * real connector rather than a stub.
 *
 *   node src/verify-routes.ts
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ToonClient } from '@toon-protocol/client';
import { hiddenServiceOptions } from './hidden-service.ts';

const CONNECTOR = process.env.TOON_CONNECTOR ?? 'http://127.0.0.1:3000';

const client = await ToonClient.create({
  connector: CONNECTOR,
  mnemonic: process.env.TOON_MNEMONIC,
  evmPrivateKey: process.env.TOON_EVM_PRIVATE_KEY,
  rpcUrl: process.env.TOON_RPC_URL,
  transport: 'http',
  deposit: BigInt(process.env.TOON_DEPOSIT ?? '100000'),
  autoOpenChannel: true,
  channelStore: process.env.TOON_CHANNEL_STORE ?? join(homedir(), '.toon', 'channels.json'),
  // These are the checks that would cost money or credentials quietly, so they
  // have to run against the node as DEPLOYED. On a hidden-service-only node
  // that means over the circuit: same env vars as `buy`.
  ...hiddenServiceOptions(CONNECTOR),
});

let failures = 0;
function check(ok: boolean, label: string, detail: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}\n         ${detail}`);
  if (!ok) failures++;
}

async function send(dest: string, target: string, method: string, headers?: Record<string, string>) {
  const r = await client.send(dest, { method, target, headers, body: '{}' });
  return r.fulfilled
    ? { ok: true, status: r.status, text: String(r.text()).slice(0, 70) }
    : { ok: false, status: 0, text: `refused ${r.refusedBy} ${r.code}` };
}

// The free route must not be a free door into the priced one. Its handler is
// scoped to /v1/keys/, so a target cannot climb out of it.
const escape = await send('g.anyone.credentials.keys', '../v1/bundles', 'POST');
check(!(escape.ok && escape.status === 201), 'free route cannot reach bundle issuance',
  `${escape.status || 'refused'} ${escape.text}`);

const absolute = await send('g.anyone.credentials.keys', '/v1/bundles', 'POST');
check(!(absolute.ok && absolute.status === 201), 'absolute target cannot escape the handler',
  `${absolute.status || 'refused'} ${absolute.text}`);

// The minter proxies one path only: anything else must not reach the issuer.
const offPath = await send('g.anyone.credentials', 'healthz', 'POST');
check(offPath.status === 404, 'paid route proxies only /v1/bundles',
  `${offPath.status} ${offPath.text}`);

// A caller's own claim header must be discarded, never forwarded.
const forged = Buffer.from(JSON.stringify({
  payment_ref: 'attacker', amount: '0.01', route_id: 'x', proxy_sig: 'AAAA',
})).toString('base64url');
const swap = await send('g.anyone.credentials', 'v1/bundles', 'POST', { 'x-payment-claim': forged });
check(swap.status !== 402, "caller's X-Payment-Claim is replaced, not forwarded",
  `${swap.status} ${swap.text}`);

await client.close();
console.log(failures === 0 ? '\nAll route checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
