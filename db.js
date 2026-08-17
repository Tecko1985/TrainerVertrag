// WebDAV-Persistenz (Admin-Modus) + IndexedDB-Helfer für Admin-Zugangsdaten.
// Adaptiert aus E:\TrainerCheckliste\db.js — gleiche Architektur, anderer DB-Name.
const FileStore = (() => {
  const DB_NAME = "trainerdaten-db";
  const STORE = "handles";
  const KEY_WEBDAV_CONFIG = "webdavConfig";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getValue(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function setValue(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearValue(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    getWebdavConfig: () => getValue(KEY_WEBDAV_CONFIG),
    setWebdavConfig: (cfg) => setValue(KEY_WEBDAV_CONFIG, cfg),
    clearWebdavConfig: () => clearValue(KEY_WEBDAV_CONFIG)
  };
})();

// ─── ToolsUebersicht-Login-Gateway (Trainer-Modus) ─────────────────────────────
// Trainer melden sich seit 1.6 über das zentrale ToolsUebersicht-Konto an (statt
// eines anonymen No-Login-Formulars). Gleiches Token-Muster wie bei Trainerkodex/
// TrainerCheckliste — Token liegt im localStorage der Origin sc1911heiligenstadt.github.io
// und wird hier nur gelesen, nicht selbst per Login-Formular gesetzt (Login läuft
// komplett über die ToolsUebersicht-Seite selbst, siehe Connect-Screen in app.js).
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Gateway-Fehler (HTTP ${resp.status})`);
  return resp.json();
}

// Liefert {username, isAdmin, groupIds, vorname, nachname} der eingeloggten Person.
async function fetchMe() {
  return gatewayRequest({ action: "me" });
}

// Zentrales Trainerprofil (Lizenz + Mannschaften) ALLER Nutzer — für das Vorbefüllen
// der Lizenz im Admin-Detail (Namensabgleich, siehe _matchTrainer()-Konvention in app.js).
async function fetchTrainerProfiles() {
  const body = await gatewayRequest({ action: "list-trainer-profiles" });
  return Array.isArray(body.profiles) ? body.profiles : [];
}

// Trainer-Selbstbedienungs-Pendant zum Admin-only TrainerCheckliste-Status
// (dort per WebDAV, siehe _loadTrainerCheckliste in app.js) -- hier per Gateway,
// da der Trainer keine WebDAV-Credentials hat. Der Worker verengt serverseitig
// auf den eigenen Eintrag (Minimal-Disclosure), siehe admin-worker.js.
async function fetchMyChecklisteStatus() {
  return gatewayRequest({ action: "my-trainercheckliste-status" });
}

// Fragt beim submit-worker die eigene, bereits eingereichte Erfassung ab (falls
// vorhanden) — der Worker verifiziert den Token serverseitig selbst (Service
// Binding zum landingpage-Worker), das hier mitgeschickte Token ist nur der
// Transport, keine vertrauenswürdige Client-Behauptung.
async function fetchMySubmission() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "my-submission" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Serverfehler (HTTP ${resp.status})`);
  const body = await resp.json();
  return body.data || null;
}

// Sendet die Formulardaten an den submit-worker. Der Nutzername wird NICHT vom
// Client mitgeschickt — der Worker ermittelt ihn selbst aus dem verifizierten
// Token und legt/aktualisiert damit immer genau den eigenen Trainer-Datensatz.
async function submitTrainerData(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "submit", ...payload })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// ─── Dokument-Uploads (Führerschein/Führungszeugnis, Trainer-Selbstbedienung) ──────
// Base64-Kodierung wie beim migrierten Fahrtenbuch-Vorbild: FileReader.readAsDataURL,
// dann den "data:...;base64,"-Präfix abschneiden.
function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}

// docType: "fuehrerschein" | "fuehrungszeugnis" | "trainerlizenz". vorname/nachname optional, dienen
// nur dem serverseitigen Stub-Matching, falls das Hauptformular noch nie ausgefüllt wurde.
async function submitDocument(docType, file, vorname, nachname) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Datei ist zu groß (max. " + Math.round(MAX_FILE_BYTES / 1024 / 1024) + " MB).");
  }
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const dataBase64 = await _blobToBase64(file);
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      action: "upload-" + docType,
      contentType: file.type || "application/octet-stream",
      dateiName: file.name,
      vorname: vorname || "",
      nachname: nachname || "",
      dataBase64
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Trainer setzt/aktualisiert seine Trainerlizenz-Metadaten (kein Datei-Upload): ob
// keine Lizenz vorhanden ist, Lizenzart und Gültigkeitsdatum — immer alle drei
// zusammen (kein Teil-Update), analog zu submitDocument (gleiches Stub-Matching
// server-seitig über vorname/nachname).
async function setTrainerlizenzDetails(details, vorname, nachname) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      action: "set-trainerlizenz-details",
      nichtVorhanden: !!details.nichtVorhanden,
      art: details.art || "",
      gueltigBis: details.gueltigBis || "",
      vorname: vorname || "",
      nachname: nachname || ""
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Trainer bestätigt den Kodex (Name kommt aus dem bereits bekannten Konto, nur die
// Signatur ist neu) — analog zu submitDocument/setTrainerlizenzDetails (gleiches
// Stub-Matching server-seitig über vorname/nachname).
async function submitKodex(signatureDataUrl, vorname, nachname) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      action: "submit-kodex",
      signatureDataUrl,
      vorname: vorname || "",
      nachname: nachname || ""
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Trainer bestätigt das Jugendschutzkonzept -- 1:1 gleiches Muster wie submitKodex()
// (eigenständige Aktion, eigenes Dokument, gleiches Stub-Matching server-seitig).
async function submitJugendschutzkonzept(signatureDataUrl, vorname, nachname) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      action: "submit-jugendschutzkonzept",
      signatureDataUrl,
      vorname: vorname || "",
      nachname: nachname || ""
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Eigene Führerschein-Datei als Blob holen (für "Ansehen").
async function fetchMyFuehrerscheinBlob() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "my-fuehrerschein-file" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Datei nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// Eigene Führungszeugnis-Datei als Blob holen (für "Ansehen"), seit 1.2 -- vorher
// bewusst keine Entsprechung (nur Admin durfte ansehen), siehe CLAUDE.md.
async function fetchMyFuehrungszeugnisBlob() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "my-fuehrungszeugnis-file" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Datei nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// Eigene Trainerlizenz-Datei als Blob holen (für "Ansehen"), analog zu
// fetchMyFuehrerscheinBlob.
async function fetchMyTrainerlizenzBlob() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "my-trainerlizenz-file" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Datei nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// Eigenes Trainervertrags-PDF als Blob holen (für "Ansehen"): signed=false liefert das
// vom Skript bereitgestellte Original, signed=true das selbst unterschriebene PDF.
async function fetchMyVertragBlob(signed) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: signed ? "my-vertrag-signiert-file" : "my-vertrag-file" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Vertrag nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// Fertig unterschriebenes Vertrags-PDF hochladen (Original + im Browser angehängte
// Unterschriftenseite, gebaut in buildSignedVertragPdf/pdf-utils.js). Der Nutzer wird
// serverseitig aus dem Token ermittelt; signatureDataUrl ist nur die kleine Vorschau
// fürs Admin-Detail (die eigentliche Unterschrift steckt bereits im PDF).
// Die Unterschrift selbst wird NICHT mitgeschickt: sie steckt bereits im signierten PDF
// (buildSignedVertragPdf rendert sie hinein). Bis 1.33 landete sie zusätzlich als
// vertragSignatureDataUrl im Datensatz -- ein Feld, das nachweislich nie jemand gelesen
// hat und das mit ~50 KB je Unterschrift 99 % der trainerdaten.json ausmachte.
async function submitVertragUnterschrift(signedPdfBlob) {
  if (signedPdfBlob.size > MAX_FILE_BYTES) {
    throw new Error("PDF ist zu groß (max. " + Math.round(MAX_FILE_BYTES / 1024 / 1024) + " MB).");
  }
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const dataBase64 = await _blobToBase64(signedPdfBlob);
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      action: "submit-vertrag-unterschrift",
      dataBase64
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Führerschein-Register für Admin/Gruppe "fuehrerschein-einsicht" — der Worker prüft
// die Berechtigung serverseitig erneut, hier nur UI-seitiges Ein-/Ausblenden.
async function fetchFuehrerscheinRegister() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "list-fuehrerscheine" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) return null; // nicht berechtigt -> Panel bleibt einfach verborgen
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data.trainer) ? data.trainer : [];
}

async function fetchFuehrerscheinFileForOwner(trainerId) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "fuehrerschein-file-for-owner", trainerId })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Datei nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// ─── Downloadbereich (seit 1.5) ───────────────────────────────────────────────

// Alles, was der Tab „Downloads“ zum Zeichnen braucht, in einem Request: die
// Dateiliste, ob für mich ein Bestätigungsschreiben freigegeben ist und welche
// meiner eigenen Angaben dafür noch fehlen.
async function fetchMyDownloads() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "my-downloads" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Serverfehler (HTTP ${resp.status})`);
  return data;
}

// Eine bereitgestellte Datei als Blob holen. Der Worker prüft, dass die id
// wirklich in der Liste steht — hier wird nichts vorab gefiltert.
async function fetchDownloadDatei(id) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "download-datei", id })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error(`Datei nicht abrufbar (HTTP ${resp.status})`);
  return resp.blob();
}

// Inhalte für das Bestätigungsschreiben (nur für Freigegebene, einziger Weg zum
// Stempelbild). Der Worker antwortet mit 409 und einem sprechenden Text, wenn
// eigene Angaben oder die Vereinsseite unvollständig sind — deshalb wird die
// Server-Meldung hier durchgereicht statt durch eine eigene ersetzt.
async function fetchEfzBriefDaten() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "efz-brief-daten" })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Serverfehler (HTTP ${resp.status})`);
  return data;
}

// Meldung ans Handy der freigegebenen Person. Läuft über den submit-worker, weil
// nur der den Empfänger im Datensatz nachschlagen darf — der Client schickt die
// Trainer-id, nie einen Nutzernamen.
async function sendeEfzPush(trainerId) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(SUBMIT_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "efz-push", trainerId })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Seit dem Rechte-Umbau (2026-07-23) authentifizieren sich alle Admin-WebDAV-
// Zugriffe mit dem ToolsUebersicht-Login-Token: der CORS-Proxy prüft serverseitig
// Session + Administrieren-Stufe (canAdmin aus der Aktion check-edit-permission
// beim Gateway — seit der dritten Rechte-Stufe 2026-07-24 reicht das
// Bearbeiten-Häkchen nicht mehr, hier hängt der Vollzugriff inkl. IBAN dran) und
// hält die Nextcloud-Zugangsdaten selbst als Worker-Secrets. Ein App-Passwort
// gibt es im Client nicht mehr.
function davAuthHeader() {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  return "Bearer " + token;
}

// 401/403 stammen vom CORS-Proxy (Session tot bzw. keine Administrieren-Stufe),
// nicht von Nextcloud — mit sprechender Meldung statt rohem HTTP-Code.
function davHttpError(resp, verbLabel) {
  if (resp.status === 401) return new NotLoggedInError("Sitzung abgelaufen — bitte in der Tools-Übersicht neu anmelden.");
  if (resp.status === 403) return new Error("Kein Administrieren-Recht für Trainerdaten (Häkchen „Administrieren“ in der Tools-Übersicht nötig).");
  return new Error(`WebDAV-${verbLabel} (HTTP ${resp.status})`);
}

// Eigene Administrieren-Stufe für Trainerdaten — dieselbe Prüfung, die der
// CORS-Proxy serverseitig für jeden WebDAV-Zugriff macht (canAdmin, NICHT
// canEdit: am Admin-Modus hängt der Vollzugriff inkl. IBAN). Für den
// Admin-Einstieg (klare Meldung, bevor der erste Datei-Zugriff läuft).
async function checkTrainerdatenAdminPermission() {
  const body = await gatewayRequest({ action: "check-edit-permission", app: "trainerdaten" });
  return body.canAdmin === true;
}

function davRequestUrl(config) {
  if (config.proxyUrl) {
    return config.proxyUrl.replace(/\/$/, "") + "/?url=" + encodeURIComponent(config.url);
  }
  return config.url;
}

async function davReadFile(config) {
  const resp = await fetch(davRequestUrl(config), {
    method: "GET",
    headers: { Authorization: davAuthHeader() }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw davHttpError(resp, "Lesefehler");
  const text = await resp.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function davWriteFile(config, dataObj) {
  const resp = await fetch(davRequestUrl(config), {
    method: "PUT",
    headers: {
      Authorization: davAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dataObj, null, 2)
  });
  if (!resp.ok) throw davHttpError(resp, "Schreibfehler");
}

// Löscht ein Binärobjekt (z.B. eine ausgelagerte Unterschrift beim Zurücksetzen).
// 404 = schon weg, wird als Erfolg behandelt (idempotent). Der CORS-Proxy erlaubt
// DELETE (Methodenliste GET, PUT, DELETE, MKCOL).
async function davDeleteFile(config) {
  const resp = await fetch(davRequestUrl(config), {
    method: "DELETE",
    headers: { Authorization: davAuthHeader() }
  });
  if (!resp.ok && resp.status !== 404) throw davHttpError(resp, "Löschfehler");
}

// ─── Binärdateien (Admin: Führerschein/Führungszeugnis ansehen/hochladen) ──────────
// Läuft über denselben CORS-Proxy wie davReadFile/davWriteFile — der ist bereits
// Content-Type-transparent, nur die JSON-(De-)Serialisierung wird hier übersprungen.
// contentTypeOverride: die Dokument-Unterordner (fuehrerscheine/fuehrungszeugnisse/
// trainerlizenzen) speichern Dateien ohne Endung unter der Trainer-id, Nextcloud kann
// den Content-Type beim GET also nicht aus dem Dateinamen ableiten und liefert
// stattdessen application/octet-stream -- der Browser bietet das dann zum Download an,
// statt es anzuzeigen. submit-worker.js umgeht das bereits, indem es den bei Upload
// gespeicherten *ContentType-Feldwert des Trainer-Datensatzes bevorzugt (siehe
// mine.fuehrerscheinContentType || resp.headers.get("Content-Type") || ... dort) --
// gleiches Prinzip hier für den Admin-WebDAV-Pfad.
async function davReadBinary(config, contentTypeOverride) {
  const resp = await fetch(davRequestUrl(config), {
    method: "GET",
    headers: { Authorization: davAuthHeader() }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw davHttpError(resp, "Lesefehler");
  if (contentTypeOverride) {
    const buf = await resp.arrayBuffer();
    return new Blob([buf], { type: contentTypeOverride });
  }
  return resp.blob();
}

async function davWriteBinary(config, blob, contentType) {
  const doPut = () => fetch(davRequestUrl(config), {
    method: "PUT",
    headers: { Authorization: davAuthHeader(), "Content-Type": contentType || "application/octet-stream" },
    body: blob
  });
  let resp = await doPut();
  // 404/409 = der Unterordner (fuehrerscheine/fuehrungszeugnisse) fehlt noch -> anlegen und EINMAL wiederholen.
  if (resp.status === 404 || resp.status === 409) {
    const dirUrl = config.url.slice(0, config.url.lastIndexOf("/"));
    const mk = await fetch(davRequestUrl({ ...config, url: dirUrl }), {
      method: "MKCOL",
      headers: { Authorization: davAuthHeader() }
    });
    if (mk.status !== 201 && mk.status !== 405 && mk.status !== 409) {
      throw new Error(`Ordner anlegen fehlgeschlagen (MKCOL ${mk.status})`);
    }
    resp = await doPut();
  }
  if (!resp.ok) throw davHttpError(resp, "Schreibfehler");
}
