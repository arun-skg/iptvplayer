import { connect } from 'cloudflare:sockets';

// Ports that Cloudflare's fetch() is allowed to use. Anything else (e.g. 3500,
// 8000) must go over a raw TCP socket, which has no port restriction.
const FETCH_OK_PORTS = new Set([
  80, 8080, 8880, 2052, 2082, 2086, 2095, // http
  443, 8443, 2053, 2083, 2087, 2096,      // https
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const proxyUrl = url.searchParams.get('url');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (!proxyUrl) {
      return new Response('Missing url parameter', { status: 400, headers: corsHeaders() });
    }

    const selfBase = `${url.origin}${url.pathname}`;

    let target;
    try {
      target = new URL(proxyUrl);
    } catch (e) {
      return new Response('Bad url', { status: 400, headers: corsHeaders() });
    }

    const port = target.port
      ? parseInt(target.port, 10)
      : (target.protocol === 'https:' ? 443 : 80);

    const isHead = request.method === 'HEAD';
    const range = request.headers.get('Range');
    const ua = request.headers.get('User-Agent');

    let result; // { status, contentType, headers, body(Uint8Array|null), bodyStream(ReadableStream|null) }

    try {
      if (target.protocol === 'http:' && !FETCH_OK_PORTS.has(port)) {
        // Odd-port HTTP: use a raw socket (buffers full response).
        result = await socketHttp(target, port, { isHead, range, ua });
      } else {
        // Standard ports / HTTPS: normal fetch, can stream.
        const h = new Headers({ Accept: '*/*' });
        if (ua) h.set('User-Agent', ua);
        if (range) h.set('Range', range);
        const resp = await fetch(target.toString(), {
          method: isHead ? 'HEAD' : 'GET',
          headers: h,
          redirect: 'follow',
        });
        result = {
          status: resp.status,
          contentType: (resp.headers.get('Content-Type') || '').toLowerCase(),
          passHeaders: pickHeaders(resp.headers),
          body: null,
          bodyStream: resp.body,
        };
      }
    } catch (e) {
      return new Response('Upstream failed: ' + e.message, { status: 502, headers: corsHeaders() });
    }

    const isPlaylist =
      result.contentType.includes('mpegurl') ||
      target.pathname.toLowerCase().endsWith('.m3u8');

    // Rewrite HLS playlists so segments/keys also route back through the proxy.
    if (isPlaylist && !isHead) {
      let text;
      if (result.body) {
        text = new TextDecoder().decode(result.body);
      } else {
        text = await new Response(result.bodyStream).text();
      }
      const rewritten = rewritePlaylist(text, target.toString(), selfBase);
      const headers = corsHeaders();
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      return new Response(rewritten, { status: result.status, headers });
    }

    const headers = corsHeaders();
    for (const [k, v] of Object.entries(result.passHeaders || {})) headers.set(k, v);
    const outBody = isHead ? null : (result.body ?? result.bodyStream);
    return new Response(outBody, { status: result.status, headers });
  },
};

function corsHeaders() {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
  });
}

function pickHeaders(h) {
  const out = {};
  ['content-type', 'content-length', 'accept-ranges', 'content-range'].forEach((k) => {
    const v = h.get(k);
    if (v) out[k] = v;
  });
  return out;
}

function rewritePlaylist(content, playlistUrl, selfBase) {
  const wrap = (t) => {
    let abs;
    try { abs = new URL(t, playlistUrl).toString(); } catch (e) { return t; }
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

// Minimal HTTP/1.1 client over a raw TCP socket. Follows redirects, handles
// Content-Length and chunked bodies, returns the full response buffered.
async function socketHttp(target, port, opts, redirectsLeft = 5) {
  const socket = connect({ hostname: target.hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  const path = target.pathname + target.search;
  const lines = [
    `${opts.isHead ? 'HEAD' : 'GET'} ${path} HTTP/1.1`,
    `Host: ${target.host}`,
    `User-Agent: ${opts.ua || 'Mozilla/5.0'}`,
    'Accept: */*',
    'Connection: close',
  ];
  if (opts.range) lines.push(`Range: ${opts.range}`);
  const requestText = lines.join('\r\n') + '\r\n\r\n';

  await writer.write(new TextEncoder().encode(requestText));

  // Read the whole response into one buffer.
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await socket.close(); } catch (e) {}

  const raw = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { raw.set(c, off); off += c.length; }

  // Split headers / body on the first CRLFCRLF.
  const sep = indexOfCRLFCRLF(raw);
  if (sep === -1) throw new Error('Malformed HTTP response');

  const headerText = new TextDecoder().decode(raw.subarray(0, sep));
  let bodyBytes = raw.subarray(sep + 4);

  const headerLines = headerText.split('\r\n');
  const statusLine = headerLines[0] || '';
  const status = parseInt(statusLine.split(' ')[1], 10) || 502;

  const headers = {};
  for (let i = 1; i < headerLines.length; i++) {
    const idx = headerLines[i].indexOf(':');
    if (idx > 0) {
      headers[headerLines[i].slice(0, idx).trim().toLowerCase()] =
        headerLines[i].slice(idx + 1).trim();
    }
  }

  // Redirects.
  if (status >= 300 && status < 400 && headers['location'] && redirectsLeft > 0) {
    const next = new URL(headers['location'], target.toString());
    const nextPort = next.port
      ? parseInt(next.port, 10)
      : (next.protocol === 'https:' ? 443 : 80);
    if (next.protocol === 'http:' && !FETCH_OK_PORTS.has(nextPort)) {
      return socketHttp(next, nextPort, opts, redirectsLeft - 1);
    }
    // Redirected to a fetch-able location.
    const h = new Headers({ Accept: '*/*' });
    if (opts.ua) h.set('User-Agent', opts.ua);
    if (opts.range) h.set('Range', opts.range);
    const resp = await fetch(next.toString(), { method: opts.isHead ? 'HEAD' : 'GET', headers: h, redirect: 'follow' });
    const buf = opts.isHead ? new Uint8Array(0) : new Uint8Array(await resp.arrayBuffer());
    return {
      status: resp.status,
      contentType: (resp.headers.get('Content-Type') || '').toLowerCase(),
      passHeaders: pickHeaders(resp.headers),
      body: buf,
      bodyStream: null,
    };
  }

  // Decode chunked transfer encoding if present.
  if ((headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
    bodyBytes = dechunk(bodyBytes);
  }

  return {
    status,
    contentType: (headers['content-type'] || '').toLowerCase(),
    passHeaders: {
      ...(headers['content-type'] ? { 'content-type': headers['content-type'] } : {}),
      ...(headers['accept-ranges'] ? { 'accept-ranges': headers['accept-ranges'] } : {}),
      ...(headers['content-range'] ? { 'content-range': headers['content-range'] } : {}),
    },
    body: opts.isHead ? new Uint8Array(0) : bodyBytes,
    bodyStream: null,
  };
}

function indexOfCRLFCRLF(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

function dechunk(buf) {
  const out = [];
  let i = 0;
  let outLen = 0;
  while (i < buf.length) {
    // Read chunk-size line (hex up to CRLF).
    let lineEnd = i;
    while (lineEnd + 1 < buf.length && !(buf[lineEnd] === 13 && buf[lineEnd + 1] === 10)) lineEnd++;
    const sizeStr = new TextDecoder().decode(buf.subarray(i, lineEnd)).split(';')[0].trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size) || size === 0) break;
    const start = lineEnd + 2;
    const end = start + size;
    out.push(buf.subarray(start, end));
    outLen += size;
    i = end + 2; // skip trailing CRLF
  }
  const merged = new Uint8Array(outLen);
  let off = 0;
  for (const c of out) { merged.set(c, off); off += c.length; }
  return merged;
}
