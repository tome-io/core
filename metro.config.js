const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

let config = getDefaultConfig(__dirname);
config = withNativeWind(config, { input: './src/global.css' });

// expo-sqlite's web worker imports wa-sqlite.wasm. Metro does not include
// wasm in its asset extensions by default.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Dev-only CORS proxy: Z-Library mirrors don't send CORS headers, so the web
// build routes its API calls through /zlib-proxy/<encodeURIComponent(url)>.
// Native builds talk to the mirrors directly.
const previousEnhance = config.server?.enhanceMiddleware;
config.server = {
  ...(config.server || {}),
  enhanceMiddleware: (middleware, server) => {
    const inner = previousEnhance ? previousEnhance(middleware, server) : middleware;

    const PREFIX = '/zlib-proxy/';

    return (req, res, next) => {
      // expo-sqlite uses SharedArrayBuffer on web. These headers are required
      // for both the main document and its SQLite worker.
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

      if (req.url && req.url.startsWith(PREFIX)) {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': '*',
          });
          res.end();
          return;
        }
        handleProxy(req, res);
        return;
      }
      inner(req, res, next);
    };
  },
};

async function handleProxy(req, res) {
  const PREFIX = '/zlib-proxy/';
  try {
    const encoded = req.url.slice(PREFIX.length).split('?')[0];
    const target = decodeURIComponent(encoded);
    if (!/^https?:\/\//i.test(target)) throw new Error(`bad target: ${target}`);

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    // Forward method/body/headers, dropping hop-by-hop and browser-only ones
    const headers = { ...req.headers };
    // Browsers can't set the Cookie header; the app sends X-Zlib-Cookie instead
    if (headers['x-zlib-cookie']) {
      headers.cookie = headers['x-zlib-cookie'];
    }
    for (const h of [
      'host',
      'connection',
      'origin',
      'referer',
      'accept-encoding',
      'content-length',
      'x-zlib-cookie',
    ]) {
      delete headers[h];
    }

    // Don't follow redirects: some mirrors bounce forever (redirect loops).
    // Pass the 3xx through so the app treats it as a dead mirror and
    // fails over to the next one.
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const resHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type':
        upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': buf.length,
    };
    const location = upstream.headers.get('location');
    if (location) resHeaders['X-Upstream-Location'] = location;
    res.writeHead(upstream.status, resHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(`proxy error: ${err.message}`);
  }
}

module.exports = config;
