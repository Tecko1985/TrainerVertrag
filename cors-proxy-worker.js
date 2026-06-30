// Cloudflare Worker: CORS-Proxy für Admin-Zugriff auf Nextcloud-WebDAV.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Create Worker ->
// diesen Code einfügen -> Deploy.
// Worker-Name: trainervertrag (URL: trainervertrag.michel-brunner.workers.dev)
//
// Dieser Worker ist nur für GET/PUT des Admin-Zugriffs (volle Lese-/Schreibrechte
// mit Nextcloud-Zugangsdaten, die der Admin im Connect-Formular eingibt).
// Trainer-Einreichungen laufen über submit-worker.js (separater Worker).

const ALLOWED_ORIGINS = [
  "http://localhost:8769",
  "https://tecko1985.github.io"
];
const ALLOWED_TARGET_PREFIX = "https://nx88695.your-storageshare.de/";

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET" && request.method !== "PUT") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const targetUrl = new URL(request.url).searchParams.get("url");
    if (!targetUrl || !targetUrl.startsWith(ALLOWED_TARGET_PREFIX)) {
      return new Response("Invalid or missing url parameter", { status: 400, headers: corsHeaders });
    }

    const init = { method: request.method, headers: {} };
    const auth = request.headers.get("Authorization");
    if (auth) init.headers["Authorization"] = auth;
    const contentType = request.headers.get("Content-Type");
    if (contentType) init.headers["Content-Type"] = contentType;
    if (request.method === "PUT") {
      init.body = await request.arrayBuffer();
    }

    const upstreamResp = await fetch(targetUrl, init);
    const respBody = await upstreamResp.arrayBuffer();

    return new Response(respBody, {
      status: upstreamResp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstreamResp.headers.get("Content-Type") || "application/octet-stream"
      }
    });
  }
};
