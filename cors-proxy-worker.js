// Cloudflare Worker: WebDAV-Zugang für den Trainerdaten-Admin-Modus (und den
// IBAN-Lesepfad von Dokumentenvorlagen).
// Deployment: E:\ToolsUebersicht\deploy-worker.ps1 -Worker trainerdaten -Deploy
// Worker-Name: trainerdaten (URL: trainerdaten.michel-brunner.workers.dev)
//
// Seit dem Rechte-Umbau (2026-07-23) ist das App-Passwort im Client abgeschafft:
// Der Browser schickt den ToolsUebersicht-Login-Token (Bearer). Dieser Worker
// prüft per Service Binding "landingpage" (Aktion check-edit-permission), ob das
// Konto die Stufe ADMINISTRIEREN für Trainerdaten hat (canAdmin: Admin ODER
// Administrieren-Gruppe aus dem Sichtbarkeits-Panel — seit der dritten
// Rechte-Stufe vom 2026-07-24 reicht das Bearbeiten-Häkchen bewusst NICHT mehr,
// denn hier hängt der Vollzugriff inkl. IBAN dran), und spricht Nextcloud mit
// den eigenen Worker-Secrets NEXTCLOUD_USERNAME/NEXTCLOUD_PASSWORD an.
// Basic-Auth (das früher durchgereichte geteilte App-Passwort) wird nicht mehr
// akzeptiert.
//
// Ziel-URLs sind auf den Tools-Ordner der Vereins-Nextcloud beschränkt: weil der
// Worker eigene Zugangsdaten injiziert, wäre das Bearbeiter-Häkchen ohne diese
// Härtung ein Generalschlüssel für alles, was das Nextcloud-Konto sieht.
// Trainer-Einreichungen laufen weiterhin über submit-worker.js (separater Worker).

const ALLOWED_ORIGINS = [
  "http://localhost:8769",
  "http://localhost:8789",
  "https://tecko1985.github.io"
];
const ALLOWED_TARGET_HOST = "nx88695.your-storageshare.de";
// Dekodierter Pfad-Präfix (02_Förderung mit echtem Umlaut): die Ziel-URL kommt
// je nach Client encoded (%C3%B6) oder roh an — verglichen wird deshalb immer
// die decodeURIComponent-Form des Pfads (siehe isAllowedTarget).
const ALLOWED_TARGET_PATH_PREFIX =
  "/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, MKCOL, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!["GET", "PUT", "DELETE", "MKCOL"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const targetUrl = new URL(request.url).searchParams.get("url");
    if (!isAllowedTarget(targetUrl)) {
      return new Response("Invalid or missing url parameter", { status: 400, headers: corsHeaders });
    }

    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      // Trifft auch das frühere Basic (App-Passwort): dieser Weg ist abgeschaltet.
      return new Response("Anmeldung über die Tools-Übersicht erforderlich", { status: 401, headers: corsHeaders });
    }

    // Session + Administrieren-Stufe beim Gateway prüfen. Service Binding statt
    // fetch() auf die workers.dev-URL — Cloudflare blockt Worker-zu-Worker-fetch
    // auf derselben Subdomain mit Error 1042.
    let perm;
    try {
      const permResp = await env.landingpage.fetch("https://landingpage.internal/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: JSON.stringify({ action: "check-edit-permission", app: "trainerdaten" })
      });
      if (permResp.status === 401) {
        return new Response("Sitzung abgelaufen", { status: 401, headers: corsHeaders });
      }
      if (!permResp.ok) {
        return new Response("Rechtepruefung fehlgeschlagen (HTTP " + permResp.status + ")", { status: 502, headers: corsHeaders });
      }
      perm = await permResp.json();
    } catch (_) {
      return new Response("Rechtepruefung nicht erreichbar", { status: 502, headers: corsHeaders });
    }
    if (!perm || perm.canAdmin !== true) {
      return new Response("Kein Administrieren-Recht für Trainerdaten", { status: 403, headers: corsHeaders });
    }

    if (!env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
      return new Response("Worker-Secrets NEXTCLOUD_USERNAME/NEXTCLOUD_PASSWORD fehlen", { status: 500, headers: corsHeaders });
    }

    const init = { method: request.method, headers: {} };
    init.headers["Authorization"] =
      "Basic " + btoa(unescape(encodeURIComponent(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD)));
    const contentType = request.headers.get("Content-Type");
    if (contentType) init.headers["Content-Type"] = contentType;
    if (request.method === "PUT") {
      init.body = await request.arrayBuffer();
    }
    // DELETE/MKCOL haben keinen Body — nur GET/PUT (oben) senden einen mit.

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

// Ziel-Prüfung: exakter Host + Pfad unterhalb des Tools-Ordners. Verglichen wird
// die decodeURIComponent-Form (02_F%C3%B6rderung und 02_Förderung meinen dieselbe
// Ressource); nicht parse-/dekodierbare URLs fallen durch (fail-closed).
function isAllowedTarget(targetUrl) {
  if (!targetUrl) return false;
  let u;
  try { u = new URL(targetUrl); } catch (_) { return false; }
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_TARGET_HOST) return false;
  let path;
  try { path = decodeURIComponent(u.pathname); } catch (_) { return false; }
  return path.startsWith(ALLOWED_TARGET_PATH_PREFIX);
}
