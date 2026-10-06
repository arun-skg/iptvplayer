/**
 * Standalone stream proxy for IPTV Player.
 *
 * Unlike Cloudflare Workers, a plain Node server can connect to ANY port
 * (3500, 8000, 8888, ...), so this handles the HTTP-odd-port streams that the
 * Worker cannot. Run it on a VPS / Render / Railway / Fly.io behind HTTPS.
 *
 *   node proxy-server.js            # listens on PORT (default 8787)
 *
 * Endpoint:  /proxy?url=<encoded stream url>
 *
 * It mirrors the Cloudflare worker: CORS for everything, and for HLS (.m3u8)
 * playlists it rewrites every segment / sub-playlist / key URI back through
 * this proxy so the whole stream flows over one HTTPS origin.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    ...extra,
  };
}

// Resolve possibly-relative URLs against the playlist URL, then wrap them so
// the client re-requests them through this proxy.
function rewritePlaylist(content, playlistUrl, selfBase) {
  const wrap = (target) => {
    let abs;
    try {
      abs = new URL(target, playlistUrl).toString();
    } catch (e) {
      return target;
    }
    return `${selfBase}?url=${encodeURIComponent(abs)}`;
  };

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
      }
      return wrap(trimmed);
    })
    .join('\n');
}

function fetchUpstream(target, method, reqHeaders, redirectsLeft, cb) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    return cb(new Error('Bad URL'));
  }

  const lib = parsed.protocol === 'https:' ? https : http;

  const headers = { Accept: '*/*' };
  if (reqHeaders['user-agent']) headers['User-Agent'] = reqHeaders['user-agent'];
  if (reqHeaders['range']) headers['Range'] = reqHeaders['range'];

  const upstreamReq = lib.request(
    parsed,
    { method: method === 'HEAD' ? 'HEAD' : 'GET', headers, timeout: 20000 },
    (upstreamRes) => {
      const status = upstreamRes.statusCode;
      // Follow redirects manually so we can keep proxying.
      if (status >= 300 && status < 400 && upstreamRes.headers.location && redirectsLeft > 0) {
        upstreamRes.resume();
        const next = new URL(upstreamRes.headers.location, parsed).toString();
        return fetchUpstream(next, method, reqHeaders, redirectsLeft - 1, cb);
      }
      cb(null, upstreamRes, parsed.toString());
    }
  );

  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream timeout')));
  upstreamReq.on('error', (err) => cb(err));
  upstreamReq.end();
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (reqUrl.pathname !== '/proxy') {
    res.writeHead(200, corsHeaders({ 'Content-Type': 'text/plain' }));
    return res.end('Stream proxy up. Use /proxy?url=<stream url>');
  }

  const target = reqUrl.searchParams.get('url');
  if (!target) {
    res.writeHead(400, corsHeaders({ 'Content-Type': 'text/plain' }));
    return res.end('Missing url parameter');
  }

  // Public base for rewritten URLs. Honor proxy headers so HTTPS is preserved.
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const selfBase = `${proto}://${req.headers.host}/proxy`;

  fetchUpstream(target, req.method, req.headers, 5, (err, upstreamRes, finalUrl) => {
    if (err) {
      res.writeHead(502, corsHeaders({ 'Content-Type': 'text/plain' }));
      return res.end('Upstream fetch failed: ' + err.message);
    }

    const contentType = (upstreamRes.headers['content-type'] || '').toLowerCase();
    const isPlaylist =
      contentType.includes('mpegurl') ||
      finalUrl.split('?')[0].toLowerCase().endsWith('.m3u8');

    if (isPlaylist && req.method !== 'HEAD') {
      let body = '';
      upstreamRes.setEncoding('utf8');
      upstreamRes.on('data', (c) => (body += c));
      upstreamRes.on('end', () => {
        const rewritten = rewritePlaylist(body, finalUrl, selfBase);
        res.writeHead(
          upstreamRes.statusCode,
          corsHeaders({ 'Content-Type': 'application/vnd.apple.mpegurl' })
        );
        res.end(rewritten);
      });
      upstreamRes.on('error', () => {
        res.writeHead(502, corsHeaders());
        res.end('Stream error');
      });
      return;
    }

    // Pass through bytes (segments, keys, MP4, DASH .mpd, etc.)
    const passHeaders = corsHeaders();
    ['content-type', 'content-length', 'accept-ranges', 'content-range'].forEach((h) => {
      if (upstreamRes.headers[h]) passHeaders[h] = upstreamRes.headers[h];
    });
    res.writeHead(upstreamRes.statusCode, passHeaders);
    upstreamRes.pipe(res);
    upstreamRes.on('error', () => res.destroy());
  });
});

server.listen(PORT, () => {
  console.log(`Stream proxy listening on :${PORT}`);
});
