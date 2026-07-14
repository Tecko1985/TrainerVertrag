// Hauptlogik: Trainer-Flow (Formular + Submit) und Admin-Flow (WebDAV, Liste, Detail, PDF).

// ─── State ───────────────────────────────────────────────────────────────────

let appData   = { version: 1, trainer: [] }; // Arbeitskopie im Admin-Modus
let davConfig = null;
let saveTid   = null;
let mode      = "trainer"; // "trainer" | "admin"
let activeAdminTab = "liste";
let currentTrainerId = null;

let trainerSigPad = null;
let kodexSigPad = null; // Signatur-Pad für die Trainerkodex-Bestätigung (seit 1.6, migriert aus trainerkodex)
let vertragSigPad = null; // Signatur-Pad für die Trainervertrags-Unterschrift (seit 1.10)
let jugendschutzSigPad = null; // Signatur-Pad für die Jugendschutzkonzept-Bestätigung (seit 1.7, gleiches Muster wie Kodex)
let myTrainerRecord = null; // eigene Einreichung, serverseitig per Login-Konto geladen
let currentUsername = null;
let currentVorname   = null;
let currentNachname  = null;
let currentIsAdmin   = false;
let currentGroupIds  = [];
let _fuehrerscheinRegisterList = null; // nur befüllt, wenn Admin/Gruppe fuehrerschein-einsicht
let trainerProfiles = null; // zentrale Lizenz/Mannschaft-Profile aller Nutzer, lazy geladen (siehe _openAdminDetail)
let trainerGroupMembers = null; // Nutzernamen der ToolsUebersicht-Gruppe "Trainer", frisch geladen bei jedem Personalkosten-Import (siehe _loadFromPersonalkosten)
let _trainerchecklisteEintraege = null; // TrainerCheckliste-Rohdaten (read-only Cross-Read), lazy geladen (siehe _renderChecklisteStatus)
let myChecklisteStatus = null; // eigener TrainerCheckliste-Eintrag (Trainer-Selbstbedienung, seit 1.8), einmalig geladen in _initTrainerGateway (siehe _renderMyChecklisteStatus)
let _checklisteDetailOpen = false; // Aufklapp-Zustand der "Öffnen"-Detailansicht, überlebt Re-Render (siehe _showTrainerFormScreen)
let _statusTouched = false; // Status-Dropdown im Admin-Detail in dieser Sitzung angefasst? (siehe _collectDetailData)

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;

  _renderChangelog();
  _populateLizenzArtSelect("tf-tl-art");
  _populateLizenzArtSelect("d-tl-art");
  _initTrainerForm();
  _initTrainerDocuments();
  _initTrainerKodex();
  _initTrainerJugendschutz();
  _initTrainerVertrag();
  _initAdminToggle();
  _initAdminConnect();
  _initAdminPanel();
  _initImport();
  _tryRestoreAdminSession();
  _initTrainerGateway();
});

// Trainer-Modus verlangt seit 1.6 ein Tools-Übersicht-Login (statt eines offenen
// No-Login-Formulars) — nur so lässt sich die eigene Einreichung serverseitig per
// Konto wiederfinden, geräte- und browserübergreifend (siehe [[project-trainerdaten]]).
async function _initTrainerGateway() {
  if (!getSessionToken()) {
    _showTrainerConnectScreen();
    return;
  }

  try {
    // fetchMe() und fetchMySubmission() sind unabhängige Worker-Aufrufe (beide
    // ermitteln den Nutzer serverseitig aus dem Bearer-Token) — parallel statt
    // seriell spart einen kompletten Roundtrip vorm ersten sichtbaren Inhalt.
    // _loadMyChecklisteStatus() schluckt eigene Fehler (siehe dort) und darf daher
    // gefahrlos mit im selben Promise.all hängen -- ein Fehlschlag dort (z.B. Worker-
    // Aktion noch nicht deployed) soll nie den ganzen Trainer-Login blockieren.
    const [me, saved, checkliste] = await Promise.all([fetchMe(), fetchMySubmission(), _loadMyChecklisteStatus()]);
    myChecklisteStatus = checkliste;
    currentUsername = me.username;
    currentVorname   = me.vorname || null;
    currentNachname  = me.nachname || null;
    currentIsAdmin   = !!me.isAdmin;
    currentGroupIds  = Array.isArray(me.groupIds) ? me.groupIds : [];

    // iban ist ein Pflichtfeld der echten Formular-Einreichung — ein Datensatz kann
    // aber auch schon existieren, weil nur ein Dokument hochgeladen wurde (siehe
    // resolveOwnTrainerRecord in submit-worker.js), ohne dass je das Hauptformular
    // ausgefüllt wurde. Nur ein echtes iban zeigt den Bestätigungs-Screen.
    if (saved && saved.iban) {
      myTrainerRecord = saved;
      _renderTrainerReceipt(myTrainerRecord);
      _showReceiptScreen({ justSubmitted: false });
    } else {
      myTrainerRecord = saved || null;
      _showTrainerFormScreen();
      document.getElementById("tf-vorname").value  = (saved && saved.vorname) || currentVorname  || "";
      document.getElementById("tf-nachname").value = (saved && saved.nachname) || currentNachname || "";
    }
    document.getElementById("tf-angemeldet-als").textContent =
      [currentVorname, currentNachname].filter(Boolean).join(" ") || currentUsername;
    _initFuehrerscheinRegisterPanel();
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
  document.getElementById("trainer-documents-panel").style.display = "none";
  document.getElementById("trainer-kodex-panel").style.display = "none";
  document.getElementById("trainer-jugendschutz-panel").style.display = "none";
  const err = document.getElementById("trainer-connect-error");
  err.style.display = errorMsg ? "block" : "none";
  err.textContent = errorMsg || "";
}

function _showTrainerFormScreen() {
  document.getElementById("trainer-connect-screen").style.display = "none";
  document.getElementById("trainer-form-screen").style.display = "";
  document.getElementById("trainer-success-screen").style.display = "none";
  document.getElementById("trainer-documents-panel").style.display = "";
  document.getElementById("trainer-kodex-panel").style.display = "";
  document.getElementById("trainer-jugendschutz-panel").style.display = "";
  // Canvas war bis eben in einem display:none-Screen, resize() konnte seine
  // reale Größe also noch nicht kennen (siehe signature-pad.js) -> jetzt nachholen.
  trainerSigPad.resize();
  kodexSigPad.resize();
  jugendschutzSigPad.resize();
  vertragSigPad.resize();
  _renderTrainerDocumentsStatus();
  _renderMyChecklisteStatus();
  _renderTrainerKodexStatus();
  _renderTrainerJugendschutzStatus();
  _renderTrainerVertragStatus();
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

  document.querySelectorAll('input[name="tf-nebentaetigkeit"]').forEach(r => {
    r.addEventListener("change", () => _updateNebentaetigkeitBetragVisibility("tf"));
  });

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

  const nebentaetigkeitEl = document.querySelector('input[name="tf-nebentaetigkeit"]:checked');
  if (!nebentaetigkeitEl) {
    return _setTrainerError("Bitte die Erklärung zur Nebentätigkeit (§ 3 Nr. 26 EStG) auswählen.");
  }
  const nebentaetigkeit = nebentaetigkeitEl.value;
  const nebentaetigkeitBetrag = document.getElementById("tf-nebentaetigkeit-betrag").value.trim();
  if (nebentaetigkeit === "andere" && !nebentaetigkeitBetrag) {
    return _setTrainerError("Bitte die Höhe der anderen Einnahmen angeben.");
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
    nebentaetigkeit,
    nebentaetigkeitBetrag: nebentaetigkeit === "andere" ? nebentaetigkeitBetrag : "",
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
    // Bestehende Dokument-Felder (falls vor dem Hauptformular schon ein Führerschein/
    // Führungszeugnis hochgeladen wurde) erhalten — payload kennt diese Felder nicht.
    myTrainerRecord = { ...(myTrainerRecord || {}), ...payload, id: data.id, username: currentUsername };

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
  document.getElementById("trainer-documents-panel").style.display = "";
  document.getElementById("trainer-kodex-panel").style.display = "";
  document.getElementById("trainer-jugendschutz-panel").style.display = "";
  kodexSigPad.resize();
  jugendschutzSigPad.resize();
  vertragSigPad.resize();
  _renderTrainerDocumentsStatus();
  _renderMyChecklisteStatus();
  _renderTrainerKodexStatus();
  _renderTrainerJugendschutzStatus();
  _renderTrainerVertragStatus();
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
  document.getElementById("tf-nebentaetigkeit-keine").checked  = myTrainerRecord.nebentaetigkeit === "keine";
  document.getElementById("tf-nebentaetigkeit-andere").checked = myTrainerRecord.nebentaetigkeit === "andere";
  document.getElementById("tf-nebentaetigkeit-betrag").value   = myTrainerRecord.nebentaetigkeitBetrag || "";
  _updateNebentaetigkeitBetragVisibility("tf");
  trainerSigPad.loadDataURL(myTrainerRecord.signatureDataUrl || "");

  _setTrainerError("");
  _showTrainerFormScreen();
}

// Blendet das Betrags-Feld nur ein, wenn "andere Einnahmen" gewählt ist. Gemeinsam
// für Trainer-Formular ("tf") und Admin-Detail ("d") genutzt (gleiche Feld-Suffixe).
function _updateNebentaetigkeitBetragVisibility(prefix) {
  const andere = document.getElementById(`${prefix}-nebentaetigkeit-andere`).checked;
  document.getElementById(`${prefix}-nebentaetigkeit-betrag-wrap`).style.display = andere ? "" : "none";
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
  document.getElementById("r-nebentaetigkeit").textContent =
    payload.nebentaetigkeit === "andere" ? `Ja, ${payload.nebentaetigkeitBetrag || "—"} EUR`
    : payload.nebentaetigkeit === "keine" ? "Keine"
    : "—";

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

// Liegt ein "yyyy-mm-dd"-Datum in der Vergangenheit? String-Vergleich (kein Date-
// Objekt) — funktioniert korrekt, weil yyyy-mm-dd lexikografisch sortierbar ist,
// vermeidet dieselbe Zeitzonen-Falle wie _fmtDateOnly.
function _dateOnlyIsPast(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso < today;
}

// Setzt Badge (✓/✗/–) einer aufklappbaren Trainer-Karte (<details class="accordion-card">).
// Der offen/zu-Zustand wird nur beim ALLERERSTEN Aufruf pro Karte (dataset.accInit
// fehlt noch) automatisch gesetzt -- offene Punkte starten ausgeklappt, erledigte
// eingeklappt. Spätere Re-Renders (z.B. nach einem Upload) aktualisieren nur noch
// das Badge und lassen einen inzwischen vom Nutzer selbst gewählten open/zu-Zustand
// unangetastet.
function _setAccordionState(cardId, state, badgeId) {
  const badge = document.getElementById(badgeId);
  if (badge) {
    badge.textContent = state === "done" ? "✓" : state === "open" ? "✗" : "–";
    badge.className = "accordion-badge " + state;
  }
  const card = document.getElementById(cardId);
  if (card && card.dataset.accInit === undefined) {
    card.open = state === "open";
    card.dataset.accInit = "1";
  }
}

// Einzige Quelle für die Lizenzart-Optionen (TRAINERLIZENZ_ARTEN in config.js) —
// befüllt beide <select>-Felder (Trainer-Selbstbedienung + Admin-Detail) identisch.
function _populateLizenzArtSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">— bitte wählen —</option>` +
    TRAINERLIZENZ_ARTEN.map(a => `<option value="${_esc(a)}">${_esc(a)}</option>`).join("");
}

// ─── Dokumente (Trainer-Modus: Trainerlizenz/Führerschein/Führungszeugnis) ─────
// Panel ist unabhängig vom Haupt-Formular sichtbar/nutzbar (siehe resolveOwnTrainerRecord
// in submit-worker.js) — ein Trainer kann ein Dokument hochladen, bevor er das
// Hauptformular je ausgefüllt hat.

// Element-Id-Präfix + Datensatzfelder je Dokumenttyp -- Client-Gegenstück zu
// DOCUMENT_TYPES in submit-worker.js, hier zusätzlich um den DOM-Präfix ergänzt.
const TRAINER_DOC_TYPES = {
  fuehrerschein:    { prefix: "fs", atField: "fuehrerscheinHochgeladenAm",    nameField: "fuehrerscheinDateiName",    ctypeField: "fuehrerscheinContentType" },
  fuehrungszeugnis: { prefix: "fz", atField: "fuehrungszeugnisEingereichtAm", nameField: "fuehrungszeugnisDateiName", ctypeField: "fuehrungszeugnisContentType" },
  trainerlizenz:    { prefix: "tl", atField: "trainerlizenzHochgeladenAm",    nameField: "trainerlizenzDateiName",    ctypeField: "trainerlizenzContentType" }
};

function _initTrainerDocuments() {
  document.getElementById("btn-tf-fs-camera").addEventListener("click", () => document.getElementById("tf-fs-camera-input").click());
  document.getElementById("tf-fs-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("fuehrerschein", f);
  });
  document.getElementById("btn-tf-fs-upload").addEventListener("click", () => document.getElementById("tf-fs-file-input").click());
  document.getElementById("tf-fs-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("fuehrerschein", f);
  });
  document.getElementById("btn-tf-fs-ansehen").addEventListener("click", _viewMyFuehrerschein);
  document.getElementById("btn-tf-fz-ansehen").addEventListener("click", _viewMyFuehrungszeugnis);
  document.getElementById("btn-tf-tl-ansehen").addEventListener("click", _viewMyTrainerlizenz);

  document.getElementById("btn-tf-fz-camera").addEventListener("click", () => document.getElementById("tf-fz-camera-input").click());
  document.getElementById("tf-fz-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("fuehrungszeugnis", f);
  });
  document.getElementById("btn-tf-fz-upload").addEventListener("click", () => document.getElementById("tf-fz-file-input").click());
  document.getElementById("tf-fz-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("fuehrungszeugnis", f);
  });

  document.getElementById("btn-tf-tl-camera").addEventListener("click", () => document.getElementById("tf-tl-camera-input").click());
  document.getElementById("tf-tl-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("trainerlizenz", f);
  });
  document.getElementById("btn-tf-tl-upload").addEventListener("click", () => document.getElementById("tf-tl-file-input").click());
  document.getElementById("tf-tl-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadTrainerDocument("trainerlizenz", f);
  });
  document.getElementById("tf-tl-keine").addEventListener("change", _saveTrainerlizenzDetails);
  document.getElementById("tf-tl-art").addEventListener("change", _saveTrainerlizenzDetails);
  document.getElementById("tf-tl-gueltig-bis").addEventListener("change", _saveTrainerlizenzDetails);

  document.getElementById("btn-tf-fs-export").addEventListener("click", _exportFuehrerscheinePdf);

  document.getElementById("btn-checkliste-oeffnen").addEventListener("click", _toggleChecklisteDetail);
}

// TrainerCheckliste-Status in der Trainer-Selbstbedienung (seit 1.8) -- anders als
// der Admin-only Status weiter unten (_renderChecklisteStatus, WebDAV-Cross-Read,
// nur ✓/–-Badge) läuft dieser Weg über die Gateway-Aktion "my-trainercheckliste-
// status" (Bearer-Token, kein WebDAV-Zugriff nötig) und liefert bereits serverseitig
// nur den eigenen Eintrag samt Detailfeldern (Minimal-Disclosure, siehe admin-
// worker.js). Rein informativ: fließt an keiner Stelle in eine Ampel-Bewertung ein.
async function _loadMyChecklisteStatus() {
  try {
    return await fetchMyChecklisteStatus();
  } catch (_) {
    return null; // z.B. Worker-Aktion noch nicht deployed oder Netzwerkfehler -- Karte zeigt dann "nicht abrufbar"
  }
}

function _renderMyChecklisteStatus() {
  const statusEl = document.getElementById("tf-checkliste-status");
  const btn = document.getElementById("btn-checkliste-oeffnen");
  const detailEl = document.getElementById("checkliste-detail");
  if (!statusEl || !btn || !detailEl) return;

  // myChecklisteStatus ist zu diesem Zeitpunkt immer schon final (die Ladung wird
  // in _initTrainerGateway VOR dem ersten Aufruf dieser Funktion abgewartet) --
  // null heißt hier also "Abruf fehlgeschlagen", nicht "lädt noch".
  if (!myChecklisteStatus) {
    statusEl.textContent = "Status derzeit nicht abrufbar.";
    btn.disabled = true;
    _setAccordionState("tf-checkliste-card", "na", "tf-checkliste-badge");
    return;
  }
  if (!myChecklisteStatus.vorhanden) {
    statusEl.textContent = "Kein Eintrag in der TrainerCheckliste gefunden.";
    btn.disabled = true;
    detailEl.style.display = "none";
    detailEl.innerHTML = "";
    _checklisteDetailOpen = false;
    btn.textContent = "Öffnen";
    _setAccordionState("tf-checkliste-card", "na", "tf-checkliste-badge");
    return;
  }

  const z = myChecklisteStatus.zugang;
  statusEl.innerHTML = z.abgeschlossen
    ? `✅ Zugang abgeschlossen${z.datum ? " am " + _esc(_fmtDateOnly(z.datum)) : ""}`
    : "⏳ Zugang noch nicht abgeschlossen";
  btn.disabled = false;
  // Rein informativ (fließt nicht in die Ampel ein, siehe CLAUDE.md) -- daher nie
  // ein rotes ✗, nur ✓ bei Abschluss bzw. neutrales – solange offen/nicht vorhanden.
  _setAccordionState("tf-checkliste-card", z.abgeschlossen ? "done" : "na", "tf-checkliste-badge");

  if (_checklisteDetailOpen) {
    detailEl.innerHTML =
      _renderChecklisteSectionHtml("Zugang", ZUGANG_SCHEMA, myChecklisteStatus.zugang) +
      _renderChecklisteSectionHtml("Abgang", ABGANG_SCHEMA, myChecklisteStatus.abgang);
    detailEl.style.display = "";
    btn.textContent = "Schließen";
  } else {
    detailEl.style.display = "none";
    detailEl.innerHTML = "";
    btn.textContent = "Öffnen";
  }
}

function _toggleChecklisteDetail() {
  _checklisteDetailOpen = !_checklisteDetailOpen;
  _renderMyChecklisteStatus();
}

// Baut die Detailansicht einer Section (Zugang/Abgang) aus den Rohdaten + den
// statischen Labels aus checkliste-schema.js. Items ohne eigenes label (nur
// Sub-Items, siehe Schema-Kommentar) werden übersprungen; textInput-Items zeigen
// den erfassten Wert (z.B. Schlüsselnummer) aus itemTexts an. bemerkungen/ort/
// nichtAbgeschlossenGrund/itemTexts sind Freitext der Geschäftsstelle -> escapen.
function _renderChecklisteSectionHtml(label, schema, s) {
  if (!s) return "";
  const statusLine = s.abgeschlossen
    ? "✅ Abgeschlossen" + (s.datum ? " am " + _esc(_fmtDateOnly(s.datum)) : "")
    : (s.nichtAbgeschlossen
        ? "⚠️ Nicht abgeschlossen" + (s.nichtAbgeschlossenGrund ? ": " + _esc(s.nichtAbgeschlossenGrund) : "")
        : "— Offen");

  const itemLine = (item, indentPx) => {
    if (!item.label) return "";
    const checked = !!(s.items && s.items[item.id]);
    const textVal = item.textInput && s.itemTexts && s.itemTexts[item.id];
    return `<div style="padding-left:${indentPx}px; padding-bottom:3px;">${checked ? "✅" : "⬜"} ${_esc(item.label)}${textVal ? " (" + _esc(textVal) + ")" : ""}</div>`;
  };
  const itemsHtml = schema.map((item) => itemLine(item, 0) + (Array.isArray(item.subItems) ? item.subItems.map((si) => itemLine(si, 20)).join("") : "")).join("");

  // signature-pad.js härtet loadDataURL() bereits gegen Nicht-Bild-URLs (siehe
  // TrainerCheckliste-CLAUDE.md) -- gleiche Prüfung hier, da diese Werte direkt aus
  // der Nextcloud-JSON kommen und via innerHTML/<img src> gerendert werden.
  const sigHtml = (sigLabel, dataUrl) => (dataUrl && dataUrl.startsWith("data:image/"))
    ? `<div style="margin-top:8px;"><span class="muted" style="font-size:12px;">${sigLabel}</span><br><img src="${dataUrl}" alt="${sigLabel}" class="receipt-signature" /></div>`
    : "";

  return `
    <div class="section-divider">${label}</div>
    <p class="muted" style="margin-bottom:8px;">${statusLine}${s.ort ? " · Ort: " + _esc(s.ort) : ""}</p>
    ${s.bemerkungen ? `<p class="muted" style="margin-bottom:8px;"><em>Bemerkung: ${_esc(s.bemerkungen)}</em></p>` : ""}
    <div style="margin-bottom:6px;">${itemsHtml}</div>
    ${sigHtml("Unterschrift Trainer/Betreuer", s.unterschriftTrainer)}
    ${sigHtml("Unterschrift Geschäftsstelle", s.unterschriftFunktionaer)}
  `;
}

// Trainerkodex (migriert aus der eigenständigen App trainerkodex, siehe CLAUDE.md) --
// anders als dort keine eigenen Name-Eingabefelder mehr (Trainerdaten kennt den Namen
// schon aus dem Gateway-Login), nur noch Text + Signatur + Bestätigen-Button.
function _initTrainerKodex() {
  const canvas = document.getElementById("tf-kodex-sig-canvas");
  kodexSigPad = createSignaturePad(canvas, () => {});
  document.getElementById("btn-tf-kodex-sig-clear").addEventListener("click", () => {
    kodexSigPad.clear();
  });
  document.getElementById("btn-tf-kodex-submit").addEventListener("click", _handleKodexSubmit);
  document.getElementById("kodex-placeholder-banner").style.display = KODEX_IS_PLACEHOLDER ? "flex" : "none";
  document.getElementById("kodex-text").innerHTML = KODEX_HTML;
}

// Anders als beim Hauptformular (Unterschrift dort weiterhin kein Pflichtfeld, siehe
// _handleTrainerSubmit) ist die Signatur hier die einzige Bestätigung überhaupt --
// client-seitig per isEmpty() erzwungen, wie im ursprünglichen trainerkodex-Tool.
async function _handleKodexSubmit() {
  const errEl = document.getElementById("tf-kodex-error");
  errEl.classList.remove("visible");
  if (kodexSigPad.isEmpty()) {
    errEl.textContent = "Bitte unterschreibe, um zu bestätigen.";
    errEl.classList.add("visible");
    return;
  }
  const btn = document.getElementById("btn-tf-kodex-submit");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Wird übermittelt …";
  try {
    const signatureDataUrl = kodexSigPad.toDataURL();
    const data = await submitKodex(signatureDataUrl, currentVorname, currentNachname);
    myTrainerRecord = {
      ...(myTrainerRecord || {}),
      kodexBestaetigtAm: data.kodexBestaetigtAm,
      kodexSignatureDataUrl: signatureDataUrl,
      kodexVersion: data.kodexVersion
    };
    kodexSigPad.clear();
    _renderTrainerKodexStatus();
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden, dann kannst du erneut bestätigen.");
    } else {
      errEl.textContent = "Bestätigung fehlgeschlagen: " + err.message;
      errEl.classList.add("visible");
    }
  } finally {
    btn.disabled = false;
    // Nur zurücksetzen, wenn _renderTrainerKodexStatus() den Text (Erfolgsfall) noch
    // nicht schon korrekt gesetzt hat -- gleiche Guard-Konvention wie _uploadTrainerDocument.
    if (btn.textContent === "Wird übermittelt …") btn.textContent = prevLabel;
  }
}

// Kinder- und Jugendschutzkonzept (seit 1.7) -- eigenständiges Dokument neben dem
// Trainerkodex, aber 1:1 gleiches Muster (Text + Signatur + Bestätigen-Button, gleiche
// 6-Monats-Frist, unabhängig vom Kodex berechnet).
function _initTrainerJugendschutz() {
  const canvas = document.getElementById("tf-jugendschutz-sig-canvas");
  jugendschutzSigPad = createSignaturePad(canvas, () => {});
  document.getElementById("btn-tf-jugendschutz-sig-clear").addEventListener("click", () => {
    jugendschutzSigPad.clear();
  });
  document.getElementById("btn-tf-jugendschutz-submit").addEventListener("click", _handleJugendschutzSubmit);
  document.getElementById("jugendschutz-placeholder-banner").style.display = JUGENDSCHUTZKONZEPT_IS_PLACEHOLDER ? "flex" : "none";
  document.getElementById("jugendschutz-text").innerHTML = JUGENDSCHUTZKONZEPT_HTML;
}

async function _handleJugendschutzSubmit() {
  const errEl = document.getElementById("tf-jugendschutz-error");
  errEl.classList.remove("visible");
  if (jugendschutzSigPad.isEmpty()) {
    errEl.textContent = "Bitte unterschreibe, um zu bestätigen.";
    errEl.classList.add("visible");
    return;
  }
  const btn = document.getElementById("btn-tf-jugendschutz-submit");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Wird übermittelt …";
  try {
    const signatureDataUrl = jugendschutzSigPad.toDataURL();
    const data = await submitJugendschutzkonzept(signatureDataUrl, currentVorname, currentNachname);
    myTrainerRecord = {
      ...(myTrainerRecord || {}),
      jugendschutzBestaetigtAm: data.jugendschutzBestaetigtAm,
      jugendschutzSignatureDataUrl: signatureDataUrl,
      jugendschutzVersion: data.jugendschutzVersion
    };
    jugendschutzSigPad.clear();
    _renderTrainerJugendschutzStatus();
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden, dann kannst du erneut bestätigen.");
    } else {
      errEl.textContent = "Bestätigung fehlgeschlagen: " + err.message;
      errEl.classList.add("visible");
    }
  } finally {
    btn.disabled = false;
    if (btn.textContent === "Wird übermittelt …") btn.textContent = prevLabel;
  }
}

// Speichert Checkbox + Lizenzart + Gültig-bis zusammen (immer alle drei aktuellen
// DOM-Werte, kein Teil-Update) — reine Selbstauskunft ohne Datei-Upload.
async function _saveTrainerlizenzDetails() {
  const errEl = document.getElementById("tf-tl-error");
  errEl.classList.remove("visible");
  const payload = {
    nichtVorhanden: document.getElementById("tf-tl-keine").checked,
    art: document.getElementById("tf-tl-art").value,
    gueltigBis: document.getElementById("tf-tl-gueltig-bis").value
  };
  const prevRecord = { ...(myTrainerRecord || {}) };
  try {
    await setTrainerlizenzDetails(payload, currentVorname, currentNachname);
    myTrainerRecord = {
      ...(myTrainerRecord || {}),
      trainerlizenzNichtVorhanden: payload.nichtVorhanden,
      trainerlizenzArt: payload.art,
      trainerlizenzGueltigBis: payload.gueltigBis
    };
    _renderTrainerDocumentsStatus();
  } catch (err) {
    myTrainerRecord = prevRecord;
    _renderTrainerDocumentsStatus();
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    } else {
      errEl.textContent = "Speichern fehlgeschlagen: " + err.message;
      errEl.classList.add("visible");
    }
  }
}

async function _uploadTrainerDocument(docType, file) {
  if (file.size > MAX_FILE_BYTES) {
    alert(`Datei ist zu groß (max. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`);
    return;
  }
  const ui = TRAINER_DOC_TYPES[docType];
  const errEl = document.getElementById(`tf-${ui.prefix}-error`);
  errEl.classList.remove("visible");
  const camBtn  = document.getElementById(`btn-tf-${ui.prefix}-camera`);
  const fileBtn = document.getElementById(`btn-tf-${ui.prefix}-upload`);
  camBtn.disabled = true; fileBtn.disabled = true;
  const prevLabel = fileBtn.textContent;
  fileBtn.textContent = "Lädt hoch…";
  try {
    await submitDocument(docType, file, currentVorname, currentNachname);
    const nowIso = new Date().toISOString();
    myTrainerRecord = { ...(myTrainerRecord || {}), [ui.atField]: nowIso, [ui.nameField]: file.name, [ui.ctypeField]: file.type || "" };
    // Server setzt trainerlizenzNichtVorhanden beim Upload automatisch zurück
    // (widersprüchlicher Zustand sonst möglich) — lokalen Cache nachziehen.
    if (docType === "trainerlizenz") myTrainerRecord.trainerlizenzNichtVorhanden = false;
    _renderTrainerDocumentsStatus();
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden, dann kannst du das Dokument erneut hochladen.");
    } else {
      errEl.textContent = "Upload fehlgeschlagen: " + err.message;
      errEl.classList.add("visible");
    }
  } finally {
    camBtn.disabled = false; fileBtn.disabled = false;
    if (fileBtn.textContent === "Lädt hoch…") fileBtn.textContent = prevLabel;
  }
}

function _renderTrainerDocumentsStatus() {
  const t = myTrainerRecord || {};

  const tlStatusEl   = document.getElementById("tf-tl-status");
  const tlAnsehenBtn = document.getElementById("btn-tf-tl-ansehen");
  const tlKeineCb    = document.getElementById("tf-tl-keine");
  const tlArtSel     = document.getElementById("tf-tl-art");
  const tlGueltigInp = document.getElementById("tf-tl-gueltig-bis");
  if (t.trainerlizenzHochgeladenAm) {
    let html = "✅ Hochgeladen am " + _esc(_fmtIso(t.trainerlizenzHochgeladenAm));
    if (t.trainerlizenzGueltigBis) {
      const abgelaufen = _dateOnlyIsPast(t.trainerlizenzGueltigBis);
      html += ` · <span class="badge ${abgelaufen ? "abgelaufen" : "generiert"}">` +
        `${abgelaufen ? "Abgelaufen seit " : "Gültig bis "}${_esc(_fmtDateOnly(t.trainerlizenzGueltigBis))}</span>`;
    }
    tlStatusEl.innerHTML = html;
    tlAnsehenBtn.disabled = false;
    document.getElementById("btn-tf-tl-upload").textContent = "Datei ersetzen…";
    document.getElementById("btn-tf-tl-camera").textContent = "📷 Neu aufnehmen";
  } else if (t.trainerlizenzNichtVorhanden) {
    tlStatusEl.textContent = "Keine Trainerlizenz vorhanden (bestätigt).";
    tlAnsehenBtn.disabled = true;
    document.getElementById("btn-tf-tl-upload").textContent = "Datei / Galerie wählen…";
    document.getElementById("btn-tf-tl-camera").textContent = "📷 Foto aufnehmen";
  } else {
    tlStatusEl.textContent = "⚠️ Noch keine Trainerlizenz hochgeladen.";
    tlAnsehenBtn.disabled = true;
    document.getElementById("btn-tf-tl-upload").textContent = "Datei / Galerie wählen…";
    document.getElementById("btn-tf-tl-camera").textContent = "📷 Foto aufnehmen";
  }
  tlKeineCb.checked = !!t.trainerlizenzNichtVorhanden;
  tlArtSel.value = t.trainerlizenzArt || "";
  tlGueltigInp.value = t.trainerlizenzGueltigBis || "";
  tlArtSel.disabled = !!t.trainerlizenzNichtVorhanden;
  tlGueltigInp.disabled = !!t.trainerlizenzNichtVorhanden;
  _setAccordionState("tf-tl-card", (t.trainerlizenzHochgeladenAm || t.trainerlizenzNichtVorhanden) ? "done" : "open", "tf-tl-badge");

  const fsStatusEl   = document.getElementById("tf-fs-status");
  const fsAnsehenBtn = document.getElementById("btn-tf-fs-ansehen");
  if (t.fuehrerscheinHochgeladenAm) {
    const faelligAm = _addMonths(new Date(t.fuehrerscheinHochgeladenAm), FUEHRERSCHEIN_GUELTIGKEIT_MONATE);
    const gueltig = faelligAm.getTime() > Date.now();
    fsStatusEl.textContent = gueltig
      ? `✅ Gültig bis ${faelligAm.toLocaleDateString("de-DE")}`
      : `⚠️ Abgelaufen seit ${faelligAm.toLocaleDateString("de-DE")} — bitte erneut hochladen.`;
    fsAnsehenBtn.disabled = false;
    document.getElementById("btn-tf-fs-upload").textContent = "Datei ersetzen…";
    document.getElementById("btn-tf-fs-camera").textContent = "📷 Neu aufnehmen";
    _setAccordionState("tf-fs-card", gueltig ? "done" : "open", "tf-fs-badge");
  } else {
    fsStatusEl.textContent = "⚠️ Noch keine Führerschein-Kopie eingereicht.";
    fsAnsehenBtn.disabled = true;
    document.getElementById("btn-tf-fs-upload").textContent = "Datei / Galerie wählen…";
    document.getElementById("btn-tf-fs-camera").textContent = "📷 Foto aufnehmen";
    _setAccordionState("tf-fs-card", "open", "tf-fs-badge");
  }

  const fzStatusEl = document.getElementById("tf-fz-status");
  const fzAnsehenBtn = document.getElementById("btn-tf-fz-ansehen");
  if (t.fuehrungszeugnisEingereichtAm) {
    fzStatusEl.textContent = "✅ Eingereicht am " + _fmtIso(t.fuehrungszeugnisEingereichtAm);
    fzAnsehenBtn.disabled = false;
    document.getElementById("btn-tf-fz-upload").textContent = "Datei ersetzen…";
    document.getElementById("btn-tf-fz-camera").textContent = "📷 Neu aufnehmen";
    _setAccordionState("tf-fz-card", "done", "tf-fz-badge");
  } else {
    fzStatusEl.textContent = "⚠️ Noch nicht eingereicht.";
    fzAnsehenBtn.disabled = true;
    document.getElementById("btn-tf-fz-upload").textContent = "Datei / Galerie wählen…";
    document.getElementById("btn-tf-fz-camera").textContent = "📷 Foto aufnehmen";
    _setAccordionState("tf-fz-card", "open", "tf-fz-badge");
  }
}

// Gleiche Gültigkeits-Berechnung wie beim Führerschein (_addMonths + Date.now()-
// Vergleich, KODEX_GUELTIGKEIT_MONATE statt FUEHRERSCHEIN_GUELTIGKEIT_MONATE),
// dieselben .badge.generiert/.badge.abgelaufen-Klassen.
function _renderTrainerKodexStatus() {
  const t = myTrainerRecord || {};
  document.getElementById("tf-kodex-name").textContent =
    [currentVorname, currentNachname].filter(Boolean).join(" ") || currentUsername || "";

  const statusEl = document.getElementById("tf-kodex-status");
  const submitBtn = document.getElementById("btn-tf-kodex-submit");
  if (t.kodexBestaetigtAm) {
    const faelligAm = _addMonths(new Date(t.kodexBestaetigtAm), KODEX_GUELTIGKEIT_MONATE);
    const gueltig = faelligAm.getTime() > Date.now();
    statusEl.innerHTML = gueltig
      ? `✅ Bestätigt am ${_esc(_fmtIso(t.kodexBestaetigtAm))} · <span class="badge generiert">Gültig bis ${_esc(faelligAm.toLocaleDateString("de-DE"))}</span>`
      : `⚠️ Bestätigt am ${_esc(_fmtIso(t.kodexBestaetigtAm))} · <span class="badge abgelaufen">Abgelaufen seit ${_esc(faelligAm.toLocaleDateString("de-DE"))}</span> — bitte erneut bestätigen.`;
    submitBtn.textContent = "Erneut bestätigen";
    _setAccordionState("tf-kodex-card", gueltig ? "done" : "open", "tf-kodex-badge");
  } else {
    statusEl.textContent = "⚠️ Noch nicht bestätigt.";
    submitBtn.textContent = "Ich bestätige";
    _setAccordionState("tf-kodex-card", "open", "tf-kodex-badge");
  }
}

// Gleiches Muster wie _renderTrainerKodexStatus(), JUGENDSCHUTZKONZEPT_GUELTIGKEIT_MONATE
// statt KODEX_GUELTIGKEIT_MONATE, eigenes Feld-Trio (jugendschutz* statt kodex*).
function _renderTrainerJugendschutzStatus() {
  const t = myTrainerRecord || {};
  document.getElementById("tf-jugendschutz-name").textContent =
    [currentVorname, currentNachname].filter(Boolean).join(" ") || currentUsername || "";

  const statusEl = document.getElementById("tf-jugendschutz-status");
  const submitBtn = document.getElementById("btn-tf-jugendschutz-submit");
  if (t.jugendschutzBestaetigtAm) {
    const faelligAm = _addMonths(new Date(t.jugendschutzBestaetigtAm), JUGENDSCHUTZKONZEPT_GUELTIGKEIT_MONATE);
    const gueltig = faelligAm.getTime() > Date.now();
    statusEl.innerHTML = gueltig
      ? `✅ Bestätigt am ${_esc(_fmtIso(t.jugendschutzBestaetigtAm))} · <span class="badge generiert">Gültig bis ${_esc(faelligAm.toLocaleDateString("de-DE"))}</span>`
      : `⚠️ Bestätigt am ${_esc(_fmtIso(t.jugendschutzBestaetigtAm))} · <span class="badge abgelaufen">Abgelaufen seit ${_esc(faelligAm.toLocaleDateString("de-DE"))}</span> — bitte erneut bestätigen.`;
    submitBtn.textContent = "Erneut bestätigen";
    _setAccordionState("tf-jugendschutz-card", gueltig ? "done" : "open", "tf-jugendschutz-badge");
  } else {
    statusEl.textContent = "⚠️ Noch nicht bestätigt.";
    submitBtn.textContent = "Ich bestätige";
    _setAccordionState("tf-jugendschutz-card", "open", "tf-jugendschutz-badge");
  }
}

// ─── Trainervertrag (seit 1.10) ────────────────────────────────────────────────
// Das vom Skript generate-pdfs.ps1 bereitgestellte Vertrags-PDF ansehen, digital
// unterschreiben (Original + im Browser per pdf-lib angehängte Unterschriftenseite)
// und danach jederzeit als fertig unterschriebenes PDF wieder ansehen. Fließt bewusst
// NICHT in den Ampel-Gesamtstatus ein (wie der Checkliste-Status, siehe CLAUDE.md).
function _initTrainerVertrag() {
  const canvas = document.getElementById("tf-vertrag-sig-canvas");
  vertragSigPad = createSignaturePad(canvas, () => {});
  document.getElementById("btn-tf-vertrag-sig-clear").addEventListener("click", () => vertragSigPad.clear());
  document.getElementById("btn-tf-vertrag-submit").addEventListener("click", _handleVertragSubmit);
  document.getElementById("btn-tf-vertrag-ansehen").addEventListener("click", () => _viewMyVertrag(false));
  document.getElementById("btn-tf-vertrag-signiert-ansehen").addEventListener("click", () => _viewMyVertrag(true));
}

function _renderTrainerVertragStatus() {
  const t = myTrainerRecord || {};
  const statusEl   = document.getElementById("tf-vertrag-status");
  const ansehenBtn = document.getElementById("btn-tf-vertrag-ansehen");
  const signWrap   = document.getElementById("tf-vertrag-sign-wrap");
  const signiertBtn = document.getElementById("btn-tf-vertrag-signiert-ansehen");
  const hinweis    = document.getElementById("tf-vertrag-hinweis");
  if (!statusEl) return;

  if (!t.vertragPdfBereitgestelltAm) {
    statusEl.textContent = "Sobald dein Trainervertrag bereitsteht, kannst du ihn hier ansehen und unterschreiben.";
    ansehenBtn.disabled = true;
    signWrap.style.display = "none";
    signiertBtn.style.display = "none";
    hinweis.style.display = "none";
    _setAccordionState("tf-vertrag-card", "na", "tf-vertrag-badge");
    return;
  }
  ansehenBtn.disabled = false;
  if (t.vertragUnterschriebenAm) {
    statusEl.innerHTML = "✅ Unterschrieben am " + _esc(_fmtIso(t.vertragUnterschriebenAm));
    signWrap.style.display = "none";
    signiertBtn.style.display = "";
    hinweis.style.display = "";
    _setAccordionState("tf-vertrag-card", "done", "tf-vertrag-badge");
  } else {
    statusEl.innerHTML = "📄 Vertrag liegt zur Unterschrift bereit (bereitgestellt am " + _esc(_fmtIso(t.vertragPdfBereitgestelltAm)) + ").";
    signWrap.style.display = "";
    signiertBtn.style.display = "none";
    hinweis.style.display = "none";
    // Canvas wird erst mit diesem Umschalten sichtbar -> resize() nachziehen.
    vertragSigPad.resize();
    _setAccordionState("tf-vertrag-card", "open", "tf-vertrag-badge");
  }
}

// Safari (v.a. iOS) blockiert window.open() nach einem await als Popup, auch wenn der
// Aufruf aus einem Klick-Handler stammt — der "echte Nutzerklick"-Kontext gilt dort nur
// bis zum ersten await, danach silently blockiert (kein Fehler, kein Alert). Fix: leeres
// Fenster SYNCHRON im Klick-Callstack öffnen, danach nur noch die URL nachreichen
// (location.href auf einer bereits offenen Fenster-Referenz ist auch später erlaubt).
// Verzögertes revoke (10s) lassen wir stehen, da manche mobilen Browser die Blob-URL
// erst nach dem Laden brauchen.
function _openBlobTab() {
  const win = window.open("", "_blank");
  return {
    show(blob) {
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    abort() { if (win) win.close(); }
  };
}

async function _viewMyVertrag(signed) {
  const tab = _openBlobTab();
  try {
    const blob = await fetchMyVertragBlob(signed);
    tab.show(blob);
  } catch (err) {
    tab.abort();
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    } else {
      alert("Vertrag nicht abrufbar: " + err.message);
    }
  }
}

async function _handleVertragSubmit() {
  const errEl = document.getElementById("tf-vertrag-error");
  errEl.classList.remove("visible");
  if (vertragSigPad.isEmpty()) {
    errEl.textContent = "Bitte unterschreibe, um den Vertrag zu bestätigen.";
    errEl.classList.add("visible");
    return;
  }
  const btn = document.getElementById("btn-tf-vertrag-submit");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Wird gespeichert …";
  try {
    const signatureDataUrl = vertragSigPad.toDataURL();
    // Original-Vertrag holen und im Browser die Unterschriftenseite anhängen, dann
    // das fertige PDF hochladen (der Worker legt es in vertraege-signiert/<id> ab).
    const origBlob  = await fetchMyVertragBlob(false);
    const origBytes = new Uint8Array(await origBlob.arrayBuffer());
    const name = [currentVorname, currentNachname].filter(Boolean).join(" ") || currentUsername || "";
    const dateStr = new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const signedBytes = await buildSignedVertragPdf(origBytes, { name, dateStr, signaturePngDataUrl: signatureDataUrl });
    const signedBlob = new Blob([signedBytes], { type: "application/pdf" });
    const data = await submitVertragUnterschrift(signedBlob, signatureDataUrl);
    myTrainerRecord = {
      ...(myTrainerRecord || {}),
      vertragUnterschriebenAm: data.vertragUnterschriebenAm,
      vertragSignatureDataUrl: signatureDataUrl
    };
    vertragSigPad.clear();
    _renderTrainerVertragStatus();
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden, dann kannst du erneut unterschreiben.");
    } else {
      errEl.textContent = "Speichern fehlgeschlagen: " + err.message;
      errEl.classList.add("visible");
    }
  } finally {
    btn.disabled = false;
    if (btn.textContent === "Wird gespeichert …") btn.textContent = prevLabel;
  }
}

async function _viewMyFuehrerschein() {
  const tab = _openBlobTab();
  try {
    const blob = await fetchMyFuehrerscheinBlob();
    tab.show(blob);
  } catch (err) {
    tab.abort();
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    } else {
      alert("Datei nicht abrufbar: " + err.message);
    }
  }
}

async function _viewMyFuehrungszeugnis() {
  const tab = _openBlobTab();
  try {
    const blob = await fetchMyFuehrungszeugnisBlob();
    tab.show(blob);
  } catch (err) {
    tab.abort();
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    } else {
      alert("Datei nicht abrufbar: " + err.message);
    }
  }
}

async function _viewMyTrainerlizenz() {
  const tab = _openBlobTab();
  try {
    const blob = await fetchMyTrainerlizenzBlob();
    tab.show(blob);
  } catch (err) {
    tab.abort();
    if (err instanceof NotLoggedInError) {
      _showTrainerConnectScreen("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    } else {
      alert("Datei nicht abrufbar: " + err.message);
    }
  }
}

// ─── Führerschein-Register (Admin / Gruppe fuehrerschein-einsicht) ─────────────
// Eigene UI-Fläche innerhalb des Trainer-Gateway-Bereichs, da diese Personen keinen
// WebDAV-Admin-Zugang haben — der Worker prüft die Berechtigung serverseitig erneut.

async function _initFuehrerscheinRegisterPanel() {
  const card = document.getElementById("tf-fs-register-card");
  const mayView = currentIsAdmin || currentGroupIds.includes(FS_VIEW_GROUP_ID);
  if (!mayView) { card.style.display = "none"; return; }
  try {
    _fuehrerscheinRegisterList = await fetchFuehrerscheinRegister();
  } catch (_) {
    _fuehrerscheinRegisterList = [];
  }
  if (_fuehrerscheinRegisterList === null) { card.style.display = "none"; return; }
  card.style.display = "";
  _renderFuehrerscheinRegisterRows(_fuehrerscheinRegisterList);
}

function _renderFuehrerscheinRegisterRows(list) {
  const wrap  = document.getElementById("tf-fs-register-rows");
  const empty = document.getElementById("tf-fs-register-empty");
  document.getElementById("btn-tf-fs-export").disabled = list.length === 0;
  if (!list.length) { wrap.innerHTML = ""; empty.style.display = ""; return; }
  empty.style.display = "none";

  const sorted = list.slice().sort((a, b) => (a.nachname + a.vorname).localeCompare(b.nachname + b.vorname, "de"));
  wrap.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead style="background:var(--gray);">
        <tr>
          <th style="padding:6px 10px; text-align:left;">Name</th>
          <th style="padding:6px 10px; text-align:left;">Hochgeladen</th>
          <th style="padding:6px 10px; text-align:left;">Status</th>
          <th style="padding:6px 10px; text-align:left;"></th>
        </tr>
      </thead>
      <tbody>${sorted.map(t => {
        const faelligAm = _addMonths(new Date(t.fuehrerscheinHochgeladenAm), FUEHRERSCHEIN_GUELTIGKEIT_MONATE);
        const gueltig = faelligAm.getTime() > Date.now();
        return `<tr>
          <td style="padding:6px 10px;">${_esc(t.vorname)} ${_esc(t.nachname)}</td>
          <td style="padding:6px 10px;">${_esc(_fmtIso(t.fuehrerscheinHochgeladenAm))}</td>
          <td style="padding:6px 10px;"><span class="badge ${gueltig ? "generiert" : "abgelaufen"}">${gueltig ? "Gültig" : "Abgelaufen"}</span></td>
          <td style="padding:6px 10px;"><button type="button" class="btn secondary small" data-view-fs-owner="${_esc(t.id)}">Ansehen</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  `;
  wrap.querySelectorAll("[data-view-fs-owner]").forEach(btn => {
    btn.addEventListener("click", () => _viewFuehrerscheinForOwner(btn.dataset.viewFsOwner));
  });
}

async function _viewFuehrerscheinForOwner(trainerId) {
  const tab = _openBlobTab();
  try {
    const blob = await fetchFuehrerscheinFileForOwner(trainerId);
    tab.show(blob);
  } catch (err) {
    tab.abort();
    alert("Datei nicht abrufbar: " + err.message);
  }
}

// A4 in PDF-Punkten (72dpi) — für Deckblätter und eingebettete Fotos im Sammel-Export.
const PDF_PAGE_A4 = [595.28, 841.89];
function _pdfAddImagePage(doc, image) {
  const [pw, ph] = PDF_PAGE_A4;
  const maxW = pw - 100, maxH = ph - 140;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale, h = image.height * scale;
  doc.addPage(PDF_PAGE_A4).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

// 1:1 aus dem migrierten Fahrtenbuch-Feature portiert (exportFuehrerscheinePdf),
// nur auf die Register-Aktionen von submit-worker.js umgestellt. pdf-lib ist bereits
// über pdf-utils.js/CDN geladen, kein neuer Script-Tag nötig.
async function _exportFuehrerscheinePdf() {
  const list = (_fuehrerscheinRegisterList || []).slice()
    .sort((a, b) => (a.nachname + a.vorname).localeCompare(b.nachname + b.vorname, "de"));
  if (!list.length) return;
  const btn = document.getElementById("btn-tf-fs-export");
  const statusEl = document.getElementById("tf-fs-export-status");
  btn.disabled = true;
  statusEl.textContent = "Erstelle PDF …";
  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    const drawLabelPage = (lines) => {
      const page = out.addPage(PDF_PAGE_A4);
      let y = 780;
      lines.forEach((line, i) => {
        page.drawText(line, { x: 50, y, size: i === 0 ? 18 : 12, font, color: rgb(0.1, 0.1, 0.1) });
        y -= i === 0 ? 30 : 20;
      });
    };
    drawLabelPage(["Führerschein-Register", `Export vom ${new Date().toLocaleDateString("de-DE")} · ${list.length} Trainer`]);

    const fehler = [];
    for (const t of list) {
      const wer = `${t.vorname} ${t.nachname}`.trim() || t.id;
      let bytes;
      try {
        const blob = await fetchFuehrerscheinFileForOwner(t.id);
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch (e) {
        fehler.push(`${wer} (Datei nicht abrufbar: ${e.message})`);
        continue;
      }
      const faelligAm = _addMonths(new Date(t.fuehrerscheinHochgeladenAm), FUEHRERSCHEIN_GUELTIGKEIT_MONATE);
      const gueltig = faelligAm.getTime() > Date.now();
      drawLabelPage([wer, `Hochgeladen: ${_fmtIso(t.fuehrerscheinHochgeladenAm)}`, `Gültig bis: ${faelligAm.toLocaleDateString("de-DE")} (${gueltig ? "gültig" : "abgelaufen"})`]);
      const ct = (t.fuehrerscheinContentType || "").toLowerCase();
      try {
        if (ct === "application/pdf") {
          const src = await PDFDocument.load(bytes);
          (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
        } else if (ct === "image/png") {
          _pdfAddImagePage(out, await out.embedPng(bytes));
        } else if (ct === "image/jpeg" || ct === "image/jpg") {
          _pdfAddImagePage(out, await out.embedJpg(bytes));
        } else {
          fehler.push(`${wer} (Dateiformat „${t.fuehrerscheinContentType || "unbekannt"}“ wird nicht unterstützt)`);
        }
      } catch (e) {
        fehler.push(`${wer} (Datei beschädigt oder nicht lesbar)`);
      }
    }

    const pdfBytes = await out.save();
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Fuehrerscheine-Export_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Verzögert freigeben: sofortiges revoke direkt nach click() bricht den Download
    // auf manchen (v.a. mobilen) Browsern ab — gleiche Konvention wie im migrierten
    // Fahrtenbuch-Export.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    statusEl.textContent = "";
    if (fehler.length) alert("PDF erstellt, aber nicht alle Kopien konnten eingefügt werden:\n\n" + fehler.join("\n"));
  } catch (e) {
    statusEl.textContent = "";
    alert("PDF-Export fehlgeschlagen: " + e.message);
  } finally {
    btn.disabled = false;
  }
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

function _activateAdminTab(tab) {
  activeAdminTab = tab;
  document.querySelectorAll("nav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === activeAdminTab));
  document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
  document.getElementById("tab-" + activeAdminTab).classList.add("active");
  if (activeAdminTab === "import") _renderImportCurrentStatus();
}

function _initAdminPanel() {
  document.querySelectorAll("nav button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => _activateAdminTab(btn.dataset.tab));
  });

  // Header-Versionsbadge (auch im Trainer-Modus sichtbar) springt in den
  // Admin-Bereich zur Versionshistorie -- entspricht "Admin"-Button + Einstellungen-Tab.
  const versionBadgeHeader = document.getElementById("version-badge");
  versionBadgeHeader.addEventListener("click", () => { _switchToAdmin(); _activateAdminTab("einstellungen"); });
  versionBadgeHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _switchToAdmin(); _activateAdminTab("einstellungen"); }
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
  document.getElementById("btn-d-speichern").addEventListener("click", _saveDetailNow);
  document.getElementById("btn-eintrag-loeschen").addEventListener("click", _deleteCurrentTrainer);
  document.getElementById("btn-pdf-generieren").addEventListener("click", _generatePdf);
  document.getElementById("btn-pdf-einzeln").addEventListener("click", _generatePdfEinzeln);
  document.getElementById("btn-alle-pdf-zip").addEventListener("click", _generateAlleZip);

  document.getElementById("liste-search").addEventListener("input", _renderAdminListe);
  document.getElementById("liste-filter-status").addEventListener("change", _renderAdminListe);
  document.getElementById("liste-filter-lizenz").addEventListener("change", _renderAdminListe);
  document.getElementById("liste-filter-vertrag").addEventListener("change", _renderAdminListe);
  _initExportPanel();

  // Dokumente (Admin-Detail) — einmalig verdrahtet, nicht pro _openAdminDetail-Aufruf
  // (die Buttons werden anders als die Autosave-Felder nicht per cloneNode ersetzt).
  document.getElementById("btn-d-tl-upload").addEventListener("click", () => document.getElementById("d-tl-file-input").click());
  document.getElementById("d-tl-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("trainerlizenzen", f, "trainerlizenzHochgeladenAm", "trainerlizenzDateiName", "trainerlizenzContentType");
  });
  document.getElementById("btn-d-tl-camera").addEventListener("click", () => document.getElementById("d-tl-camera-input").click());
  document.getElementById("d-tl-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("trainerlizenzen", f, "trainerlizenzHochgeladenAm", "trainerlizenzDateiName", "trainerlizenzContentType");
  });
  document.getElementById("btn-d-tl-ansehen").addEventListener("click", () => _ansehenDocumentAdmin("trainerlizenzen"));

  document.getElementById("btn-d-fs-upload").addEventListener("click", () => document.getElementById("d-fs-file-input").click());
  document.getElementById("d-fs-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrerscheine", f, "fuehrerscheinHochgeladenAm", "fuehrerscheinDateiName", "fuehrerscheinContentType");
  });
  document.getElementById("btn-d-fs-camera").addEventListener("click", () => document.getElementById("d-fs-camera-input").click());
  document.getElementById("d-fs-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrerscheine", f, "fuehrerscheinHochgeladenAm", "fuehrerscheinDateiName", "fuehrerscheinContentType");
  });
  document.getElementById("btn-d-fs-ansehen").addEventListener("click", () => _ansehenDocumentAdmin("fuehrerscheine"));

  document.getElementById("btn-d-fz-upload").addEventListener("click", () => document.getElementById("d-fz-file-input").click());
  document.getElementById("d-fz-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrungszeugnisse", f, "fuehrungszeugnisEingereichtAm", "fuehrungszeugnisDateiName", "fuehrungszeugnisContentType");
  });
  document.getElementById("btn-d-kodex-reset").addEventListener("click", _resetKodexAdmin);
  document.getElementById("btn-d-jugendschutz-reset").addEventListener("click", _resetJugendschutzAdmin);
  document.getElementById("btn-d-vertrag-reset").addEventListener("click", _resetVertragUnterschriftAdmin);

  document.getElementById("btn-d-fz-camera").addEventListener("click", () => document.getElementById("d-fz-camera-input").click());
  document.getElementById("d-fz-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrungszeugnisse", f, "fuehrungszeugnisEingereichtAm", "fuehrungszeugnisDateiName", "fuehrungszeugnisContentType");
  });
  document.getElementById("btn-d-fz-ansehen").addEventListener("click", () => _ansehenDocumentAdmin("fuehrungszeugnisse"));

  document.getElementById("btn-d-vertrag-ansehen").addEventListener("click", () => _ansehenVertragAdmin(false));
  document.getElementById("btn-d-vertrag-signiert-ansehen").addEventListener("click", () => _ansehenVertragAdmin(true));
}

// ─── Admin-Liste ──────────────────────────────────────────────────────────────

async function _showAdminListe() {
  await _flushPendingSave();
  document.getElementById("admin-view-detail").style.display = "none";
  document.getElementById("admin-view-liste").style.display = "";
  currentTrainerId = null;
  _renderAdminListe();
}

function _trainerStatus(t) {
  // Admin kann den Status im Detail manuell überschreiben (Select "d-status").
  // Ohne expliziten Wert bleibt es bei der bisherigen automatischen Ableitung.
  if (t.status) return t.status;
  if (t.vertragsGeneriert) return "generiert";
  return t.username ? "ausstehend" : "unvollstaendig";
}

// "Eingereicht (unterschrieben) am": unterschriftAm wird erst seit 1.5 vom
// submit-worker gesetzt. Ältere echte Einreichungen haben nur erstelltAm — bei
// vorhandener Unterschrift ist das ihr Einreichzeitpunkt (Fallback), Import-Stubs
// (keine Unterschrift) bekommen weiterhin bewusst kein Datum.
function _eingereichtAm(t) {
  return t.unterschriftAm || (t.signatureDataUrl ? t.erstelltAm : null);
}

// Baut die Lizenz-Filteroptionen aus den tatsächlich vorhandenen Werten neu auf
// (ändert sich mit jedem Import) und erhält dabei die aktuelle Auswahl, falls
// der Wert noch existiert.
function _populateLizenzFilterOptions() {
  const sel = document.getElementById("liste-filter-lizenz");
  const current = sel.value;
  const distinct = Array.from(new Set(
    appData.trainer.map(t => (t.lizenz || "").trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "de"));

  sel.innerHTML = `<option value="">Alle Lizenzen</option>` +
    distinct.map(l => `<option value="${_esc(l)}">${_esc(l)}</option>`).join("");

  if (distinct.includes(current)) sel.value = current;
}

// Liest die aktuellen Filter/Suchfeld-Werte aus dem DOM und wendet sie auf
// appData.trainer an — einzige Quelle für "was ist gerade sichtbar", genutzt
// sowohl von _renderAdminListe() (Bildschirmliste) als auch vom CSV-Export
// (_handleExportCsv), damit beide garantiert dieselbe Menge zeigen/exportieren.
function _filteredTrainerList() {
  const searchTerm    = document.getElementById("liste-search").value.trim().toLowerCase();
  const statusFilter  = document.getElementById("liste-filter-status").value;
  const lizenzFilter  = document.getElementById("liste-filter-lizenz").value;
  const vertragFilter = document.getElementById("liste-filter-vertrag").value;

  return appData.trainer.filter(t => {
    if (searchTerm && !(t.vorname + " " + t.nachname).toLowerCase().includes(searchTerm)) return false;
    if (statusFilter && _trainerStatus(t) !== statusFilter) return false;
    if (lizenzFilter && (t.lizenz || "").trim() !== lizenzFilter) return false;
    if (vertragFilter === "unterschrieben" && !t.vertragUnterschriebenAm) return false;
    if (vertragFilter === "offen" && t.vertragUnterschriebenAm) return false;
    return true;
  });
}

function _renderAdminListe() {
  const rows      = document.getElementById("admin-liste-rows");
  const empty     = document.getElementById("admin-liste-empty");
  const noMatch   = document.getElementById("admin-liste-no-match");
  const header    = document.getElementById("admin-liste-header");
  const filterbar = document.getElementById("admin-liste-filterbar");

  if (!appData.trainer.length) {
    rows.innerHTML = "";
    empty.style.display = "";
    noMatch.style.display = "none";
    header.style.display = "none";
    filterbar.style.display = "none";
    _updateExportInfoLine();
    return;
  }
  empty.style.display = "none";
  header.style.display = "";
  filterbar.style.display = "";
  _populateLizenzFilterOptions();

  const filtered = _filteredTrainerList();
  _updateExportInfoLine();

  if (!filtered.length) {
    rows.innerHTML = "";
    noMatch.style.display = "";
    return;
  }
  noMatch.style.display = "none";

  const statusLabel = { generiert: "✓ Vertrag erstellt", ausstehend: "Ausstehend", unvollstaendig: "Unvollständig" };

  rows.innerHTML = filtered.map(t => {
    const status = _trainerStatus(t);
    return `
    <div class="trainer-row" data-id="${_esc(t.id)}">
      <span class="trainer-name">${_esc(t.nachname)}, ${_esc(t.vorname)}${t.lizenz ? ` <span class="muted" style="font-weight:400;">· ${_esc(t.lizenz)}</span>` : ""}</span>
      <span class="muted">${_eingereichtAm(t) ? _fmtIso(_eingereichtAm(t)) : "—"}</span>
      <span class="muted">${(t.pauschale || "").trim() ? _esc(t.pauschale) + " €" : "—"}</span>
      <span>
        <span class="badge ${status === "generiert" ? "generiert" : "offen"}">
          ${statusLabel[status]}
        </span>
      </span>
      <button class="btn secondary small" data-open="${t.id}" type="button">Öffnen</button>
    </div>
  `;
  }).join("");

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

// ─── CSV-Export (konfigurierbar, seit 1.18) ────────────────────────────────────
// Jedes Feld einzeln per Checkbox wählbar (EXPORT_FIELD_GROUPS in config.js).
// Exportiert immer genau die aktuell gefilterte/gesuchte Liste (_filteredTrainerList()) —
// anders als "Alle als PDF-ZIP", das bewusst immer den kompletten Bestand nimmt.
// Rein clientseitig, kein Worker-Redeploy: CSV wird im Browser aus appData gebaut.

function _initExportPanel() {
  _renderExportFieldCheckboxes();

  document.getElementById("btn-export-toggle").addEventListener("click", () => {
    const panel = document.getElementById("export-panel");
    const willOpen = panel.style.display === "none";
    panel.style.display = willOpen ? "" : "none";
    if (willOpen) _updateExportInfoLine();
  });
  document.getElementById("btn-export-felder-alle").addEventListener("click", () => _setAllExportCheckboxes(true));
  document.getElementById("btn-export-felder-keine").addEventListener("click", () => _setAllExportCheckboxes(false));
  document.getElementById("btn-export-csv").addEventListener("click", _handleExportCsv);
}

function _renderExportFieldCheckboxes() {
  const wrap = document.getElementById("export-field-groups");
  wrap.innerHTML = EXPORT_FIELD_GROUPS.map(group => `
    <div class="section-divider" style="margin:14px 0 8px;">${_esc(group.title)}</div>
    <div class="form-grid" style="margin-bottom:0;">
      ${group.fields.map(f => `
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; margin-bottom:0;">
          <input type="checkbox" class="export-field-cb" data-field="${_esc(f.key)}" checked /> ${_esc(f.label)}
        </label>
      `).join("")}
    </div>
  `).join("");
  wrap.querySelectorAll(".export-field-cb").forEach(cb => cb.addEventListener("change", _updateExportInfoLine));
}

function _setAllExportCheckboxes(checked) {
  document.querySelectorAll(".export-field-cb").forEach(cb => { cb.checked = checked; });
  _updateExportInfoLine();
}

// Läuft nach jedem _renderAdminListe() (auch bei geschlossenem Panel, dann nur
// unsichtbar aktualisiert) UND bei jeder Checkbox-Änderung mit -- so zeigt die
// Zeile auch dann den korrekten Stand, wenn der Admin Filter/Suche ändert,
// während das Export-Panel bereits offen ist.
function _updateExportInfoLine() {
  const el = document.getElementById("export-info-line");
  if (!el) return;
  const total   = document.querySelectorAll(".export-field-cb").length;
  const checked = document.querySelectorAll(".export-field-cb:checked").length;
  const rowCount = appData.trainer.length ? _filteredTrainerList().length : 0;
  el.textContent = `${checked} von ${total} Feldern ausgewählt · exportiert ${rowCount} Trainer (aktuelle Filterung/Suche).`;
}

function _handleExportCsv() {
  const selectedKeys = Array.from(document.querySelectorAll(".export-field-cb:checked")).map(cb => cb.dataset.field);
  if (!selectedKeys.length) { alert("Bitte mindestens ein Feld für den Export auswählen."); return; }

  const rows = _filteredTrainerList().slice().sort((a, b) =>
    ((a.nachname || "") + (a.vorname || "")).localeCompare((b.nachname || "") + (b.vorname || ""), "de")
  );
  if (!rows.length) { alert("Die aktuelle Filterung/Suche ergibt keine Treffer zum Exportieren."); return; }

  const fieldLookup = new Map(EXPORT_FIELD_GROUPS.flatMap(g => g.fields).map(f => [f.key, f]));
  const cols = selectedKeys.map(key => fieldLookup.get(key)).filter(Boolean);

  const lines = [cols.map(f => f.label), ...rows.map(t => cols.map(f => _exportFieldValue(t, f)))];
  // Semikolon statt Komma + UTF-8-BOM: deutsches Excel erkennt das Trennzeichen
  // damit automatisch beim Doppelklick und zeigt Umlaute korrekt (ohne BOM
  // interpretiert Excel die Datei sonst als ANSI und zerlegt ä/ö/ü/ß).
  const csv = String.fromCharCode(0xFEFF) + lines.map(line => line.map(_csvCell).join(";")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "Trainerdaten_Export_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function _csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function _exportFieldValue(t, f) {
  switch (f.type) {
    case "date":     return t[f.key] ? _fmtIso(t[f.key]) : "";
    case "dateonly": return t[f.key] ? _fmtDateOnly(t[f.key]) : "";
    case "bool":     return t[f.key] ? "Ja" : "Nein";
    case "iban":     return t.iban ? t.iban.replace(/(.{4})/g, "$1 ").trim() : "";
    case "nebentaetigkeit":
      return t.nebentaetigkeit === "andere" ? "Andere" : t.nebentaetigkeit === "keine" ? "Keine" : "";
    case "status": {
      const labels = { generiert: "Vertrag erstellt", ausstehend: "Ausstehend", unvollstaendig: "Unvollständig" };
      return labels[_trainerStatus(t)] || "";
    }
    case "derived-eingereicht":
      return _eingereichtAm(t) ? _fmtIso(_eingereichtAm(t)) : "";
    default:
      return t[f.key] || "";
  }
}

// ─── Admin-Detail ─────────────────────────────────────────────────────────────

async function _openAdminDetail(id) {
  await _flushPendingSave();
  const t = appData.trainer.find(x => x.id === id);
  if (!t) return;
  currentTrainerId = id;

  document.getElementById("admin-view-liste").style.display = "none";
  document.getElementById("admin-view-detail").style.display = "";
  document.getElementById("admin-detail-title").textContent = `${t.vorname} ${t.nachname}`;
  document.getElementById("admin-detail-error").classList.remove("visible");
  document.getElementById("d-stub-notice").style.display = t.username ? "none" : "";

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
  document.getElementById("d-nebentaetigkeit-betrag").value    = t.nebentaetigkeitBetrag || "";
  document.getElementById("d-nebentaetigkeit-keine").checked   = t.nebentaetigkeit === "keine";
  document.getElementById("d-nebentaetigkeit-andere").checked  = t.nebentaetigkeit === "andere";
  document.getElementById("d-tl-keine").checked = !!t.trainerlizenzNichtVorhanden;
  document.getElementById("d-tl-art").value = t.trainerlizenzArt || "";
  document.getElementById("d-tl-gueltig-bis").value = t.trainerlizenzGueltigBis || "";
  document.getElementById("d-status").value = _trainerStatus(t);
  document.getElementById("d-eingereicht-am").textContent =
    _eingereichtAm(t) ? _fmtIso(_eingereichtAm(t)) : "—";

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
   "d-telefon","d-email","d-iban","d-bankname","d-bic","d-pauschale","d-lizenz",
   "d-nebentaetigkeit-betrag"].forEach(fid => {
    const input = document.getElementById(fid);
    // Vorherige Listener entfernen (neu klonen)
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("input", _scheduleAutosave);
  });
  // Radios brauchen "change" statt "input" plus Sichtbarkeits-Toggle des Betragsfelds.
  // cloneNode(true) übernimmt den zuvor gesetzten .checked-Zustand (Cloning-Steps von
  // <input>), das Neu-Klonen zum Entfernen alter Listener muss also danach passieren.
  ["d-nebentaetigkeit-keine","d-nebentaetigkeit-andere"].forEach(fid => {
    const input = document.getElementById(fid);
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("change", () => {
      _updateNebentaetigkeitBetragVisibility("d");
      _scheduleAutosave();
    });
  });
  _updateNebentaetigkeitBetragVisibility("d");

  // Checkbox "Keine Trainerlizenz vorhanden" + Lizenzart/Gültig-bis — gleiche
  // cloneNode-Konvention wie die Nebentätigkeit-Radios (alte Listener vom vorherigen
  // Trainer entfernen), Sofort-Update der Statuszeile ohne auf den Autosave-Debounce
  // zu warten. Alle drei lesen bei jeder Änderung die aktuellen DOM-Werte aller drei
  // Felder neu (kein Teil-Update), gleiche Konvention wie _saveTrainerlizenzDetails().
  const _tlLiveUpdate = () => {
    _scheduleAutosave();
    const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
    if (idx !== -1) {
      _renderDocumentsSection({
        ...appData.trainer[idx],
        trainerlizenzNichtVorhanden: document.getElementById("d-tl-keine").checked,
        trainerlizenzArt: document.getElementById("d-tl-art").value,
        trainerlizenzGueltigBis: document.getElementById("d-tl-gueltig-bis").value
      });
    }
  };
  {
    const input = document.getElementById("d-tl-keine");
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("change", _tlLiveUpdate);
  }
  {
    const input = document.getElementById("d-tl-art");
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("change", _tlLiveUpdate);
  }
  {
    const input = document.getElementById("d-tl-gueltig-bis");
    const fresh = input.cloneNode(true);
    input.parentNode.replaceChild(fresh, input);
    fresh.addEventListener("input", _tlLiveUpdate);
  }

  // Select feuert kein "input"-Event in allen Browsern zuverlässig -> "change".
  // _statusTouched: erst eine echte Nutzer-Änderung am Dropdown macht den Status
  // zum gespeicherten Override (siehe _collectDetailData).
  _statusTouched = false;
  const statusSel = document.getElementById("d-status");
  const statusFresh = statusSel.cloneNode(true);
  statusFresh.value = statusSel.value;
  statusSel.parentNode.replaceChild(statusFresh, statusSel);
  statusFresh.addEventListener("change", () => { _statusTouched = true; _scheduleAutosave(); });

  if (!t.lizenz) _prefillLizenzFromProfile(t);

  _renderDocumentsSection(t);
  _renderKodexSection(t);
  _renderJugendschutzSection(t);
  _renderChecklisteStatus(t);
}

// ─── Dokumente (Admin-Detail: Führerschein/Führungszeugnis) ────────────────────

function _addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

// Leitet die WebDAV-Config für ein Dokument-Binärobjekt aus davConfig ab (Geschwister-
// Unterordner von trainerdaten.json) — gleiche Technik wie _cloneConfigForUrl().
function _trainerDocConfig(subdir, trainerId) {
  const dir = davConfig.url.slice(0, davConfig.url.lastIndexOf("/"));
  return { ...davConfig, url: dir + "/" + subdir + "/" + trainerId };
}

function _renderDocumentsSection(t) {
  const tlStatusEl   = document.getElementById("d-tl-status");
  const tlAnsehenBtn = document.getElementById("btn-d-tl-ansehen");
  const tlUploadBtn  = document.getElementById("btn-d-tl-upload");
  const tlCameraBtn  = document.getElementById("btn-d-tl-camera");
  const tlArtSel     = document.getElementById("d-tl-art");
  const tlGueltigInp = document.getElementById("d-tl-gueltig-bis");
  if (t.trainerlizenzHochgeladenAm) {
    let html = "Hochgeladen am " + _esc(_fmtIso(t.trainerlizenzHochgeladenAm));
    if (t.trainerlizenzGueltigBis) {
      const abgelaufen = _dateOnlyIsPast(t.trainerlizenzGueltigBis);
      html += ` · <span class="badge ${abgelaufen ? "abgelaufen" : "generiert"}">` +
        `${abgelaufen ? "Abgelaufen seit " : "Gültig bis "}${_esc(_fmtDateOnly(t.trainerlizenzGueltigBis))}</span>`;
    }
    tlStatusEl.innerHTML = html;
    tlAnsehenBtn.disabled = false;
    tlUploadBtn.textContent = "Ersetzen…";
    tlCameraBtn.textContent = "📷 Neu aufnehmen";
  } else if (t.trainerlizenzNichtVorhanden) {
    tlStatusEl.textContent = "Keine Trainerlizenz vorhanden (bestätigt).";
    tlAnsehenBtn.disabled = true;
    tlUploadBtn.textContent = "Hochladen…";
    tlCameraBtn.textContent = "📷 Aufnehmen";
  } else {
    tlStatusEl.textContent = "Noch nicht hochgeladen.";
    tlAnsehenBtn.disabled = true;
    tlUploadBtn.textContent = "Hochladen…";
    tlCameraBtn.textContent = "📷 Aufnehmen";
  }
  tlArtSel.disabled = !!t.trainerlizenzNichtVorhanden;
  tlGueltigInp.disabled = !!t.trainerlizenzNichtVorhanden;

  const fsStatusEl   = document.getElementById("d-fs-status");
  const fsAnsehenBtn = document.getElementById("btn-d-fs-ansehen");
  const fsUploadBtn  = document.getElementById("btn-d-fs-upload");
  const fsCameraBtn  = document.getElementById("btn-d-fs-camera");
  if (t.fuehrerscheinHochgeladenAm) {
    const faelligAm = _addMonths(new Date(t.fuehrerscheinHochgeladenAm), FUEHRERSCHEIN_GUELTIGKEIT_MONATE);
    const gueltig = faelligAm.getTime() > Date.now();
    fsStatusEl.innerHTML = `Hochgeladen am ${_esc(_fmtIso(t.fuehrerscheinHochgeladenAm))} · ` +
      `<span class="badge ${gueltig ? "generiert" : "abgelaufen"}">${gueltig ? "Gültig bis " + _esc(faelligAm.toLocaleDateString("de-DE")) : "Abgelaufen seit " + _esc(faelligAm.toLocaleDateString("de-DE"))}</span>`;
    fsAnsehenBtn.disabled = false;
    fsUploadBtn.textContent = "Ersetzen…";
    fsCameraBtn.textContent = "📷 Neu aufnehmen";
  } else {
    fsStatusEl.textContent = "Noch nicht hochgeladen.";
    fsAnsehenBtn.disabled = true;
    fsUploadBtn.textContent = "Hochladen…";
    fsCameraBtn.textContent = "📷 Aufnehmen";
  }

  const fzStatusEl   = document.getElementById("d-fz-status");
  const fzAnsehenBtn = document.getElementById("btn-d-fz-ansehen");
  const fzUploadBtn  = document.getElementById("btn-d-fz-upload");
  const fzCameraBtn  = document.getElementById("btn-d-fz-camera");
  if (t.fuehrungszeugnisEingereichtAm) {
    fzStatusEl.textContent = "Eingereicht am " + _fmtIso(t.fuehrungszeugnisEingereichtAm);
    fzAnsehenBtn.disabled = false;
    fzUploadBtn.textContent = "Ersetzen…";
    fzCameraBtn.textContent = "📷 Neu aufnehmen";
  } else {
    fzStatusEl.textContent = "Noch nicht eingereicht.";
    fzAnsehenBtn.disabled = true;
    fzUploadBtn.textContent = "Hochladen…";
    fzCameraBtn.textContent = "📷 Aufnehmen";
  }

  const vStatusEl = document.getElementById("d-vertrag-status");
  const vOrigBtn  = document.getElementById("btn-d-vertrag-ansehen");
  const vSignBtn  = document.getElementById("btn-d-vertrag-signiert-ansehen");
  const vResetBtn = document.getElementById("btn-d-vertrag-reset");
  if (t.vertragPdfBereitgestelltAm) {
    let html = "Bereitgestellt am " + _esc(_fmtIso(t.vertragPdfBereitgestelltAm));
    html += t.vertragUnterschriebenAm
      ? ` · <span class="badge generiert">Unterschrieben am ${_esc(_fmtIso(t.vertragUnterschriebenAm))}</span>`
      : ` · <span class="muted">noch nicht unterschrieben</span>`;
    vStatusEl.innerHTML = html;
    vOrigBtn.disabled = false;
    vSignBtn.disabled = !t.vertragUnterschriebenAm;
    vResetBtn.disabled = !t.vertragUnterschriebenAm;
  } else {
    vStatusEl.textContent = "Noch kein Vertrag zugewiesen (per generate-pdfs.ps1 -Zuweisen).";
    vOrigBtn.disabled = true;
    vSignBtn.disabled = true;
    vResetBtn.disabled = true;
  }
}

// Trainerkodex im Admin-Detail: reine Anzeige (Datum + Signatur-Vorschau, Signatur
// liegt inline als DataURL im Datensatz, kein separates Binärobjekt wie bei den drei
// Dokumenten oben) plus ein Zurücksetzen-Button -- anders als Führerschein/Führungs-
// zeugnis/Trainerlizenz kann der Admin hier nichts hochladen (die Bestätigung ist
// eine Selbstauskunft des Trainers, kein Dokument-Scan).
function _renderKodexSection(t) {
  const statusEl = document.getElementById("d-kodex-status");
  const imgEl = document.getElementById("d-kodex-signature");
  const resetBtn = document.getElementById("btn-d-kodex-reset");
  if (t.kodexBestaetigtAm) {
    const faelligAm = _addMonths(new Date(t.kodexBestaetigtAm), KODEX_GUELTIGKEIT_MONATE);
    const abgelaufen = faelligAm.getTime() <= Date.now();
    statusEl.innerHTML = "Bestätigt am " + _esc(_fmtIso(t.kodexBestaetigtAm)) +
      ` · <span class="badge ${abgelaufen ? "abgelaufen" : "generiert"}">` +
      `${abgelaufen ? "Abgelaufen seit " : "Gültig bis "}${_esc(faelligAm.toLocaleDateString("de-DE"))}</span>`;
    if (t.kodexSignatureDataUrl) {
      imgEl.src = t.kodexSignatureDataUrl;
      imgEl.style.display = "";
    } else {
      imgEl.style.display = "none";
    }
    resetBtn.disabled = false;
  } else {
    statusEl.textContent = "Noch nicht bestätigt.";
    imgEl.style.display = "none";
    resetBtn.disabled = true;
  }
}

async function _resetKodexAdmin() {
  if (!currentTrainerId) return;
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  if (!confirm(`Kodex-Bestätigung von ${t.vorname} ${t.nachname} wirklich zurücksetzen?`)) return;

  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  appData.trainer[idx] = { ...appData.trainer[idx], kodexBestaetigtAm: "", kodexSignatureDataUrl: "", kodexVersion: "" };
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Zurücksetzen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  _renderKodexSection(appData.trainer[idx]);
}

// Jugendschutzkonzept im Admin-Detail: gleiches Muster wie _renderKodexSection/
// _resetKodexAdmin (reine Anzeige + Zurücksetzen-Button, kein Upload).
function _renderJugendschutzSection(t) {
  const statusEl = document.getElementById("d-jugendschutz-status");
  const imgEl = document.getElementById("d-jugendschutz-signature");
  const resetBtn = document.getElementById("btn-d-jugendschutz-reset");
  if (t.jugendschutzBestaetigtAm) {
    const faelligAm = _addMonths(new Date(t.jugendschutzBestaetigtAm), JUGENDSCHUTZKONZEPT_GUELTIGKEIT_MONATE);
    const abgelaufen = faelligAm.getTime() <= Date.now();
    statusEl.innerHTML = "Bestätigt am " + _esc(_fmtIso(t.jugendschutzBestaetigtAm)) +
      ` · <span class="badge ${abgelaufen ? "abgelaufen" : "generiert"}">` +
      `${abgelaufen ? "Abgelaufen seit " : "Gültig bis "}${_esc(faelligAm.toLocaleDateString("de-DE"))}</span>`;
    if (t.jugendschutzSignatureDataUrl) {
      imgEl.src = t.jugendschutzSignatureDataUrl;
      imgEl.style.display = "";
    } else {
      imgEl.style.display = "none";
    }
    resetBtn.disabled = false;
  } else {
    statusEl.textContent = "Noch nicht bestätigt.";
    imgEl.style.display = "none";
    resetBtn.disabled = true;
  }
}

async function _resetJugendschutzAdmin() {
  if (!currentTrainerId) return;
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  if (!confirm(`Jugendschutzkonzept-Bestätigung von ${t.vorname} ${t.nachname} wirklich zurücksetzen?`)) return;

  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  appData.trainer[idx] = { ...appData.trainer[idx], jugendschutzBestaetigtAm: "", jugendschutzSignatureDataUrl: "", jugendschutzVersion: "" };
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Zurücksetzen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  _renderJugendschutzSection(appData.trainer[idx]);
}

// Setzt nur die Unterschrift zurueck (vertragPdfPfad/-BereitgestelltAm bleiben
// unangetastet -- der zugewiesene Original-Vertrag bleibt derselbe, siehe
// [[feedback-issued-artifact-no-reset]]). Ermoeglicht erneutes Unterschreiben,
// z.B. zum Testen oder falls sich der Trainer beim Signieren vertan hat.
async function _resetVertragUnterschriftAdmin() {
  if (!currentTrainerId) return;
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  if (!confirm(`Unterschrift des Trainervertrags von ${t.vorname} ${t.nachname} wirklich zurücksetzen? Der Trainer kann danach erneut unterschreiben.`)) return;

  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  appData.trainer[idx] = { ...appData.trainer[idx], vertragUnterschriebenAm: "", vertragSigniertPfad: "", vertragSignatureDataUrl: "" };
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Zurücksetzen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  _renderDocumentsSection(appData.trainer[idx]);
}

async function _uploadDocumentAdmin(subdir, file, dateField, nameField, ctypeField) {
  if (!currentTrainerId) return;
  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  try {
    await davWriteBinary(_trainerDocConfig(subdir, appData.trainer[idx].id), file, file.type || "application/octet-stream");
  } catch (err) {
    errEl.textContent = "Upload fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
    return;
  }

  appData.trainer[idx] = {
    ...appData.trainer[idx],
    [dateField]: new Date().toISOString(),
    [nameField]: file.name,
    [ctypeField]: file.type || "application/octet-stream"
  };
  // Ein tatsächlich hochgeladenes Dokument widerlegt ein zuvor gesetztes "Keine
  // Trainerlizenz vorhanden" — sonst blieben beide Zustände widersprüchlich gespeichert.
  if (dateField === "trainerlizenzHochgeladenAm" && appData.trainer[idx].trainerlizenzNichtVorhanden) {
    appData.trainer[idx].trainerlizenzNichtVorhanden = false;
    const cb = document.getElementById("d-tl-keine");
    if (cb) cb.checked = false;
  }
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Datei hochgeladen, aber Speichern der Metadaten fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  _renderDocumentsSection(appData.trainer[idx]);
}

// Ordnername (Upload-Pfad) -> Trainer-Feld mit dem beim Upload gespeicherten
// Content-Type, siehe Kommentar an davReadBinary() in db.js.
const SUBDIR_CTYPE_FIELD = {
  trainerlizenzen: "trainerlizenzContentType",
  fuehrerscheine: "fuehrerscheinContentType",
  fuehrungszeugnisse: "fuehrungszeugnisContentType"
};

async function _ansehenDocumentAdmin(subdir) {
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  const tab = _openBlobTab();
  try {
    const blob = await davReadBinary(_trainerDocConfig(subdir, t.id), t[SUBDIR_CTYPE_FIELD[subdir]]);
    if (!blob) { tab.abort(); alert("Datei nicht gefunden."); return; }
    tab.show(blob);
  } catch (err) {
    tab.abort();
    alert("Datei nicht abrufbar: " + err.message);
  }
}

// Trainervertrag im Admin-Detail ansehen (Original oder unterschrieben) — läuft wie
// die anderen Admin-Dokument-Ansichten direkt per WebDAV (davReadBinary über den
// CORS-Proxy), nicht über submit-worker.js. Content-Type ist immer application/pdf.
async function _ansehenVertragAdmin(signed) {
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  // Pfad-basiert (seit 1.11): das Skript legt vertraege/<Jahr>/<Name>/ an und speichert
  // den relativen Pfad im Datensatz (vertragPdfPfad/vertragSigniertPfad).
  const relPath = signed ? t.vertragSigniertPfad : t.vertragPdfPfad;
  if (!relPath) { alert("Datei nicht gefunden."); return; }
  const dir = davConfig.url.slice(0, davConfig.url.lastIndexOf("/"));
  const tab = _openBlobTab();
  try {
    const blob = await davReadBinary({ ...davConfig, url: dir + "/" + relPath }, "application/pdf");
    if (!blob) { tab.abort(); alert("Datei nicht gefunden."); return; }
    tab.show(blob);
  } catch (err) {
    tab.abort();
    alert("Datei nicht abrufbar: " + err.message);
  }
}

// Vorbefüllung der Lizenz aus dem zentralen Trainerprofil (ToolsUebersicht), per
// Namensabgleich wie _matchTrainer() — nur wenn das Feld noch leer ist und der Admin
// inzwischen nicht selbst etwas eingetragen oder einen anderen Trainer geöffnet hat.
// Best effort: Admin-Modus läuft über eigene WebDAV-Credentials, ein Gateway-Login
// (tu_session_token) ist hier nicht garantiert vorhanden — Fehler werden verschluckt.
async function _prefillLizenzFromProfile(t) {
  if (trainerProfiles === null) {
    try {
      trainerProfiles = await fetchTrainerProfiles();
    } catch (_) {
      trainerProfiles = [];
      return;
    }
  }
  if (currentTrainerId !== t.id) return;
  const fullName = `${t.vorname} ${t.nachname}`.trim().toLowerCase();
  const matches = trainerProfiles.filter((p) => p.lizenz && `${p.vorname} ${p.nachname}`.trim().toLowerCase() === fullName);
  if (matches.length !== 1) return;
  const el = document.getElementById("d-lizenz");
  if (!el || el.value) return;
  el.value = matches[0].lizenz;
  _scheduleAutosave();
}

// ─── TrainerCheckliste-Status (Phase 3, rein informativ) ───────────────────────
// Liest TrainerCheckliste read-only per WebDAV (TRAINERCHECKLISTE_WEBDAV_URL,
// gleiche Cross-Read-Technik wie _loadFromPersonalkosten), lazy geladen + gecacht.
// Zeigt NUR an, ob Zugang/Abgang abgeschlossen sind -- fließt bewusst an keiner
// Stelle in den Ampel-Status (trainerdatenGesamtOk in admin-worker.js) ein.

// Order-tolerante Namens-Übereinstimmung, gleiche Logik wie sameNamePair() in
// admin-worker.js -- kein gemeinsames Modul zwischen Worker und dieser App,
// kleine Helfer werden konventionsgemäß pro App dupliziert.
function _sameNamePair(aFirst, aLast, bFirst, bLast) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  return (norm(aFirst) === norm(bFirst) && norm(aLast) === norm(bLast)) ||
         (norm(aFirst) === norm(bLast) && norm(aLast) === norm(bFirst));
}

async function _loadTrainerCheckliste() {
  if (_trainerchecklisteEintraege === null) {
    try {
      const raw = await davReadFile(_cloneConfigForUrl(TRAINERCHECKLISTE_WEBDAV_URL));
      _trainerchecklisteEintraege = (raw && Array.isArray(raw.trainerEintraege)) ? raw.trainerEintraege : [];
    } catch (_) {
      _trainerchecklisteEintraege = [];
    }
  }
  return _trainerchecklisteEintraege;
}

// Gleiche Match-Konvention wie buildTrainerRecord() in admin-worker.js: erst
// linkedUsername (Provisioning-Stub), sonst Namensfallback -- Achtung, in
// TrainerCheckliste ist "name" das Nachname-Feld, nicht der volle Name.
function _findChecklisteEintrag(eintraege, t) {
  return eintraege.find((e) =>
    (e.linkedUsername && t.username && e.linkedUsername === t.username) ||
    _sameNamePair(e.vorname, e.name, t.vorname, t.nachname)) || null;
}

async function _renderChecklisteStatus(t) {
  const el = document.getElementById("d-checkliste-status");
  el.textContent = "wird geladen …";
  const eintraege = await _loadTrainerCheckliste();
  if (currentTrainerId !== t.id) return; // Admin hat währenddessen einen anderen Trainer geöffnet
  const eintrag = _findChecklisteEintrag(eintraege, t);
  const teil = (s) => (s && s.abgeschlossen) ? '<span class="badge generiert">✓</span>' : '<span class="badge offen">–</span>';
  el.innerHTML = eintrag
    ? `Zugang ${teil(eintrag.zugang)} · Abgang ${teil(eintrag.abgang)}`
    : "kein Eintrag gefunden";
}

function _collectDetailData() {
  const data = {
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
    lizenz:       document.getElementById("d-lizenz").value.trim(),
    nebentaetigkeit: (document.querySelector('input[name="d-nebentaetigkeit"]:checked') || {}).value || "",
    nebentaetigkeitBetrag: document.getElementById("d-nebentaetigkeit-betrag").value.trim(),
    trainerlizenzNichtVorhanden: document.getElementById("d-tl-keine").checked,
    trainerlizenzArt: document.getElementById("d-tl-art").value,
    trainerlizenzGueltigBis: document.getElementById("d-tl-gueltig-bis").value
  };
  // status nur übernehmen, wenn der Admin das Dropdown in dieser Detail-Sitzung
  // wirklich angefasst hat. Sonst würde jedes Autosave (z.B. Pauschale tippen) den
  // gerade ANGEZEIGTEN, automatisch abgeleiteten Status als expliziten Override
  // festschreiben — und damit künftige automatische Übergänge (Stub reicht ein
  // -> "Ausstehend") dauerhaft maskieren.
  if (_statusTouched) data.status = document.getElementById("d-status").value;
  return data;
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

// Rückgabe: null bei Erfolg (oder wenn nichts zu tun war), sonst die Fehlermeldung.
async function _doSave() {
  if (!davConfig || !currentTrainerId) return null;
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return null;

  const updated = { ...appData.trainer[idx], ..._collectDetailData() };
  appData.trainer[idx] = updated;

  const statusEl = document.getElementById("settings-save-status");
  statusEl.textContent = "Speichere …";
  try {
    await _saveMerged();
    statusEl.textContent = "Gespeichert ✓";
    setTimeout(() => { statusEl.textContent = "Automatisches Speichern aktiv"; }, 2500);
    return null;
  } catch (err) {
    statusEl.textContent = "Speicherfehler: " + err.message;
    return err.message;
  }
}

// Wird vor jedem Verlassen der Detailansicht aufgerufen (Zurück-Button oder
// Öffnen eines anderen Trainers): eine noch laufende Debounce-Verzögerung
// (1,2s nach der letzten Eingabe) würde sonst beim Umschalten von
// currentTrainerId verwaisen und _doSave() bräche wegen des Guards oben
// stillschweigend ab — die zuletzt eingegebene Änderung wäre verloren.
async function _flushPendingSave() {
  if (saveTid === null) return;
  clearTimeout(saveTid);
  saveTid = null;
  await _doSave();
}

// Expliziter "Speichern"-Button in der Detailansicht: sofort speichern statt
// auf den Debounce zu warten, mit direkt sichtbarem Ergebnis (Autosave-Status
// lebt nur im Einstellungen-Tab und ist von hier aus nicht sichtbar).
async function _saveDetailNow() {
  const btn = document.getElementById("btn-d-speichern");
  clearTimeout(saveTid);
  saveTid = null;
  btn.disabled = true;
  btn.textContent = "Speichere …";
  const error = await _doSave();
  btn.disabled = false;
  if (error) {
    btn.textContent = "Speichern";
    const errEl = document.getElementById("admin-detail-error");
    errEl.textContent = "Speichern fehlgeschlagen: " + error;
    errEl.classList.add("visible");
  } else {
    btn.textContent = "Gespeichert ✓";
    setTimeout(() => { btn.textContent = "Speichern"; }, 2000);
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
    appData.trainer[idx].status = "generiert";
    await _saveMerged();

    // Select in der Detailansicht nachziehen, sonst zeigt es bis zum nächsten
    // Öffnen noch den alten Stand (Autosave würde ihn sonst zurückschreiben).
    const statusSel = document.getElementById("d-status");
    if (statusSel) statusSel.value = "generiert";

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

// ─── Import: Vorschau, Übernahme, Aktueller Stand ──────────────────────────────
// _importRows ist ein Array von [name, lizenz, pauschale]-Tripeln. Wird seit
// 1.2 ausschließlich von _loadFromPersonalkosten() befüllt (siehe unten);
// Matching/Stub-Erzeugung/Vorschau/Übernahme darunter sind quellen-agnostisch.

let _importRows = [];

// ─── Personalkosten-Sync ──────────────────────────────────────────────────────
// Liest Lizenz + monatliche Pauschale read-only aus der Personalkosten-App
// (gleiche Nextcloud-Freigabe/Account, siehe PERSONALKOSTEN_WEBDAV_URL in
// config.js) und speist sie in die bestehende Vorschau/Übernahme unten ein.
// Personalkosten ist damit die einzige Pflegestelle für diese Werte, kein
// manuelles Einfügen mehr.

function _cloneConfigForUrl(url) {
  return { ...davConfig, url };
}

// Repliziert betragOf/trainerAe100/trainerAeIst aus E:\Personalkosten\app.js
// (Stand 2026-07-07). Kein gemeinsames JS-Modul zwischen den beiden Build-
// step-losen Apps — bei einer künftigen Formeländerung dort muss dieser Block
// manuell nachgezogen werden (gleiche Duplizierungs-Konvention wie _matchTrainer()).
function _betragOf(list, label) {
  if (!label) return 0;
  const hit = (list || []).find(x => x.label === label);
  return hit ? (Number(hit.betrag) || 0) : 0;
}
function _trainerAe100(t, parameter) {
  return _betragOf(parameter.positionen, t.position)
    + _betragOf(parameter.lizenzen, t.lizenz)
    + _betragOf(parameter.landesebene, t.landesebene)
    + _betragOf(parameter.jahrgangsleiter, t.jahrgangsleiter);
}
function _trainerAeIst(t, parameter) {
  // manuellAE: 0 ist ein gültiger Override (siehe Personalkosten) - deshalb
  // explizit auf null/"" prüfen statt auf Truthy.
  if (t.manuellAE != null && t.manuellAE !== "") return Number(t.manuellAE) || 0;
  return _trainerAe100(t, parameter) * (Number(t.stelle) || 0);
}

// Gibt die Pauschale im selben Rohformat zurück, das der bisherige manuelle
// Text-Import lieferte: einfache Zahl als String, Komma als Dezimaltrennzeichen
// nur bei Nachkommastellen, kein Euro-Zeichen - wird unverändert in den
// {{PAUSCHALE}}-Platzhalter im Word-Vertrag gespliced (siehe pdf-utils.js).
function _fmtPauschale(n) {
  return (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

async function _loadFromPersonalkosten() {
  const errEl = document.getElementById("import-error");
  errEl.classList.remove("visible");
  const btn = document.getElementById("btn-import-load-pk");
  btn.disabled = true;
  btn.textContent = "Lade …";

  try {
    const raw = await davReadFile(_cloneConfigForUrl(PERSONALKOSTEN_WEBDAV_URL));
    if (!raw || !raw.meta || !raw.seasons) {
      throw new Error("Personalkosten-Datei leer oder unerwartetes Format.");
    }
    const season = raw.seasons[raw.meta.currentSeason];
    if (!season || !Array.isArray(season.trainer)) {
      throw new Error(`Saison „${raw.meta.currentSeason}" nicht in Personalkosten gefunden.`);
    }
    const parameter = raw.parameter || {};

    _importRows = season.trainer
      .map(t => [
        (t.name || "").trim(),
        (t.lizenz || "").trim(),
        _fmtPauschale(_trainerAeIst(t, parameter))
      ])
      .filter(cols => cols[0] && cols[0] !== "0");

    if (!_importRows.length) {
      throw new Error("Keine Trainer in Personalkosten gefunden.");
    }

    // Frisch laden (nicht über mehrere Ladevorgänge hinweg cachen), damit eine
    // zwischenzeitliche Gruppenänderung nicht übersehen wird. Schlägt das fehl,
    // bricht der Import komplett ab statt Namen ungeprüft durchzulassen.
    try {
      trainerGroupMembers = await _fetchTrainerGroupMembers();
    } catch (err) {
      throw new Error(`Gruppe „Trainer“ (ToolsUebersicht) konnte nicht geladen werden: ${err.message} — erfordert ein ToolsUebersicht-Admin-Login in diesem Browser.`);
    }
    if (trainerProfiles === null) trainerProfiles = await fetchTrainerProfiles().catch(() => []);

    _renderTextImportPreview();
    document.getElementById("import-step-1").style.display = "none";
    document.getElementById("import-step-2").style.display = "";
  } catch (err) {
    errEl.textContent = "Fehler beim Laden von Personalkosten: " + err.message;
    errEl.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Von Personalkosten laden";
  }
}

function _initImport() {
  document.getElementById("btn-import-load-pk").addEventListener("click", _loadFromPersonalkosten);
  document.getElementById("btn-import-start").addEventListener("click", _doImport);
  document.getElementById("btn-import-reset").addEventListener("click", _resetImport);
  document.getElementById("btn-import-nochmal").addEventListener("click", _resetImport);
}

function _resetImport() {
  _importRows = [];
  document.getElementById("import-step-1").style.display = "";
  document.getElementById("import-step-2").style.display = "none";
  document.getElementById("import-step-3").style.display = "none";
  document.getElementById("import-error").classList.remove("visible");
  document.getElementById("import-preview-wrap").innerHTML = "";
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

// Gleiche Konvention wie der Nachname-Fallback in _matchTrainer: letztes Wort
// wird zum Nachnamen, der Rest zum Vornamen (bei nur einem Wort bleibt der
// Vorname leer). Admin kann Fehlgriffe später in der Detailansicht korrigieren.
function _splitNameForStub(fullName) {
  const words = fullName.trim().split(/\s+/);
  if (words.length === 1) return { vorname: "", nachname: words[0] };
  return { vorname: words.slice(0, -1).join(" "), nachname: words[words.length - 1] };
}

// Zentrales Trainerprofil (ToolsUebersicht) zu einem Personalkosten-Namen, per
// gleicher order-toleranter Übereinstimmung wie _sameNamePair — null, wenn kein
// eindeutiger Treffer.
function _matchTrainerProfile(fullName) {
  const { vorname, nachname } = _splitNameForStub(fullName);
  const matches = (trainerProfiles || []).filter((p) => _sameNamePair(p.vorname, p.nachname, vorname, nachname));
  return matches.length === 1 ? matches[0] : null;
}

// Ob für einen NEUEN (noch nicht vorhandenen) Namen ein Stub-Trainer angelegt
// werden darf: Mitglied der Gruppe "Trainer" ODER individuell als
// "Vertrag benötigt" markiert (z.B. Helfer/Betreuer ohne Trainer-Rolle, die
// trotzdem einen Vertrag brauchen — Checkbox in der ToolsUebersicht-
// Nutzerverwaltung, User-Entscheidung 2026-07-12). Kein eindeutiger
// Namenstreffer -> false (fail-closed, siehe _fetchTrainerGroupMembers).
function _neuerStubErlaubt(fullName) {
  const profil = _matchTrainerProfile(fullName);
  if (!profil) return false;
  return !!(trainerGroupMembers && trainerGroupMembers.has(profil.username)) || !!profil.vertragBenoetigt;
}

// Gruppe "Trainer" (ToolsUebersicht) für den Personalkosten-Import: neue Stub-
// Trainer werden seit 1.19 nur noch für Namen angelegt, die entweder Mitglied
// dieser Gruppe sind oder individuell als "Vertrag benötigt" markiert wurden
// (siehe _neuerStubErlaubt, [[project-toolsuebersicht]]) — verhindert
// Personalkosten-Stub-Leichen für Nicht-Trainer ohne Vertragsbedarf.
// Bestehende Treffer (auch alte Stubs) sind davon unberührt, nur die Neuanlage
// ist eingeschränkt.
async function _fetchTrainerGroupMembers() {
  const data = await gatewayRequest({ action: "list-groups" });
  const gruppe = (data.groups || []).find((g) => g.name === "Trainer");
  return new Set(gruppe ? (gruppe.memberUsernames || []) : []);
}

// Minimaler Trainer-Datensatz für Namen aus dem Import, die keinen bestehenden
// Trainer treffen — bewusst ohne username/iban/adresse/unterschrift: wird beim
// Admin-Öffnen als "Unvollständig" markiert und beim ersten echten Self-Submit
// server-seitig per Namensabgleich ergänzt statt dupliziert (siehe submit-worker.js).
function _createStubTrainer(fullName) {
  const { vorname, nachname } = _splitNameForStub(fullName);
  return {
    id: crypto.randomUUID(),
    vorname,
    nachname,
    lizenz: "",
    pauschale: "",
    erstelltAm: new Date().toISOString(),
    vertragsGeneriert: false
  };
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
    const blocked   = !match && !_neuerStubErlaubt(name);
    const status    = match
      ? `<span class="badge generiert">→ ${_esc(match.vorname)} ${_esc(match.nachname)}</span>`
      : blocked
        ? `<span class="badge offen">Nicht in Gruppe „Trainer“ / kein Vertrag markiert</span>`
        : `<span class="badge generiert">Neuer Trainer</span>`;
    const action    = blocked
      ? `<button type="button" class="btn small" disabled title="Weder Mitglied der Gruppe „Trainer“ noch als „Vertrag benötigt“ markiert (ToolsUebersicht-Nutzerverwaltung)">Übersprungen</button>`
      : `<button type="button" class="btn success small" data-import-row="${i}">${match ? "Importieren" : "Neu anlegen"}</button>`;
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

  let trainer = _matchTrainer(name);
  let isNew   = false;
  if (!trainer) {
    trainer = _createStubTrainer(name);
    appData.trainer.push(trainer);
    isNew = true;
  }

  const statusEl = document.querySelector(`[data-row-status="${idx}"]`);
  btn.disabled = true;
  btn.textContent = "Speichere …";

  const tIdx = appData.trainer.indexOf(trainer);
  if (lizenz && lizenz !== "0") appData.trainer[tIdx].lizenz = lizenz;
  if (pauschale !== "") appData.trainer[tIdx].pauschale = pauschale;

  try {
    await _saveMerged();
  } catch (err) {
    if (isNew) appData.trainer.splice(tIdx, 1); // Stub bei Fehlschlag nicht im Arbeitsspeicher behalten
    if (statusEl) statusEl.innerHTML = `<span class="badge" style="background:var(--red-light); color:var(--red);">Fehler: ${_esc(err.message)}</span>`;
    btn.disabled = false;
    btn.textContent = isNew ? "Neu anlegen" : "Importieren";
    return;
  }

  if (statusEl) statusEl.innerHTML = `<span class="badge generiert">✓ ${isNew ? "neu angelegt" : "übernommen"}</span>`;
  btn.disabled = false;
  btn.textContent = isNew ? "Erneut speichern" : "Erneut importieren";
  _renderImportCurrentStatus();
  _renderAdminListe();
}

async function _doImport() {
  const updatedList = [];
  const createdList = [];
  const skippedList = []; // Namen ohne Gruppe-Trainer-Mitgliedschaft, siehe _fetchTrainerGroupMembers
  const newStubs = []; // zum Rollback, falls _saveMerged() fehlschlägt

  for (const cols of _importRows) {
    const name      = (cols[0] || "").trim();
    const lizenz    = (cols[1] || "").trim();
    const pauschale = (cols[2] || "").trim();

    if (!name || name === "0") continue;

    let trainer = _matchTrainer(name);
    let isNew   = false;
    if (!trainer) {
      if (!_neuerStubErlaubt(name)) {
        skippedList.push(name);
        continue;
      }
      trainer = _createStubTrainer(name);
      appData.trainer.push(trainer);
      newStubs.push(trainer);
      isNew = true;
    }

    const idx = appData.trainer.indexOf(trainer);
    if (lizenz && lizenz !== "0") appData.trainer[idx].lizenz = lizenz;
    if (pauschale !== "") appData.trainer[idx].pauschale = pauschale;

    const entry = {
      name: (trainer.vorname + " " + trainer.nachname).trim(),
      lizenz: appData.trainer[idx].lizenz || "",
      pauschale: appData.trainer[idx].pauschale || ""
    };
    (isNew ? createdList : updatedList).push(entry);
  }

  const btn = document.getElementById("btn-import-start");
  btn.disabled = true;
  btn.textContent = "Speichere …";
  try {
    await _saveMerged();
  } catch (err) {
    newStubs.forEach(s => {
      const i = appData.trainer.indexOf(s);
      if (i !== -1) appData.trainer.splice(i, 1);
    });
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

  const asTable = list => list.length ? `
    <table style="width:100%; border-collapse:collapse; font-size:13px; margin:10px 0 16px;">
      <thead style="background:var(--gray);">
        <tr>
          <th style="padding:6px 10px; text-align:left;">Name</th>
          <th style="padding:6px 10px; text-align:left;">Lizenz</th>
          <th style="padding:6px 10px; text-align:left;">Pauschale</th>
        </tr>
      </thead>
      <tbody>${list.map(u => `<tr>
        <td style="padding:6px 10px;">${_esc(u.name)}</td>
        <td style="padding:6px 10px;">${_esc(u.lizenz)}</td>
        <td style="padding:6px 10px;">${_esc(u.pauschale)}</td>
      </tr>`).join("")}</tbody>
    </table>
  ` : "";

  document.getElementById("import-result").innerHTML = `
    <p style="color:var(--green); font-weight:700; font-size:15px; margin-bottom:8px;">
      Import abgeschlossen
    </p>
    <p class="muted"><strong>${updatedList.length}</strong> bestehende Trainer aktualisiert</p>
    ${asTable(updatedList)}
    ${createdList.length ? `<p class="muted"><strong>${createdList.length}</strong> neue, unvollständige Trainer angelegt — Stammdaten (IBAN, Adresse, Unterschrift) fehlen noch, bis sich die Person selbst über das Trainer-Formular anmeldet oder ein Admin sie manuell ergänzt:</p>` : ""}
    ${asTable(createdList)}
    ${skippedList.length ? `<p class="muted"><strong>${skippedList.length}</strong> übersprungen (nicht Mitglied der Gruppe „Trainer“ in ToolsUebersicht): ${skippedList.map(_esc).join(", ")}</p>` : ""}
  `;
  _renderImportCurrentStatus();
  _renderAdminListe();
}
