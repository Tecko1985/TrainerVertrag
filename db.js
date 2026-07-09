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
// TrainerCheckliste — Token liegt im localStorage der Origin tecko1985.github.io
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

function davAuthHeader(config) {
  return "Basic " + btoa(unescape(encodeURIComponent(config.username + ":" + config.password)));
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
    headers: { Authorization: davAuthHeader(config) }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`WebDAV-Lesefehler (HTTP ${resp.status})`);
  const text = await resp.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function davWriteFile(config, dataObj) {
  const resp = await fetch(davRequestUrl(config), {
    method: "PUT",
    headers: {
      Authorization: davAuthHeader(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dataObj, null, 2)
  });
  if (!resp.ok) throw new Error(`WebDAV-Schreibfehler (HTTP ${resp.status})`);
}

// ─── Binärdateien (Admin: Führerschein/Führungszeugnis ansehen/hochladen) ──────────
// Läuft über denselben CORS-Proxy wie davReadFile/davWriteFile — der ist bereits
// Content-Type-transparent, nur die JSON-(De-)Serialisierung wird hier übersprungen.
async function davReadBinary(config) {
  const resp = await fetch(davRequestUrl(config), {
    method: "GET",
    headers: { Authorization: davAuthHeader(config) }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`WebDAV-Lesefehler (HTTP ${resp.status})`);
  return resp.blob();
}

async function davWriteBinary(config, blob, contentType) {
  const doPut = () => fetch(davRequestUrl(config), {
    method: "PUT",
    headers: { Authorization: davAuthHeader(config), "Content-Type": contentType || "application/octet-stream" },
    body: blob
  });
  let resp = await doPut();
  // 404/409 = der Unterordner (fuehrerscheine/fuehrungszeugnisse) fehlt noch -> anlegen und EINMAL wiederholen.
  if (resp.status === 404 || resp.status === 409) {
    const dirUrl = config.url.slice(0, config.url.lastIndexOf("/"));
    const mk = await fetch(davRequestUrl({ ...config, url: dirUrl }), {
      method: "MKCOL",
      headers: { Authorization: davAuthHeader(config) }
    });
    if (mk.status !== 201 && mk.status !== 405 && mk.status !== 409) {
      throw new Error(`Ordner anlegen fehlgeschlagen (MKCOL ${mk.status})`);
    }
    resp = await doPut();
  }
  if (!resp.ok) throw new Error(`WebDAV-Schreibfehler (HTTP ${resp.status})`);
}
