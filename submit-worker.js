// Cloudflare Worker: Trainer-Einreichungs-Endpunkt.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Worker "trainerdaten1"
// (URL: trainerdaten1.michel-brunner.workers.dev) -> diesen Code einfügen -> Deploy.
// NICHT zu verwechseln mit dem Worker "trainerdaten" (ohne "1") — das ist der
// separate cors-proxy-worker.js für den Admin-Modus, unbetroffen von diesem Code.
//
// NACH dem Deploy folgende Worker-Secrets in den Cloudflare-Einstellungen setzen
// (Workers -> trainerdaten1 -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL       = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Trainerdaten/trainerdaten.json
//   NEXTCLOUD_USERNAME  = admin
//   NEXTCLOUD_PASSWORD  = <App-Passwort aus Nextcloud>
//
// Der Worker schreibt KEIN Passwort in den Code — Credentials kommen ausschließlich
// aus den Worker-Secrets (verschlüsselt, nicht im Repo sichtbar).
//
// SEIT 1.6: Trainer müssen über das zentrale ToolsUebersicht-Konto angemeldet sein
// (Bearer-Token im Authorization-Header). Der Worker verifiziert das Token NICHT
// selbst, sondern delegiert an den landingpage-Worker (Aktion "me") — dafür ist
// ein SERVICE BINDING nötig (Dashboard -> Worker "trainerdaten1" -> Settings ->
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
//
// SEIT 1.1 (Dokumente, migriert aus Fahrtenbuch + neu Führungszeugnis):
//   { action: "upload-fuehrerschein", contentType, dataBase64, dateiName?, vorname?, nachname? }
//   { action: "upload-fuehrungszeugnis", contentType, dataBase64, dateiName?, vorname?, nachname? }
//     -> legt/ersetzt die EIGENE Datei ab (Eigentümer = verifizierter Nutzername, wie
//     bei "submit"); vorname/nachname optional fürs Stub-Matching, falls das Haupt-
//     formular noch nie ausgefüllt wurde -> { success:true, id }
//   { action: "my-fuehrerschein-file" }             -> rohe Datei-Bytes | 404
//   { action: "my-fuehrungszeugnis-file" }          -> rohe Datei-Bytes | 404
//     (seit 1.2: Trainer dürfen ihr eigenes Führungszeugnis jetzt auch selbst
//     ansehen — vorher gab es hierfür bewusst keine Aktion, siehe [[project-trainerdaten]])
//   { action: "list-fuehrerscheine" }  (Admin ODER Gruppe fuehrerschein-einsicht)
//     -> { trainer: [{id,vorname,nachname,fuehrerscheinHochgeladenAm}] }
//   { action: "fuehrerschein-file-for-owner", trainerId }  (Admin ODER Gruppe fuehrerschein-einsicht)
//     -> rohe Datei-Bytes | 404
//   { action: "fuehrungszeugnis-file-for-owner", trainerId }  (NUR Admin, siehe Datei-Kopf)
//     -> rohe Datei-Bytes | 404 -- von Personalakte genutzt (direkter "Führungszeugnis öffnen"-Button)
//
// SEIT 1.1 (Trainerlizenz-Dokument, gleiches Muster wie Führerschein/Führungszeugnis):
//   { action: "upload-trainerlizenz", contentType, dataBase64, dateiName?, vorname?, nachname? }
//   { action: "my-trainerlizenz-file" }             -> rohe Datei-Bytes | 404
//   { action: "trainerlizenz-file-for-owner", trainerId }  (NUR Admin, wie Führungszeugnis --
//     keine eigene Sichtgruppe angefragt) -> rohe Datei-Bytes | 404 -- von Personalakte genutzt
//
// SEIT 1.4 (Trainer-Selbstauskunft "keine Trainerlizenz vorhanden"):
//   { action: "set-trainerlizenz-keine", nichtVorhanden, vorname?, nachname? }
//     -> setzt/löscht trainerlizenzNichtVorhanden auf dem EIGENEN Datensatz (gleiches
//     Stub-Matching wie bei den Uploads) -> { success:true, trainerlizenzNichtVorhanden }
//     Ein tatsächlicher upload-trainerlizenz setzt das Flag serverseitig automatisch
//     wieder zurück (widersprüchlicher Zustand sonst möglich).
//
// SEIT 1.6 (Import): Der Admin-Text-Import kann für Namen ohne Konto-Treffer einen
// unvollständigen Stub-Datensatz anlegen (nur vorname/nachname/lizenz/pauschale,
// KEIN username-Feld). Meldet sich diese Person später selbst an, findet
// handleSubmit() unten keinen Treffer per username, sucht darum zusätzlich per
// exaktem Namensabgleich unter den username-losen Stubs und ergänzt den
// gefundenen Datensatz (Lizenz/Pauschale bleiben erhalten) statt einen zweiten
// anzulegen. Kein Treffer -> normales Neuanlegen wie zuvor.

const ALLOWED_ORIGINS = [
  "http://localhost:8769",
  "http://localhost:8783", // Personalakte (Dev-Server) -- ruft fuehrerschein-/fuehrungszeugnis-file-for-owner direkt hier ab
  "https://tecko1985.github.io"
];

// Dokument-Uploads (seit 1.1, Führerschein migriert aus Fahrtenbuch + neu Führungszeugnis):
// je Trainer-id (nicht username, siehe [[project-trainerdaten]] — Stub-Trainer aus dem
// Personalkosten-Import haben keinen username) genau eine Datei je Typ, Re-Upload
// überschreibt. Ablage in Geschwister-Unterordnern von trainerdaten.json.
const DOCUMENT_TYPES = {
  fuehrerschein: {
    subdir: "fuehrerscheine",
    uploadedAtField: "fuehrerscheinHochgeladenAm",
    nameField: "fuehrerscheinDateiName",
    ctypeField: "fuehrerscheinContentType"
  },
  fuehrungszeugnis: {
    subdir: "fuehrungszeugnisse",
    uploadedAtField: "fuehrungszeugnisEingereichtAm",
    nameField: "fuehrungszeugnisDateiName",
    ctypeField: "fuehrungszeugnisContentType"
  },
  trainerlizenz: {
    subdir: "trainerlizenzen",
    uploadedAtField: "trainerlizenzHochgeladenAm",
    nameField: "trainerlizenzDateiName",
    ctypeField: "trainerlizenzContentType"
  }
};
// Muss zum Client-Cap MAX_FILE_BYTES in config.js passen (gleiche Duplizierungs-
// Konvention wie im migrierten Fahrtenbuch-Feature).
const DOC_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Gruppe, deren Mitglieder (plus Admin) alle eingereichten Führerschein-Kopien im
// Register einsehen dürfen — dieselbe Gruppe, die vorher im Fahrtenbuch galt.
const FS_VIEW_GROUP_ID = "fuehrerschein-einsicht";

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Nextcloud-Verzeichnis, das trainerdaten.json enthält — Dokument-Unterordner liegen
// als Geschwister direkt daneben.
function trainerdatenDir(env) {
  return env.NEXTCLOUD_URL.slice(0, env.NEXTCLOUD_URL.lastIndexOf("/"));
}

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
    if (body.action === "upload-fuehrerschein") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrerschein);
    }
    if (body.action === "upload-fuehrungszeugnis") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrungszeugnis);
    }
    if (body.action === "my-fuehrerschein-file") {
      return handleMyFuehrerscheinFile(session, env, corsHeaders);
    }
    if (body.action === "my-fuehrungszeugnis-file") {
      return handleMyFuehrungszeugnisFile(session, env, corsHeaders);
    }
    if (body.action === "list-fuehrerscheine") {
      return handleListFuehrerscheine(session, env, corsHeaders);
    }
    if (body.action === "fuehrerschein-file-for-owner") {
      return handleFuehrerscheinFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "fuehrungszeugnis-file-for-owner") {
      return handleFuehrungszeugnisFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "upload-trainerlizenz") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.trainerlizenz);
    }
    if (body.action === "my-trainerlizenz-file") {
      return handleMyTrainerlizenzFile(session, env, corsHeaders);
    }
    if (body.action === "trainerlizenz-file-for-owner") {
      return handleTrainerlizenzFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "set-trainerlizenz-keine") {
      return handleSetTrainerlizenzKeine(body, session, env, corsHeaders);
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
    return {
      username: me.username,
      vorname: me.vorname || null,
      nachname: me.nachname || null,
      isAdmin: !!me.isAdmin,
      groupIds: Array.isArray(me.groupIds) ? me.groupIds : []
    };
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
  for (const field of ["vorname", "nachname", "iban", "nebentaetigkeit"]) {
    if (!body[field] || !String(body[field]).trim()) {
      return json({ error: `Pflichtfeld fehlt: ${field}` }, 400, corsHeaders);
    }
  }
  if (body.nebentaetigkeit === "andere" && !String(body.nebentaetigkeitBetrag || "").trim()) {
    return json({ error: "Pflichtfeld fehlt: nebentaetigkeitBetrag" }, 400, corsHeaders);
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
    // Anlage 1 (§3 Nr.26 EStG): nur die beiden erlaubten Werte durchlassen
    nebentaetigkeit: (body.nebentaetigkeit === "keine" || body.nebentaetigkeit === "andere")
      ? body.nebentaetigkeit : "",
    nebentaetigkeitBetrag: String(body.nebentaetigkeitBetrag || "").trim(),
    // Nur echte PNG-DataURLs durchlassen
    signatureDataUrl: (typeof body.signatureDataUrl === "string" &&
                       /^data:image\/png;base64,/.test(body.signatureDataUrl))
      ? body.signatureDataUrl : ""
  };

  // Upsert per verifiziertem Nutzernamen (nicht per client-gemeldeter id) — pro
  // Konto gibt es damit immer genau einen Datensatz, ein erneutes Absenden
  // aktualisiert ihn statt einen zweiten anzulegen.
  let existingIdx = appData.trainer.findIndex(t => t.username === session.username);

  // Kein Konto-Treffer? Dann nach einem unvollständigen Stub-Datensatz aus dem
  // Admin-Text-Import suchen (kein username gesetzt) — exakter Namensabgleich,
  // bewusst ohne den fuzzy Nachname-Fallback aus dem Client-Import, um nicht
  // versehentlich in den Datensatz einer anderen Person zu schreiben. Treffer
  // wird ergänzt (behält Lizenz/Pauschale aus dem Import) statt dupliziert.
  if (existingIdx === -1) {
    const nl = (fields.vorname + " " + fields.nachname).toLowerCase();
    existingIdx = appData.trainer.findIndex(t =>
      !t.username && `${t.vorname || ""} ${t.nachname || ""}`.toLowerCase() === nl
    );
  }

  // "Eingereicht" (admin-seitig angezeigtes Datum) heißt: es liegt eine echte
  // Unterschrift vor — nicht bloß "Datensatz existiert" oder "wurde bearbeitet".
  // Ein Import-Stub oder ein Submit ohne Signatur bekommt daher kein Datum;
  // eine bereits vorhandene Signaturzeit wird bei leerer Signatur nicht gelöscht.
  const nowIso = new Date().toISOString();
  const unterschriftPatch = fields.signatureDataUrl ? { unterschriftAm: nowIso } : {};

  let resultId;
  if (existingIdx !== -1) {
    appData.trainer[existingIdx] = {
      ...appData.trainer[existingIdx],
      ...fields,
      username: session.username,
      // Daten haben sich möglicherweise geändert — ein bereits erzeugter Vertrag ist damit veraltet.
      vertragsGeneriert: false,
      // Ein evtl. manuell gesetzter/eingefrorener Status-Override (Admin-Detail bzw.
      // "Vertrag generieren") wird bei einer neuen Einreichung zurückgesetzt, sonst
      // bliebe z.B. "generiert" stehen und der veraltete Vertrag fiele nie auf —
      // leer = automatische Ableitung greift wieder (Badge "Ausstehend").
      status: "",
      ...unterschriftPatch
    };
    resultId = appData.trainer[existingIdx].id;
  } else {
    const newEntry = {
      id: crypto.randomUUID(),
      username: session.username,
      ...fields,
      erstelltAm: nowIso,
      vertragsGeneriert: false,
      ...unterschriftPatch
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

// Eigenen Trainer-Datensatz per verifiziertem Nutzernamen finden. Ohne Treffer (und
// falls vorname/nachname mitgeschickt werden) zusätzlich ein unvollständiger Stub aus
// dem Personalkosten-Import per exaktem Namensabgleich versucht (gleiche Konvention
// wie handleSubmit oben) — verhindert einen doppelten Datensatz, falls ein Trainer ein
// Dokument hochlädt, bevor er das Hauptformular ausgefüllt hat. Ohne Treffer wird ein
// neuer Minimal-Datensatz angelegt. Gibt { idx } zurück, idx zeigt in appData.trainer.
function resolveOwnTrainerRecord(appData, session, vorname, nachname) {
  let idx = appData.trainer.findIndex(t => t.username === session.username);
  if (idx === -1 && vorname && nachname) {
    const nl = (vorname + " " + nachname).toLowerCase();
    idx = appData.trainer.findIndex(t =>
      !t.username && `${t.vorname || ""} ${t.nachname || ""}`.toLowerCase() === nl
    );
    // Stub aus dem Personalkosten-Import übernommen -> mit dem verifizierten
    // Nutzernamen verknüpfen (wie handleSubmit), sonst finden my-fuehrerschein-file/
    // my-fuehrungszeugnis-file und my-submission (Suche per username) die gerade
    // hochgeladene Datei nie wieder, und beim nächsten Besuch fehlt der Doku-Status.
    if (idx !== -1) appData.trainer[idx].username = session.username;
  }
  if (idx !== -1) return { idx };
  const newEntry = {
    id: crypto.randomUUID(),
    username: session.username,
    vorname: vorname || "",
    nachname: nachname || "",
    erstelltAm: new Date().toISOString(),
    vertragsGeneriert: false
  };
  appData.trainer.push(newEntry);
  return { idx: appData.trainer.length - 1 };
}

// Lädt Führerschein ODER Führungszeugnis hoch (docType bestimmt Unterordner/Feldnamen).
// Eigentümer ist IMMER der verifizierte Nutzername (wie bei "submit") — nie aus dem
// Body vertraut. Datei wird als separates Binärobjekt neben trainerdaten.json abgelegt
// (nicht wie die Signatur inline in der JSON, da hier deutlich größere Scans/Fotos
// erwartet werden), nur die Metadaten landen in appData.trainer.
async function handleUploadDocument(body, session, env, corsHeaders, docType) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > DOC_MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const trainerId = appData.trainer[idx].id;

  const dir = trainerdatenDir(env) + "/" + docType.subdir;
  const fileUrl = dir + "/" + trainerId;
  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    // 404/409 = der Unterordner (fuehrerscheine/fuehrungszeugnisse) fehlt noch -> anlegen und EINMAL wiederholen.
    if (resp.status === 404 || resp.status === 409) {
      await fetch(dir, { method: "MKCOL", headers: { Authorization: authHeader } });
      resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    }
  } catch (e) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);

  const nowIso = new Date().toISOString();
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    [docType.uploadedAtField]: nowIso,
    [docType.nameField]: String(body.dateiName || "").trim().slice(0, 200),
    [docType.ctypeField]: ctype
  };
  // Ein tatsächlich hochgeladenes Dokument widerlegt ein zuvor gesetztes "Keine
  // Trainerlizenz vorhanden" — sonst blieben beide Zustände widersprüchlich gespeichert
  // (gleiche Logik wie im Admin-Detail, siehe [[project-trainerdaten]]).
  if (docType.uploadedAtField === "trainerlizenzHochgeladenAm") {
    appData.trainer[idx].trainerlizenzNichtVorhanden = false;
  }

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Datei gespeichert, aber Metadaten-Update fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, id: trainerId, [docType.uploadedAtField]: nowIso }, 200, corsHeaders);
}

// Trainer bestätigt/widerruft selbst "ich habe keine Trainerlizenz" — reine
// Selbstauskunft, kein Datei-Upload. Gleiches Stub-Matching wie handleUploadDocument
// (resolveOwnTrainerRecord), damit auch jemand ohne je ausgefülltes Hauptformular
// diese Checkbox setzen kann.
async function handleSetTrainerlizenzKeine(body, session, env, corsHeaders) {
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

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const nichtVorhanden = !!body.nichtVorhanden;
  appData.trainer[idx].trainerlizenzNichtVorhanden = nichtVorhanden;

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

  return json({ success: true, trainerlizenzNichtVorhanden: nichtVorhanden }, 200, corsHeaders);
}

// Eigene Führerschein-Datei abrufen (Trainer sieht immer nur seine eigene).
async function handleMyFuehrerscheinFile(session, env, corsHeaders) {
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
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.fuehrerscheinHochgeladenAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrerscheine/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.fuehrerscheinContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Eigene Führungszeugnis-Datei abrufen (Trainer sieht immer nur seine eigene),
// seit 1.2 -- vorher gab es hierfür bewusst keine Aktion (siehe CLAUDE.md).
async function handleMyFuehrungszeugnisFile(session, env, corsHeaders) {
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
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.fuehrungszeugnisEingereichtAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrungszeugnisse/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.fuehrungszeugnisContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Eigene Trainerlizenz-Datei abrufen (Trainer sieht immer nur seine eigene), analog
// zu handleMyFuehrerscheinFile.
async function handleMyTrainerlizenzFile(session, env, corsHeaders) {
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
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.trainerlizenzHochgeladenAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/trainerlizenzen/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.trainerlizenzContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Delegierte Sichtgruppe (natives Äquivalent zur früheren Fahrtenbuch-Gruppe): Admin
// ODER Mitglied von FS_VIEW_GROUP_ID dürfen alle Führerschein-Kopien einsehen — NICHT
// für Führungszeugnis (siehe Datei-Kopf, bewusste Sicherheitsentscheidung).
function mayViewAllFuehrerscheine(session) {
  return !!session.isAdmin || (session.groupIds || []).includes(FS_VIEW_GROUP_ID);
}

async function handleListFuehrerscheine(session, env, corsHeaders) {
  if (!mayViewAllFuehrerscheine(session)) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
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
  // Schmale Projektion — bewusst ohne IBAN/Adresse, gleiche Sichtbarkeit wie die
  // frühere Fahrtenbuch-Gruppe (nur Name + Führerschein-Status).
  const trainer = appData.trainer
    .filter(t => t.fuehrerscheinHochgeladenAm)
    .map(t => ({
      id: t.id, vorname: t.vorname || "", nachname: t.nachname || "",
      fuehrerscheinHochgeladenAm: t.fuehrerscheinHochgeladenAm,
      fuehrerscheinContentType: t.fuehrerscheinContentType || ""
    }));
  return json({ trainer }, 200, corsHeaders);
}

async function handleFuehrerscheinFileForOwner(body, session, env, corsHeaders) {
  if (!mayViewAllFuehrerscheine(session)) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
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
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.fuehrerscheinHochgeladenAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrerscheine/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.fuehrerscheinContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Führungszeugnis fuer einen beliebigen Trainer -- bewusst NUR Admin (keine
// Gruppe wie bei Führerschein, siehe Datei-Kopf/mayViewAllFuehrerscheine).
async function handleFuehrungszeugnisFileForOwner(body, session, env, corsHeaders) {
  if (!session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
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
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.fuehrungszeugnisEingereichtAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrungszeugnisse/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.fuehrungszeugnisContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Trainerlizenz fuer einen beliebigen Trainer -- bewusst NUR Admin (analog zu
// Führungszeugnis, keine eigene Sichtgruppe angefragt).
async function handleTrainerlizenzFileForOwner(body, session, env, corsHeaders) {
  if (!session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
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
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.trainerlizenzHochgeladenAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/trainerlizenzen/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.trainerlizenzContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
