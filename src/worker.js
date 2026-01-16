export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Proxy Endpoint
    if (url.pathname.startsWith('/proxy')) {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return new Response('Missing URL', { status: 400 });

      // Handle CORS Preflight for the proxy endpoint itself
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          }
        });
      }

      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', '*');
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      } catch (e) {
        return new Response(e.message, { status: 500 });
      }
    }

    // Serve Static Assets
    // For "Workers with Assets", env.ASSETS is available
    if (env.ASSETS) {
        return env.ASSETS.fetch(request);
    }
    
    return new Response("Not Found", { status: 404 });
  }
}
