/**
 * Reaching a connector that lives at a hidden-service address.
 *
 * The toon client speaks this natively -- it takes a `socksProxy` and dials the
 * address through it -- so all this module does is decide WHEN to pass one, and
 * refuse the near-misses early with a message that says what went wrong.
 *
 *   TOON_CONNECTOR=http://<56-char-address>.anyone \
 *   TOON_SOCKS_PROXY=socks5h://127.0.0.1:9050 \
 *     npm run buy
 *
 * Unset, this returns `{}` and nothing about the clearnet path changes.
 *
 * `socksProxy` is REQUIRED when the connector is a hidden service and REFUSED
 * when it is not -- the client rejects it as pointless misdirection -- so the
 * two settings are not independent and are decided together here.
 */

/** The one hidden-service TLD `anon` routes, and the only one the client takes. */
const HS_TLD = '.anyone';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Extra `ToonClient.create` options for reaching `connector`.
 *
 * Returns `{}` for a clearnet connector, so the default path is unchanged.
 */
export function hiddenServiceOptions(connector: string): {
  socksProxy?: string;
  proxyRpc?: boolean;
} {
  const host = hostOf(connector);
  const proxy = process.env.TOON_SOCKS_PROXY;

  // The two near-misses, refused by name. Both otherwise surface much later as
  // an opaque SOCKS "host unreachable", which reads like the node is down.
  if (host.endsWith('.onion')) {
    throw new Error(
      `TOON_CONNECTOR names a .onion address. That is Tor; this is Anyone ` +
        `Protocol, whose daemon routes ${HS_TLD} and contains no .onion at all. ` +
        `A .onion address here means the node is running anon v0.4.9.7, from ` +
        `before the TLD was renamed.`,
    );
  }
  if (host.endsWith('.anon')) {
    throw new Error(`TOON_CONNECTOR names a .anon address; the routable TLD is ${HS_TLD}.`);
  }

  if (!host.endsWith(HS_TLD)) {
    // A clearnet connector. Passing a proxy here is refused by the client, so
    // say why rather than letting it throw from further in.
    if (proxy) {
      throw new Error(
        `TOON_SOCKS_PROXY is set but TOON_CONNECTOR (${host}) is not a hidden ` +
          `service, so the proxy would reach nothing. Unset one of them.`,
      );
    }
    return {};
  }

  if (!proxy) {
    throw new Error(
      `TOON_CONNECTOR is a hidden service, which needs a SOCKS5 proxy to dial: ` +
        `no local resolver can resolve a ${HS_TLD} name. Set ` +
        `TOON_SOCKS_PROXY=socks5h://127.0.0.1:9050, pointing at a running anon daemon.`,
    );
  }

  // Default TRUE, and leaving it on is the point: reading chain state on the
  // clearnet would broadcast this buyer's settlement address either side of
  // every paid request. `false` is for an RPC that is already private -- your
  // own node on loopback -- where the extra hop buys nothing.
  const proxyRpc = process.env.TOON_PROXY_RPC !== 'false';

  console.log(`  reaching ${host} through ${proxy}${proxyRpc ? ', chain RPC too' : ''}`);
  return { socksProxy: proxy, proxyRpc };
}
