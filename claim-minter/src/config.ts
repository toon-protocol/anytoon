/**
 * Configuration, validated at boot. Everything here can make every request
 * fail, so it fails the process instead.
 */

export interface MinterConfig {
  readonly port: number;
  readonly issuerUrl: string;
  readonly proxyPrivateKeyPath: string;
  /** Must equal the issuer's BUNDLE_PRICE exactly, and match the connector's `price`. */
  readonly bundlePrice: string;
  /** Signed into every claim. The issuer records it but does not check it. */
  readonly routeId: string;
}

/** Mirrors the issuer's own decimal check, so a bad price fails here first. */
export function isDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MinterConfig {
  const bundlePrice = required(env, 'BUNDLE_PRICE');
  if (!isDecimal(bundlePrice)) {
    throw new Error(`BUNDLE_PRICE must be a decimal string, got ${bundlePrice}`);
  }

  const port = Number(env.PORT ?? '8080');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got ${env.PORT}`);
  }

  return {
    port,
    issuerUrl: required(env, 'ISSUER_URL').replace(/\/+$/, ''),
    proxyPrivateKeyPath: required(env, 'PROXY_PRIVATE_KEY_PATH'),
    bundlePrice,
    routeId: required(env, 'ROUTE_ID'),
  };
}
