/**
 * Preload shim: some networks (e.g. phone hotspots) return SERVFAIL for the
 * Supabase pooler and Cloudflare R2 hostnames, so every script here dies with
 * EAI_AGAIN. Wrap dns.lookup to retry through public resolvers.
 *
 * Use: node -r ./scripts/_dns-fallback.js -r ts-node/register scripts/foo.ts
 */
const dns = require('node:dns');

const resolver = new dns.promises.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

const originalLookup = dns.lookup;

function fallbackLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = typeof options === 'number' ? { family: options } : options || {};

  originalLookup(hostname, opts, (err, address, family) => {
    if (!err) return callback(null, address, family);

    resolver
      .resolve4(hostname)
      .then((addresses) => {
        if (!addresses.length) return callback(err);
        if (opts.all) {
          callback(null, addresses.map((a) => ({ address: a, family: 4 })));
        } else {
          callback(null, addresses[0], 4);
        }
      })
      .catch(() => callback(err));
  });
}

dns.lookup = fallbackLookup;
require('node:dns/promises'); // keep the promises view consistent
