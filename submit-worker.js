// Cloudflare Worker: Trainer-Einreichungs-Endpunkt.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Worker "trainervertrag1"
// (URL: trainervertrag1.michel-brunner.workers.dev) -> diesen Code einfügen -> Deploy.
// NICHT zu verwechseln mit dem Worker "trainervertrag" (ohne "1") — das ist der
// separate cors-proxy-worker.js für den Admin-Modus, unbetroffen von diesem Code.
//
// NACH dem Deploy folgende Worker-Secrets in den Cloudflare-Einstellungen setzen
// (Workers -> trainervertrag1 -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL       = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/TrainerVertrag/trainervertrag.json
//   NEXTCLOUD_USERNAME  = admin
//   NEXTCLOUD_PASSWORD  = <App-Passwort aus Nextcloud>
//
// Der Worker schreibt KEIN Passwort in den Code — Credentials kommen ausschließlich
// aus den Worker-Secrets (verschlüsselt, nicht im Repo sichtbar).
//
// SEIT 1.6: Trainer müssen über das zentrale ToolsUebersicht-Konto angemeldet sein
// (Bearer-Token im Authorization-Header). Der Worker verifiziert das Token NICHT
// selbst, sondern delegiert an den landingpage-Worker (Aktion "me") — dafür ist
// ein SERVICE BINDING nötig (Dashboard -> Worker "trainervertrag1" -> Settings ->
// Bindings -> Add binding -> Service binding -> Ziel-Worker "landingpage",
// Variablenname "LANDINGPAGE"). Ein normaler fetch() an die *.workers.dev-URL der
// Landingpage wird von Cloudflare mit Error 1042 geblockt, weil beide Worker
// dieselbe workers.dev-Subdomain teilen (sieht aus wie eine potenzielle
// Endlosschleife, ist aber keine) — Service Bindings umgehen das komplett.
//
// API (POST-Body: { action, ... }, Authorization: Bearer <tu_session_token>):
//   { action: "submit", vorname, nachname, ... }  -> legt/aktualisiert IMMER genau
//     den Datensatz des eingeloggten Kontos (Nutzername kommt server-verifiziert,
//     nicht vom Client) -> { success:true, id }
//   { action: "my-submission" }                    -> { data: eigenerDatensatzOderNull }

const ALLOWED_ORIGINS = [
  "http://localhost:8769",
  "https://tecko1985.github.io"
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.LANDINGPAGE) {
      return json({ error: "Service Binding 'LANDINGPAGE' fehlt (siehe Datei-Kopf)" }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungültiges JSON" }, 400, corsHeaders);
    }

    const session = await verifySession(env, request.headers.get("Authorization") || "");
    if (!session) {
      return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
    }

    if (body.action === "my-submission") {
      return handleMySubmission(session, env, corsHeaders);
    }
    if (body.action === "submit") {
      return handleSubmit(body, session, env, corsHeaders);
    }
    return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
  }
};

// Delegiert die Token-Prüfung an den landingpage-Worker (Aktion "me") statt sie
// hier zu duplizieren — bei Netzfehler oder abgelehntem Token sicher zu (kein Zugriff).
async function verifySession(env, authHeader) {
  if (!authHeader) return null;
  try {
    const resp = await env.LANDINGPAGE.fetch("https://landingpage/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ action: "me" })
    });
    if (!resp.ok) return null;
    const me = await resp.json();
    if (!me || typeof me.username !== "string" || !me.username) return null;
    return { username: me.username, vorname: me.vorname || null, nachname: me.nachname || null };
  } catch (_) {
    return null;
  }
}

async function loadAppData(env, authHeader) {
  let appData = { version: 1, trainer: [] };
  let getResp;
  try {
    getResp = await fetch(env.NEXTCLOUD_URL, {
      method: "GET",
      headers: { Authorization: authHeader }
    });
  } catch (e) {
    throw new NextcloudError("Nextcloud nicht erreichbar — bitte später erneut versuchen");
  }
  if (getResp.status !== 404) {
    if (!getResp.ok) {
      throw new NextcloudError(`Nextcloud-Lesefehler (HTTP ${getResp.status}) — bitte später erneut versuchen`);
    }
    const text = await getResp.text();
    if (text.trim()) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        throw new NextcloudError("Bestandsdatei ist beschädigt — Einreichung abgebrochen, bitte Admin informieren");
      }
      if (!parsed || !Array.isArray(parsed.trainer)) {
        throw new NextcloudError("Bestandsdatei hat ein unerwartetes Format — Einreichung abgebrochen, bitte Admin informieren");
      }
      appData = parsed;
    }
  }
  return appData;
}

class NextcloudError extends Error {}

async function handleMySubmission(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const mine = appData.trainer.find(t => t.username === session.username) || null;
  return json({ data: mine }, 200, corsHeaders);
}

async function handleSubmit(body, session, env, corsHeaders) {
  // Pflichtfelder prüfen
  for (const field of ["vorname", "nachname", "iban"]) {
    if (!body[field] || !String(body[field]).trim()) {
      return json({ error: `Pflichtfeld fehlt: ${field}` }, 400, corsHeaders);
    }
  }

  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  // Aktuelle Datei laden. NUR 404 (noch nicht vorhanden) oder leere Datei
  // bedeuten "neue Liste" — jeder andere Fehler bricht ab, sonst würde der
  // PUT unten den kompletten Bestand mit nur dem neuen Eintrag überschreiben.
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const fields = {
    vorname:      String(body.vorname  || "").trim(),
    nachname:     String(body.nachname || "").trim(),
    geburtsdatum: String(body.geburtsdatum || ""),
    strasse:      String(body.strasse  || "").trim(),
    plz:          String(body.plz      || "").trim(),
    ort:          String(body.ort      || "").trim(),
    telefon:      String(body.telefon  || "").trim(),
    email:        String(body.email    || "").trim().toLowerCase(),
    iban:         String(body.iban     || "").replace(/\s+/g, "").toUpperCase(),
    bankname:     String(body.bankname || "").trim(),
    bic:          String(body.bic      || "").trim().toUpperCase(),
    // Nur echte PNG-DataURLs durchlassen
    signatureDataUrl: (typeof body.signatureDataUrl === "string" &&
                       /^data:image\/png;base64,/.test(body.signatureDataUrl))
      ? body.signatureDataUrl : ""
  };

  // Upsert per verifiziertem Nutzernamen (nicht per client-gemeldeter id) — pro
  // Konto gibt es damit immer genau einen Datensatz, ein erneutes Absenden
  // aktualisiert ihn statt einen zweiten anzulegen.
  const existingIdx = appData.trainer.findIndex(t => t.username === session.username);

  let resultId;
  if (existingIdx !== -1) {
    appData.trainer[existingIdx] = {
      ...appData.trainer[existingIdx],
      ...fields,
      username: session.username,
      // Daten haben sich möglicherweise geändert — ein bereits erzeugter Vertrag ist damit veraltet.
      vertragsGeneriert: false
    };
    resultId = appData.trainer[existingIdx].id;
  } else {
    const newEntry = {
      id: crypto.randomUUID(),
      username: session.username,
      ...fields,
      erstelltAm: new Date().toISOString(),
      vertragsGeneriert: false
    };
    appData.trainer.push(newEntry);
    resultId = newEntry.id;
  }

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, id: resultId }, 201, corsHeaders);
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
