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
