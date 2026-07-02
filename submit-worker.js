// Cloudflare Worker: Trainer-Einreichungs-Endpunkt ohne Login für Trainer.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Create Worker ->
// diesen Code einfügen -> Deploy.
// Worker-Name: trainervertrag-submit (URL: trainervertrag-submit.michel-brunner.workers.dev)
//
// NACH dem Deploy folgende Worker-Secrets in den Cloudflare-Einstellungen setzen
// (Workers -> trainervertrag-submit -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL       = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/TrainerVertrag/trainervertrag.json
//   NEXTCLOUD_USERNAME  = admin
//   NEXTCLOUD_PASSWORD  = <App-Passwort aus Nextcloud>
//
// Der Worker schreibt KEIN Passwort in den Code — Credentials kommen ausschließlich
// aus den Worker-Secrets (verschlüsselt, nicht im Repo sichtbar).

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
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungültiges JSON" }, 400, corsHeaders);
    }

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
    let appData = { version: 1, trainer: [] };
    let getResp;
    try {
      getResp = await fetch(env.NEXTCLOUD_URL, {
        method: "GET",
        headers: { Authorization: authHeader }
      });
    } catch (e) {
      return json({ error: "Nextcloud nicht erreichbar — bitte später erneut versuchen" }, 502, corsHeaders);
    }
    if (getResp.status !== 404) {
      if (!getResp.ok) {
        return json({ error: `Nextcloud-Lesefehler (HTTP ${getResp.status}) — bitte später erneut versuchen` }, 502, corsHeaders);
      }
      const text = await getResp.text();
      if (text.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          return json({ error: "Bestandsdatei ist beschädigt — Einreichung abgebrochen, bitte Admin informieren" }, 502, corsHeaders);
        }
        if (!parsed || !Array.isArray(parsed.trainer)) {
          return json({ error: "Bestandsdatei hat ein unerwartetes Format — Einreichung abgebrochen, bitte Admin informieren" }, 502, corsHeaders);
        }
        appData = parsed;
      }
    }

    const newEntry = {
      id: crypto.randomUUID(),
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
        ? body.signatureDataUrl : "",
      erstelltAm:       new Date().toISOString(),
      vertragsGeneriert: false
    };

    appData.trainer.push(newEntry);

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

    return json({ success: true, id: newEntry.id }, 201, corsHeaders);
  }
};

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
