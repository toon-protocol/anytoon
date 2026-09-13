/**
 * What the image must refuse.
 *
 * These are not unit tests of `loadConfig` so much as the published image's
 * contract, pinned so that a later convenience cannot quietly break it. Two
 * things must never acquire a default here:
 *
 *   - PROXY_PRIVATE_KEY_PATH, because the key is mounted and the image is
 *     public. An image that started without it would be an image that either
 *     carried a signing key or served without one.
 *   - BUNDLE_PRICE, because the issuer checks the amount against its own
 *     configured price. A default that silently won a disagreement with
 *     connector.toml would answer 402 on every paid request, and the 402 names
 *     neither side of the disagreement.
 *
 * The spawn cases cover the boot path rather than `loadConfig` alone: a
 * consumer who forgets the volume finds out from the exit code, not from a
 * container that is Up and 402s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';

import { loadConfig } from '../src/config.ts';

/** A complete, valid environment. Each case removes exactly one thing from it. */
const COMPLETE = {
  BUNDLE_PRICE: '0.01',
  ISSUER_URL: 'http://issuer:3000',
  PROXY_PRIVATE_KEY_PATH: new URL('./fixtures/proxy.key.pem', import.meta.url).pathname,
  ROUTE_ID: 'g.anyone.credentials',
} as const;

function without(name: keyof typeof COMPLETE): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...COMPLETE };
  delete env[name];
  return env;
}

const entrypoint = new URL('../src/server.ts', import.meta.url).pathname;

/** Runs the real entrypoint in a clean environment and reports how it died. */
function boot(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [entrypoint], { env }, (error, _stdout, stderr) => {
      resolve({ code: (error as { code?: number } | null)?.code ?? 0, stderr });
    });
  });
}

test('BUNDLE_PRICE has no default', () => {
  assert.throws(() => loadConfig(without('BUNDLE_PRICE')), /BUNDLE_PRICE is required/);
});

test('a BUNDLE_PRICE the issuer could not parse is refused at boot, not per request', () => {
  assert.throws(
    () => loadConfig({ ...COMPLETE, BUNDLE_PRICE: '0.01 ANYONE' }),
    /must be a decimal string/,
  );
});

test('PROXY_PRIVATE_KEY_PATH has no default', () => {
  assert.throws(
    () => loadConfig(without('PROXY_PRIVATE_KEY_PATH')),
    /PROXY_PRIVATE_KEY_PATH is required/,
  );
});

test('ISSUER_URL and ROUTE_ID have no defaults either', () => {
  assert.throws(() => loadConfig(without('ISSUER_URL')), /ISSUER_URL is required/);
  assert.throws(() => loadConfig(without('ROUTE_ID')), /ROUTE_ID is required/);
});

test('a complete environment loads, and PORT is the only optional value', () => {
  const config = loadConfig({ ...COMPLETE });
  assert.equal(config.port, 8080, 'the published port is the default, so compose need not set it');
  assert.equal(config.bundlePrice, '0.01');
  assert.equal(config.issuerUrl, 'http://issuer:3000', 'a trailing slash would be stripped');
});

test('the entrypoint exits non-zero when the key is not mounted', async () => {
  const { code, stderr } = await boot({ ...COMPLETE, PROXY_PRIVATE_KEY_PATH: '/keys/absent.pem' });
  assert.equal(code, 1, 'a missing key must stop the container, not degrade it');
  assert.match(stderr, /PROXY_PRIVATE_KEY_PATH=\/keys\/absent\.pem/);
  assert.doesNotMatch(stderr, /at loadSigningKey/, 'an operator gets a sentence, not a stack trace');
});

test('the entrypoint exits non-zero without BUNDLE_PRICE', async () => {
  const { code, stderr } = await boot(without('BUNDLE_PRICE'));
  assert.equal(code, 1);
  assert.match(stderr, /BUNDLE_PRICE is required/);
});
