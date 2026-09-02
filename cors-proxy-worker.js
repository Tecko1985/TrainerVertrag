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
  "https://sc1911heiligenstadt.github.io",
  "https://tecko1985.github.io" // alte Adresse bis 2026-08: PWAs mit eigenem SW-Cache laufen dort noch
];
const ALLOWED_TARGET_HOST = "nx88695.your-storageshare.de";
// Dekodierte Pfade (02_Förderung mit echtem Umlaut): die Ziel-URL kommt je nach
// Client encoded (%C3%B6) oder roh an — verglichen wird deshalb immer die
// decodeURIComponent-Form des Pfads (siehe isAllowedTarget).
const TOOLS_BASIS =
  "/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/";

// ⚠️ Bis 2026-08-10 stand hier TOOLS_BASIS selbst als Präfix — also der GANZE
// Tools-Ordner. Darunter liegen 21 der 22 Dateien aus DAV_APPS: personalakte.json,
// spielerplus.json (Kadermanager), vereinskalender.json, schulsport.json und der
// Rest. Weil dieser Worker die Nextcloud-Zugangsdaten selbst injiziert und danach
// nur noch canAdmin für EIN Tool prüft, war das Administrieren-Häkchen bei
// Trainerdaten damit ein Lese- UND Schreibschlüssel für die Daten der halben
// Flotte, komplett am Rechtemodell des Gateways vorbei. Gefunden beim
// Flotten-Security-Audit am 2026-08-10.
//
// Der eigene Ordner bleibt als Präfix — darunter liegen neben trainerdaten.json
// die Unterordner unterschriften/, kodex-unterschriften/,
// jugendschutz-unterschriften/, fuehrerscheine/, fuehrungszeugnisse/,
// trainerlizenzen/ und die erzeugten Verträge, alle über
// davConfig.url.slice(0, lastIndexOf("/")) gebildet.
const ALLOWED_TARGET_PATH_PREFIX = TOOLS_BASIS + "Trainerdaten/";

// Die beiden Fremdquellen, die der Admin-Modus wirklich anspricht — beide nur
// LESEND (_cloneConfigForUrl + davReadFile, siehe Trainerdaten/app.js:3946 und
// :4276, Konstanten in Trainerdaten/config.js). Deshalb exakte Dateinamen statt
// eines Ordner-Präfixes und nur GET: ein PUT oder DELETE auf personalkosten.json
// war nie beabsichtigt und ist über diesen Weg jetzt auch nicht mehr möglich.
// Das sind genau die zwei "offenen Aufräumpunkte" aus ToolsUebersicht/CLAUDE.md;
// wer sie eines Tages auf dav-load umstellt, kann diese Menge leeren.
const ALLOWED_TARGET_READONLY_PATHS = new Set([
  TOOLS_BASIS + "Personalkosten/personalkosten.json",
  TOOLS_BASIS + "TrainerCheckin/trainercheckin.json"
]);

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
    if (!isAllowedTarget(targetUrl, request.method)) {
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

// Ziel-Prüfung: exakter Host + entweder ein Pfad im eigenen Trainerdaten-Ordner
// oder eine der beiden namentlich erlaubten Fremddateien, letztere nur lesend.
// Verglichen wird die decodeURIComponent-Form (02_F%C3%B6rderung und
// 02_Förderung meinen dieselbe Ressource); nicht parse-/dekodierbare URLs fallen
// durch (fail-closed).
//
// ⚠️ Gegen "../" schützt bereits new URL(): die WHATWG-Normalisierung räumt
// Punkt-Segmente weg, auch in der %2e-Schreibweise, und fetch() unten folgt
// derselben Regel — die geprüfte und die abgeschickte URL meinen also immer
// dieselbe Ressource. Das gilt aber nur, solange verglichen wird, was new URL()
// geliefert hat. Wer hier je auf den rohen String zurückgeht, reisst das auf.
//
// ⚠️ GENAU DAS WAR BIS 2026-08-15 DER FALL — mit einem KODIERTEN Trenner (%2F).
// new URL() zerlegt den Pfad an echten Schrägstrichen; ein %2F ist für die
// Normalisierung ein gewöhnliches Zeichen, die Punkt-Segmente dahinter bleiben
// also stehen. decodeURIComponent macht daraus danach echte Schrägstriche, und
// der Vergleich sieht einen Pfad, der brav mit …/Tools/Trainerdaten/ beginnt —
// während Zeile 132 den ROHEN String abschickt. Damit war die Verengung vom
// 2026-08-10 für GET, PUT, DELETE und MKCOL umgehbar:
//   …/Tools/Trainerdaten%2F..%2FPersonalakte%2Fpersonalakte.json
//     geprüft:    …/Tools/Trainerdaten/../Personalakte/personalakte.json  → erlaubt
//     abgeschickt: …/Tools/Trainerdaten%2F..%2FPersonalakte%2F…           → Traversal
// Der Testsatz vom 2026-08-10 deckte "../" und "%2e%2e" ab, beide fallen korrekt
// durch — die kodierte Trenner-Schreibweise stand nicht darin. Gefunden beim
// Flotten-Security-Audit am 2026-08-15.
//
// Behoben mit einer Abweisung VOR dem Dekodieren: kein legitimer Pfad dieser
// App trägt je einen kodierten Trenner (Nextcloud-Dateinamen können keinen
// Schrägstrich enthalten), die Prüfung kostet also nichts. Sie steht bewusst
// VOR decodeURIComponent — danach wäre der Unterschied zum echten Trenner weg.
// %5C ist mitgenommen, weil new URL() rohe Backslashes zu Schrägstrichen
// normalisiert, die kodierte Form aber stehen lässt.
const KODIERTER_TRENNER_RE = /%2f|%5c/i;

function isAllowedTarget(targetUrl, method) {
  if (!targetUrl) return false;
  let u;
  try { u = new URL(targetUrl); } catch (_) { return false; }
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_TARGET_HOST) return false;
  if (KODIERTER_TRENNER_RE.test(u.pathname)) return false;
  let path;
  try { path = decodeURIComponent(u.pathname); } catch (_) { return false; }
  if (path.startsWith(ALLOWED_TARGET_PATH_PREFIX)) return true;
  return method === "GET" && ALLOWED_TARGET_READONLY_PATHS.has(path);
}
