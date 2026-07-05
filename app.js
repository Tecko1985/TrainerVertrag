// Hauptlogik: Trainer-Flow (Formular + Submit) und Admin-Flow (WebDAV, Liste, Detail, PDF).

// ─── State ───────────────────────────────────────────────────────────────────

let appData   = { version: 1, trainer: [] }; // Arbeitskopie im Admin-Modus
let davConfig = null;
let saveTid   = null;
let mode      = "trainer"; // "trainer" | "admin"
let activeAdminTab = "liste";
let currentTrainerId = null;

let trainerSigPad = null;
let myTrainerRecord = null; // eigene Einreichung, serverseitig per Login-Konto geladen
let currentUsername = null;
let currentVorname   = null;
let currentNachname  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;

  _renderChangelog();
  _initTrainerForm();
  _initAdminToggle();
  _initAdminConnect();
  _initAdminPanel();
  _initImport();
  _tryRestoreAdminSession();
  _initTrainerGateway();
});

// Trainer-Modus verlangt seit 1.6 ein Tools-Übersicht-Login (statt eines offenen
// No-Login-Formulars) — nur so lässt sich die eigene Einreichung serverseitig per
// Konto wiederfinden, geräte- und browserübergreifend (siehe [[project-trainervertrag]]).
async function _initTrainerGateway() {
  if (!getSessionToken()) {
    _showTrainerConnectScreen();
    return;
  }

  try {
    // fetchMe() und fetchMySubmission() sind unabhängige Worker-Aufrufe (beide
    // ermitteln den Nutzer serverseitig aus dem Bearer-Token) — parallel statt
    // seriell spart einen kompletten Roundtrip vorm ersten sichtbaren Inhalt.
    const [me, saved] = await Promise.all([fetchMe(), fetchMySubmission()]);
    currentUsername = me.username;
    currentVorname   = me.vorname || null;
    currentNachname  = me.nachname || null;

    if (saved) {
      myTrainerRecord = saved;
      _renderTrainerReceipt(myTrainerRecord);
      _showReceiptScreen({ justSubmitted: false });
    } else {
      _showTrainerFormScreen();
      document.getElementById("tf-vorname").value  = currentVorname  || "";
      document.getElementById("tf-nachname").value = currentNachname || "";
    }
    document.getElementById("tf-angemeldet-als").textContent =
      [currentVorname, currentNachname].filter(Boolean).join(" ") || currentUsername;
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      _showTrainerConnectScreen();
    } else {
      _showTrainerConnectScreen("Fehler beim Laden: " + e.message);
    }
  }
}

function _showTrainerConnectScreen(errorMsg) {
  document.getElementById("trainer-connect-screen").style.display = "";
  document.getElementById("trainer-form-screen").style.display = "none";
  document.getElementById("trainer-success-screen").style.display = "none";
  const err = document.getElementById("trainer-connect-error");
  err.style.display = errorMsg ? "block" : "none";
  err.textContent = errorMsg || "";
}

function _showTrainerFormScreen() {
  document.getElementById("trainer-connect-screen").style.display = "none";
  document.getElementById("trainer-form-screen").style.display = "";
  document.getElementById("trainer-success-screen").style.display = "none";
  // Canvas war bis eben in einem display:none-Screen, resize() konnte seine
  // reale Größe also noch nicht kennen (siehe signature-pad.js) -> jetzt nachholen.
  trainerSigPad.resize();
}

// ─── Changelog ────────────────────────────────────────────────────────────────

function _renderChangelog() {
  const el = document.getElementById("changelog-list");
  if (!el) return;
  el.innerHTML = APP_CHANGELOG.map(entry => `
    <div class="changelog-entry">
      <span class="cv">Version ${entry.version}</span>
      ${entry.groups.map(g => `
        <div class="changelog-group">
          <div class="cg-title">${g.title}</div>
          <ul class="cg-items">${g.items.map(i => `<li>${i}</li>`).join("")}</ul>
        </div>
      `).join("")}
    </div>
  `).join("");

  const b2 = document.getElementById("version-badge-2");
  if (b2) b2.textContent = "v" + APP_VERSION;
}

// ─── Trainer-Flow ─────────────────────────────────────────────────────────────

function _initTrainerForm() {
  const canvas = document.getElementById("trainer-sig-canvas");
  trainerSigPad = createSignaturePad(canvas, () => {});

  document.getElementById("btn-sig-clear").addEventListener("click", () => {
    trainerSigPad.clear();
  });

  document.getElementById("trainer-form").addEventListener("submit", _handleTrainerSubmit);

  document.getElementById("btn-trainer-edit").addEventListener("click", _startEditTrainer);

  // IBAN auto-formatieren (Leerzeichen alle 4 Stellen)
  const ibanInput = document.getElementById("tf-iban");
  ibanInput.addEventListener("input", () => {
    const raw = ibanInput.value.replace(/\s+/g, "").toUpperCase();
    const fmt = raw.replace(/(.{4})/g, "$1 ").trim();
    const pos = ibanInput.selectionStart;
    ibanInput.value = fmt;
    // Cursor-Position nach Formatierung anpassen
    const diff = fmt.length - raw.length;
    try { ibanInput.setSelectionRange(pos + diff, pos + diff); } catch (_) {}
  });
}

async function _handleTrainerSubmit(e) {
  e.preventDefault();
  _setTrainerError("");

  const vorname  = document.getElementById("tf-vorname").value.trim();
  const nachname = document.getElementById("tf-nachname").value.trim();
  const iban     = document.getElementById("tf-iban").value.replace(/\s+/g, "").toUpperCase();

  if (!vorname)  return _setTrainerError("Bitte Vorname eingeben.");
  if (!nachname) return _setTrainerError("Bitte Nachname eingeben.");
  if (!iban)     return _setTrainerError("Bitte IBAN eingeben.");
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return _setTrainerError("Die IBAN scheint ungültig zu sein. Bitte prüfen.");
  }

  const payload = {
    vorname,
    nachname,
    geburtsdatum: document.getElementById("tf-geburtsdatum").value,
    strasse:      document.getElementById("tf-strasse").value.trim(),
    plz:          document.getElementById("tf-plz").value.trim(),
    ort:          document.getElementById("tf-ort").value.trim(),
    telefon:      document.getElementById("tf-telefon").value.trim(),
    email:        document.getElementById("tf-email").value.trim().toLowerCase(),
    iban,
    bankname:     document.getElementById("tf-bankname").value.trim(),
    bic:          document.getElementById("tf-bic").value.trim().toUpperCase(),
    signatureDataUrl: trainerSigPad.toDataURL()
  };

  const btn = document.getElementById("btn-trainer-submit");
  btn.disabled = true;
  btn.textContent = "Wird übermittelt …";

  try {
    // Der Worker ermittelt den Nutzernamen selbst aus dem verifizierten Token und
    // legt/aktualisiert damit immer genau den eigenen Datensatz (kein id-Handling
    // mehr auf Client-Seite nötig, siehe submitTrainerData in db.js).
    const data = await submitTrainerData(payload);
    myTrainerRecord = { ...payload, id: data.id, username: currentUsername };

    _renderTrainerReceipt(myTrainerRecord);
    _showReceiptScreen({ justSubmitted: true });
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden, dann kannst du das Formular wieder abschicken.");
    } else {
      _setTrainerError("Übermittlung fehlgeschlagen: " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Daten einreichen";
  }
}

function _showReceiptScreen(opts) {
  const justSubmitted = !!(opts && opts.justSubmitted);
  document.getElementById("success-heading").textContent = justSubmitted ? "Danke!" : "Bereits eingereicht";
  document.getElementById("success-text").textContent = justSubmitted
    ? "Deine Daten wurden erfolgreich eingereicht. Der Verein wird sich bei dir melden, sobald dein Trainervertrag fertig ist."
    : "Du hast mit diesem Konto bereits Daten eingereicht. Falls sich etwas geändert hat, kannst du sie unten bearbeiten.";
  document.getElementById("trainer-connect-screen").style.display = "none";
  document.getElementById("trainer-form-screen").style.display = "none";
  document.getElementById("trainer-success-screen").style.display = "";
}

// Öffnet das Formular vorausgefüllt mit der eigenen, serverseitig geladenen Einreichung.
// submitTrainerData ordnet den Datensatz serverseitig per Login-Konto zu, ein erneutes
// Absenden aktualisiert also automatisch denselben Eintrag statt einen zweiten anzulegen.
function _startEditTrainer() {
  if (!myTrainerRecord) return;

  document.getElementById("tf-vorname").value      = myTrainerRecord.vorname || "";
  document.getElementById("tf-nachname").value     = myTrainerRecord.nachname || "";
  document.getElementById("tf-geburtsdatum").value = myTrainerRecord.geburtsdatum || "";
  document.getElementById("tf-strasse").value      = myTrainerRecord.strasse || "";
  document.getElementById("tf-plz").value          = myTrainerRecord.plz || "";
  document.getElementById("tf-ort").value          = myTrainerRecord.ort || "";
  document.getElementById("tf-telefon").value      = myTrainerRecord.telefon || "";
  document.getElementById("tf-email").value        = myTrainerRecord.email || "";
  document.getElementById("tf-iban").value         = myTrainerRecord.iban ? myTrainerRecord.iban.replace(/(.{4})/g, "$1 ").trim() : "";
  document.getElementById("tf-bankname").value     = myTrainerRecord.bankname || "";
  document.getElementById("tf-bic").value          = myTrainerRecord.bic || "";
  trainerSigPad.loadDataURL(myTrainerRecord.signatureDataUrl || "");

  _setTrainerError("");
  _showTrainerFormScreen();
}

function _setTrainerError(msg) {
  const el = document.getElementById("trainer-error");
  el.textContent = msg;
  el.classList.toggle("visible", !!msg);
}

// Zeigt die soeben übermittelten Daten schreibgeschützt auf dem Bestätigungs-Screen an,
// damit der Trainer sie zur Selbstkontrolle nochmal sehen kann — direkt nach dem
// Absenden und beim späteren Wiederkommen (Einreichung wird seit 1.6 serverseitig
// über das Login-Konto wiedergefunden).
function _renderTrainerReceipt(payload) {
  document.getElementById("r-vorname").textContent = payload.vorname || "—";
  document.getElementById("r-nachname").textContent = payload.nachname || "—";
  document.getElementById("r-geburtsdatum").textContent = _fmtDateOnly(payload.geburtsdatum) || "—";
  const adresse = [payload.strasse, [payload.plz, payload.ort].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  document.getElementById("r-adresse").textContent = adresse || "—";
  document.getElementById("r-telefon").textContent = payload.telefon || "—";
  document.getElementById("r-email").textContent = payload.email || "—";
  document.getElementById("r-iban").textContent = payload.iban ? payload.iban.replace(/(.{4})/g, "$1 ").trim() : "—";
  document.getElementById("r-bankname").textContent = payload.bankname || "—";
  document.getElementById("r-bic").textContent = payload.bic || "—";

  const sigImg = document.getElementById("r-signature");
  sigImg.src = payload.signatureDataUrl || "";
  sigImg.style.display = payload.signatureDataUrl ? "block" : "none";
}

// String-basiert (kein Date-Objekt), damit Zeitzonen-Rundungen ein "yyyy-mm-dd" aus
// dem <input type="date"> nicht auf den Vor- oder Folgetag verschieben können.
function _fmtDateOnly(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

// ─── Admin-Toggle ─────────────────────────────────────────────────────────────

function _initAdminToggle() {
  document.getElementById("btn-admin-toggle").addEventListener("click", () => {
    if (mode === "trainer") {
      _switchToAdmin();
    } else {
      _switchToTrainer();
    }
  });
}

function _switchToAdmin() {
  mode = "admin";
  document.getElementById("trainer-flow").style.display = "none";
  document.getElementById("admin-flow").style.display = "";
  document.getElementById("btn-admin-toggle").textContent = "← Zurück";
  document.getElementById("file-status").style.display = "";
}

function _switchToTrainer() {
  mode = "trainer";
  document.getElementById("admin-flow").style.display = "none";
  document.getElementById("trainer-flow").style.display = "";
  document.getElementById("btn-admin-toggle").textContent = "Admin";
  document.getElementById("file-status").style.display = "none";
}

// ─── Admin-Connect ────────────────────────────────────────────────────────────

function _initAdminConnect() {
  document.getElementById("admin-connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("admin-connect-error");
    errEl.style.display = "none";
    const btn = document.getElementById("btn-admin-connect");
    btn.disabled = true;
    btn.textContent = "Verbinde …";

    davConfig = {
      url:      document.getElementById("admin-url").value.trim(),
      username: document.getElementById("admin-username").value.trim(),
      password: document.getElementById("admin-password").value,
      proxyUrl: document.getElementById("admin-proxy-url").value.trim() || null
    };

    try {
      const raw = await davReadFile(davConfig);
      appData = raw && Array.isArray(raw.trainer) ? raw : { version: 1, trainer: [] };
      await FileStore.setWebdavConfig(davConfig);
      _onAdminConnected();
    } catch (err) {
      errEl.textContent = "Verbindungsfehler: " + err.message;
      errEl.style.display = "block";
      davConfig = null;
    } finally {
      btn.disabled = false;
      btn.textContent = "Verbinden";
    }
  });
}

async function _tryRestoreAdminSession() {
  const saved = await FileStore.getWebdavConfig();
  if (!saved) return;
  davConfig = saved;
  try {
    const raw = await davReadFile(davConfig);
    appData = raw && Array.isArray(raw.trainer) ? raw : { version: 1, trainer: [] };
    _onAdminConnected();
    if (mode !== "admin") _switchToAdmin();
  } catch (_) {
    davConfig = null;
    await FileStore.clearWebdavConfig();
  }
}

function _onAdminConnected() {
  document.getElementById("admin-connect-screen").style.display = "none";
  document.getElementById("admin-panel").style.display = "";
  _updateFileStatus(true);
  const filename = davConfig.url.split("/").pop();
  document.getElementById("settings-file-name").textContent = filename;
  _renderAdminListe();
  _renderImportCurrentStatus();
}

function _updateFileStatus(connected) {
  const el = document.getElementById("file-status");
  el.className = "file-status" + (connected ? " connected" : "");
  el.querySelector(".label").textContent = connected ? "Verbunden" : "Nicht verbunden";
}

// ─── Admin-Panel-Nav ──────────────────────────────────────────────────────────

function _initAdminPanel() {
  document.querySelectorAll("nav button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeAdminTab = btn.dataset.tab;
      document.querySelectorAll("nav button[data-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
      document.getElementById("tab-" + activeAdminTab).classList.add("active");
      if (activeAdminTab === "import") _renderImportCurrentStatus();
    });
  });

  document.getElementById("btn-disconnect").addEventListener("click", async () => {
    await FileStore.clearWebdavConfig();
    davConfig = null;
    appData = { version: 1, trainer: [] };
    document.getElementById("admin-panel").style.display = "none";
    document.getElementById("admin-connect-screen").style.display = "";
    document.getElementById("admin-password").value = "";
    _updateFileStatus(false);
  });

  document.getElementById("btn-zurueck-liste").addEventListener("click", _showAdminListe);
  document.getElementById("btn-eintrag-loeschen").addEventListener("click", _deleteCurrentTrainer);
  document.getElementById("btn-pdf-generieren").addEventListener("click", _generatePdf);
  document.getElementById("btn-pdf-einzeln").addEventListener("click", _generatePdfEinzeln);
  document.getElementById("btn-alle-pdf-zip").addEventListener("click", _generateAlleZip);
}

// ─── Admin-Liste ──────────────────────────────────────────────────────────────

function _showAdminListe() {
  document.getElementById("admin-view-detail").style.display = "none";
  document.getElementById("admin-view-liste").style.display = "";
  currentTrainerId = null;
  _renderAdminListe();
}

function _renderAdminListe() {
  const rows   = document.getElementById("admin-liste-rows");
  const empty  = document.getElementById("admin-liste-empty");
  const header = document.getElementById("admin-liste-header");

  if (!appData.trainer.length) {
    rows.innerHTML = "";
    empty.style.display = "";
    header.style.display = "none";
    return;
  }
  empty.style.display = "none";
  header.style.display = "";

  rows.innerHTML = appData.trainer.map(t => `
    <div class="trainer-row" data-id="${_esc(t.id)}">
      <span class="trainer-name">${_esc(t.nachname)}, ${_esc(t.vorname)}</span>
      <span class="muted">${t.erstelltAm ? _fmtIso(t.erstelltAm) : "—"}</span>
      <span>
        <span class="badge ${t.vertragsGeneriert ? "generiert" : "offen"}">
          ${t.vertragsGeneriert ? "✓ Vertrag erstellt" : "Ausstehend"}
        </span>
      </span>
      <button class="btn secondary small" data-open="${t.id}" type="button">Öffnen</button>
    </div>
  `).join("");

  rows.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _openAdminDetail(btn.dataset.open);
    });
  });
  rows.querySelectorAll(".trainer-row").forEach(row => {
    row.addEventListener("click", () => _openAdminDetail(row.dataset.id));
  });
}

// ─── Admin-Detail ─────────────────────────────────────────────────────────────

function _openAdminDetail(id) {
  const t = appData.trainer.find(x => x.id === id);
  if (!t) return;
  currentTrainerId = id;

  document.getElementById("admin-view-liste").style.display = "none";
  document.getElementById("admin-view-detail").style.display = "";
  document.getElementById("admin-detail-title").textContent = `${t.vorname} ${t.nachname}`;
  document.getElementById("admin-detail-error").classList.remove("visible");

  document.getElementById("d-vorname").value     = t.vorname     || "";
  document.getElementById("d-nachname").value    = t.nachname    || "";
  document.getElementById("d-geburtsdatum").value = t.geburtsdatum || "";
  document.getElementById("d-strasse").value     = t.strasse     || "";
  document.getElementById("d-plz").value         = t.plz         || "";
  document.getElementById("d-ort").value         = t.ort         || "";
  document.getElementById("d-telefon").value     = t.telefon     || "";
  document.getElementById("d-email").value       = t.email       || "";
  document.getElementById("d-iban").value        = t.iban ? t.iban.replace(/(.{4})/g, "$1 ").trim() : "";
  document.getElementById("d-bankname").value    = t.bankname    || "";
  document.getElementById("d-bic").value         = t.bic         || "";
  document.getElementById("d-pauschale").value   = t.pauschale   || "";
  document.getElementById("d-lizenz").value      = t.lizenz      || "";
  document.getElementById("d-erstellt-am").textContent =
    t.erstelltAm ? _fmtIso(t.erstelltAm) : "—";

  // Unterschrift-Vorschau
  const prev = document.getElementById("d-signature-preview");
  const hint = document.getElementById("d-signature-hint");
  if (t.signatureDataUrl) {
    prev.innerHTML = `<img src="${_esc(t.signatureDataUrl)}" alt="Unterschrift" style="max-width:260px; max-height:90px; border:1px solid #dde1e8; border-radius:6px;" />`;
    hint.textContent = "";
  } else {
    prev.innerHTML = "";
    hint.textContent = "Keine Unterschrift hinterlegt.";
  }

  // Änderungen live speichern
  ["d-vorname","d-nachname","d-geburtsdatum","d-strasse","d-plz","d-ort",
   "d-telefon","d-email","d-iban","d-bankname","d-bic","d-pauschale","d-lizenz"].forEach(fid => {
    const input = document.getElementById(fid);
    // Vorherige Listener entfernen (neu klonen)
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("input", _scheduleAutosave);
  });
}

function _collectDetailData() {
  return {
    vorname:      document.getElementById("d-vorname").value.trim(),
    nachname:     document.getElementById("d-nachname").value.trim(),
    geburtsdatum: document.getElementById("d-geburtsdatum").value,
    strasse:      document.getElementById("d-strasse").value.trim(),
    plz:          document.getElementById("d-plz").value.trim(),
    ort:          document.getElementById("d-ort").value.trim(),
    telefon:      document.getElementById("d-telefon").value.trim(),
    email:        document.getElementById("d-email").value.trim().toLowerCase(),
    iban:         document.getElementById("d-iban").value.replace(/\s+/g, "").toUpperCase(),
    bankname:     document.getElementById("d-bankname").value.trim(),
    bic:          document.getElementById("d-bic").value.trim().toUpperCase(),
    pauschale:    document.getElementById("d-pauschale").value.trim(),
    lizenz:       document.getElementById("d-lizenz").value.trim()
  };
}

// ─── Autosave ─────────────────────────────────────────────────────────────────

// In dieser Admin-Sitzung bewusst gelöschte Einträge. Ohne diese Merkliste würde
// _saveMerged sie beim nächsten Speichern wieder aus dem Remote-Stand übernehmen.
const _deletedTrainerIds = new Set();

// Schreibt appData, übernimmt vorher aber Einträge, die seit dem Laden neu auf
// Nextcloud dazugekommen sind (Trainer-Einreichungen über den Submit-Worker
// schreiben in dieselbe Datei — ein reines Überschreiben würde sie verwerfen).
// Wirft bei Lese-/Schreibfehlern, damit die Aufrufer ihre Fehlermeldung zeigen.
async function _saveMerged() {
  const remote = await davReadFile(davConfig); // null bei 404/leer, wirft bei echten Fehlern
  if (remote && Array.isArray(remote.trainer)) {
    const localIds = new Set(appData.trainer.map(t => t.id));
    remote.trainer.forEach(rt => {
      if (rt && rt.id && !localIds.has(rt.id) && !_deletedTrainerIds.has(rt.id)) {
        appData.trainer.push(rt);
      }
    });
  }
  await davWriteFile(davConfig, appData);
}

function _scheduleAutosave() {
  clearTimeout(saveTid);
  saveTid = setTimeout(_doSave, 1200);
}

async function _doSave() {
  if (!davConfig || !currentTrainerId) return;
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  const updated = { ...appData.trainer[idx], ..._collectDetailData() };
  appData.trainer[idx] = updated;

  const statusEl = document.getElementById("settings-save-status");
  statusEl.textContent = "Speichere …";
  try {
    await _saveMerged();
    statusEl.textContent = "Gespeichert ✓";
    setTimeout(() => { statusEl.textContent = "Automatisches Speichern aktiv"; }, 2500);
  } catch (err) {
    statusEl.textContent = "Speicherfehler: " + err.message;
  }
}

// ─── Löschen ──────────────────────────────────────────────────────────────────

async function _deleteCurrentTrainer() {
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  if (!confirm(`Eintrag von ${t.vorname} ${t.nachname} wirklich löschen?`)) return;

  appData.trainer = appData.trainer.filter(x => x.id !== currentTrainerId);
  _deletedTrainerIds.add(currentTrainerId);
  try {
    await _saveMerged();
  } catch (err) {
    _deletedTrainerIds.delete(currentTrainerId);
    document.getElementById("admin-detail-error").textContent = "Fehler beim Löschen: " + err.message;
    document.getElementById("admin-detail-error").classList.add("visible");
    return;
  }
  _showAdminListe();
}

// ─── PDF generieren ───────────────────────────────────────────────────────────

async function _generatePdf() {
  const btn = document.getElementById("btn-pdf-generieren");
  if (!currentTrainerId) return;

  // Aktuelle Edits übernehmen, bevor PDF generiert wird
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;
  appData.trainer[idx] = { ...appData.trainer[idx], ..._collectDetailData() };
  const trainer = appData.trainer[idx];

  btn.disabled = true;
  btn.textContent = "Generiere Word-Vertrag …";

  try {
    await generiereVertragDocx(trainer);

    // Status auf "generiert" setzen und speichern
    appData.trainer[idx].vertragsGeneriert = true;
    await _saveMerged();

    // Badge in Detailansicht aktualisieren
    document.getElementById("admin-detail-title").textContent =
      `${trainer.vorname} ${trainer.nachname}`;
  } catch (err) {
    document.getElementById("admin-detail-error").textContent = "Fehler: " + err.message;
    document.getElementById("admin-detail-error").classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Word-Vertrag generieren";
  }
}

// ─── PDF generieren (Einzel) ──────────────────────────────────────────────────

async function _generatePdfEinzeln() {
  const btn = document.getElementById("btn-pdf-einzeln");
  if (!currentTrainerId) return;
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;
  appData.trainer[idx] = { ...appData.trainer[idx], ..._collectDetailData() };
  const trainer = appData.trainer[idx];
  btn.disabled = true;
  btn.textContent = "Generiere PDF …";
  try {
    await generiereVertrag(trainer);
  } catch (err) {
    document.getElementById("admin-detail-error").textContent = "Fehler: " + err.message;
    document.getElementById("admin-detail-error").classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "PDF herunterladen";
  }
}

// ─── PDF Sammel-Export ────────────────────────────────────────────────────────

async function _generateAlleZip() {
  const btn      = document.getElementById("btn-alle-pdf-zip");
  const statusEl = document.getElementById("zip-export-status");
  if (!appData.trainer.length) return;
  btn.disabled = true;
  statusEl.textContent = "0 / " + appData.trainer.length + " …";
  try {
    await generiereAlleVertraegeZip(appData.trainer, (done, total) => {
      statusEl.textContent = done + " / " + total + " …";
    });
    statusEl.textContent = "ZIP bereit ✓";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  } catch (err) {
    statusEl.textContent = "Fehler: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function _esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _fmtIso(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// ─── Text-Import ──────────────────────────────────────────────────────────────
// Format: eine Zeile pro Trainer, Tab-getrennt: Name[Tab]Lizenz[Tab]Pauschale

let _importRows = [];

function _initImport() {
  document.getElementById("btn-import-parse").addEventListener("click", _handleTextImport);
  document.getElementById("btn-import-start").addEventListener("click", _doImport);
  document.getElementById("btn-import-reset").addEventListener("click", _resetImport);
  document.getElementById("btn-import-nochmal").addEventListener("click", _resetImport);
}

function _resetImport() {
  _importRows = [];
  document.getElementById("import-text-input").value = "";
  document.getElementById("import-step-1").style.display = "";
  document.getElementById("import-step-2").style.display = "none";
  document.getElementById("import-step-3").style.display = "none";
  document.getElementById("import-error").classList.remove("visible");
  document.getElementById("import-preview-wrap").innerHTML = "";
}

function _handleTextImport() {
  const raw = document.getElementById("import-text-input").value;
  _importRows = raw
    .split(/\r?\n/)
    .map(line => line.split("\t"))
    .filter(cols => {
      const name = (cols[0] || "").trim();
      return name && name !== "0";
    });

  if (!_importRows.length) {
    document.getElementById("import-error").textContent = "Keine gültigen Zeilen gefunden.";
    document.getElementById("import-error").classList.add("visible");
    return;
  }

  _renderTextImportPreview();
  document.getElementById("import-step-1").style.display = "none";
  document.getElementById("import-step-2").style.display = "";
  document.getElementById("import-error").classList.remove("visible");
}

function _matchTrainer(fullName) {
  const nl = fullName.trim().toLowerCase();
  // Erst Vollname (Vorname + Nachname), dann Fallback auf letztes Wort als Nachname
  const byFull = appData.trainer.find(t =>
    (t.vorname + " " + t.nachname).toLowerCase() === nl
  );
  if (byFull) return byFull;
  const lastWord = nl.split(/\s+/).pop();
  return appData.trainer.find(t => t.nachname.toLowerCase() === lastWord) || null;
}

function _renderImportCurrentStatus() {
  const wrap = document.getElementById("import-current-wrap");
  if (!wrap) return;

  if (!appData.trainer.length) {
    wrap.innerHTML = `<p class="muted" style="font-size:12px;">Noch keine Trainer vorhanden.</p>`;
    return;
  }

  const sorted = [...appData.trainer].sort((a, b) =>
    (a.nachname + a.vorname).localeCompare(b.nachname + b.vorname, "de")
  );

  const rows = sorted.map(t => {
    const lizenz    = (t.lizenz    || "").trim();
    const pauschale = (t.pauschale || "").trim();
    return `<tr>
      <td style="padding:6px 10px;">${_esc(t.vorname)} ${_esc(t.nachname)}</td>
      <td style="padding:6px 10px;">${lizenz    ? _esc(lizenz)    : `<span class="badge offen">fehlt</span>`}</td>
      <td style="padding:6px 10px;">${pauschale ? _esc(pauschale) : `<span class="badge offen">fehlt</span>`}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `
    <p class="muted" style="font-size:12px; margin-bottom:8px;">${sorted.length} Trainer</p>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead style="background:var(--gray);">
        <tr>
          <th style="padding:6px 10px; text-align:left;">Name</th>
          <th style="padding:6px 10px; text-align:left;">Lizenz</th>
          <th style="padding:6px 10px; text-align:left;">Pauschale</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function _renderTextImportPreview() {
  const rows = _importRows.map((cols, i) => {
    const name      = (cols[0] || "").trim();
    const lizenz    = (cols[1] || "").trim();
    const pauschale = (cols[2] || "").trim();
    const match     = _matchTrainer(name);
    const status    = match
      ? `<span class="badge generiert">→ ${_esc(match.vorname)} ${_esc(match.nachname)}</span>`
      : `<span class="badge offen">Nicht gefunden</span>`;
    const action    = match
      ? `<button type="button" class="btn success small" data-import-row="${i}">Importieren</button>`
      : `<button type="button" class="btn secondary small" disabled title="Kein passender Trainer gefunden">Importieren</button>`;
    return `<tr>
      <td style="padding:6px 10px;">${_esc(name)}</td>
      <td style="padding:6px 10px;">${_esc(lizenz)}</td>
      <td style="padding:6px 10px;">${_esc(pauschale)}</td>
      <td style="padding:6px 10px;">${status}</td>
      <td style="padding:6px 10px;"><span class="row-import-status" data-row-status="${i}"></span></td>
      <td style="padding:6px 10px;">${action}</td>
    </tr>`;
  }).join("");

  document.getElementById("import-preview-wrap").innerHTML = `
    <p class="muted" style="font-size:12px; margin-bottom:8px;">${_importRows.length} Zeile(n) gefunden</p>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead style="background:var(--gray);">
        <tr>
          <th style="padding:6px 10px; text-align:left;">Name</th>
          <th style="padding:6px 10px; text-align:left;">Lizenz</th>
          <th style="padding:6px 10px; text-align:left;">Pauschale</th>
          <th style="padding:6px 10px; text-align:left;">Zuordnung</th>
          <th style="padding:6px 10px; text-align:left;">Status</th>
          <th style="padding:6px 10px; text-align:left;">Aktion</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.getElementById("import-preview-wrap").querySelectorAll("[data-import-row]").forEach(btn => {
    btn.addEventListener("click", () => _doImportRow(Number(btn.dataset.importRow), btn));
  });
}

async function _doImportRow(idx, btn) {
  const cols = _importRows[idx];
  if (!cols) return;

  const name      = (cols[0] || "").trim();
  const lizenz    = (cols[1] || "").trim();
  const pauschale = (cols[2] || "").trim();
  const trainer   = _matchTrainer(name);
  if (!trainer) return;

  const statusEl = document.querySelector(`[data-row-status="${idx}"]`);
  btn.disabled = true;
  btn.textContent = "Speichere …";

  const tIdx = appData.trainer.indexOf(trainer);
  if (lizenz && lizenz !== "0") appData.trainer[tIdx].lizenz = lizenz;
  if (pauschale !== "") appData.trainer[tIdx].pauschale = pauschale;

  try {
    await _saveMerged();
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="badge" style="background:var(--red-light); color:var(--red);">Fehler: ${_esc(err.message)}</span>`;
    btn.disabled = false;
    btn.textContent = "Importieren";
    return;
  }

  if (statusEl) statusEl.innerHTML = `<span class="badge generiert">✓ übernommen</span>`;
  btn.disabled = false;
  btn.textContent = "Erneut importieren";
  _renderImportCurrentStatus();
}

async function _doImport() {
  let updated = 0, skipped = 0;

  for (const cols of _importRows) {
    const name      = (cols[0] || "").trim();
    const lizenz    = (cols[1] || "").trim();
    const pauschale = (cols[2] || "").trim();

    if (!name || name === "0") continue;

    const trainer = _matchTrainer(name);
    if (!trainer) { skipped++; continue; }

    const idx = appData.trainer.indexOf(trainer);
    if (lizenz && lizenz !== "0") appData.trainer[idx].lizenz = lizenz;
    if (pauschale !== "") appData.trainer[idx].pauschale = pauschale;
    updated++;
  }

  const btn = document.getElementById("btn-import-start");
  btn.disabled = true;
  btn.textContent = "Speichere …";
  try {
    await _saveMerged();
  } catch (err) {
    document.getElementById("import-error").textContent = "Speicherfehler: " + err.message;
    document.getElementById("import-error").classList.add("visible");
    btn.disabled = false;
    btn.textContent = "Alle importieren";
    return;
  }
  btn.disabled = false;
  btn.textContent = "Alle importieren";

  document.getElementById("import-step-2").style.display = "none";
  document.getElementById("import-step-3").style.display = "";
  document.getElementById("import-result").innerHTML = `
    <p style="color:var(--green); font-weight:700; font-size:15px; margin-bottom:8px;">
      Import abgeschlossen
    </p>
    <p class="muted"><strong>${updated}</strong> Trainer aktualisiert</p>
    ${skipped ? `<p class="muted"><strong>${skipped}</strong> Zeilen nicht zugeordnet (Name nicht gefunden)</p>` : ""}
  `;
  _renderImportCurrentStatus();
}
