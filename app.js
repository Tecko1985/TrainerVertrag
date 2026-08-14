// Hauptlogik: Trainer-Flow (Formular + Submit) und Admin-Flow (WebDAV, Liste, Detail, PDF).

// ─── State ───────────────────────────────────────────────────────────────────

let appData   = { version: 1, trainer: [] }; // Arbeitskopie im Admin-Modus
let davConfig = null;
let saveTid   = null;
let aktiverTab = "meine"; // "meine" | "liste" | "import" | "einstellungen" | "info" — Haupt-Nav, siehe _zeigeTab()
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
// Bekommt der eingeloggte Nutzer einen Trainervertrag (Gruppe "Trainer" ODER Häkchen
// "Vertrag benötigt")? Kommt server-verifiziert aus me() — der Client kann es nicht
// selbst ableiten, weil currentGroupIds nur IDs enthält, nicht den Gruppennamen.
// false = reines Kontaktdaten-Formular (z.B. Geschäftsführung), siehe
// _applyVertragspflichtGate(). Default true: ein Gateway, das die Frage (noch) nicht
// beantwortet, darf niemandem seine Vertragsdaten wegnehmen — gleiche Übergangs-
// toleranz wie in verifySession() im submit-worker.
let currentVertragspflichtig = true;
// Original-Intro-Text des Hauptformulars aus index.html, beim ersten
// _applyVertragspflichtGate() gesichert (siehe dort).
let _introTextTrainer = null;
let _fuehrerscheinRegisterList = null; // nur befüllt, wenn Admin/Gruppe fuehrerschein-einsicht
let trainerProfiles = null; // zentrale Lizenz/Mannschaft-Profile aller Nutzer, lazy geladen (siehe _openAdminDetail)
let trainerGroupMembers = null; // Nutzernamen der ToolsUebersicht-Gruppe "Trainer", frisch geladen bei jedem Personalkosten-Import (siehe _loadFromPersonalkosten)
let filterGruppen = null; // ALLE Gateway-Gruppen [{id, name, members:Set}] für den Gruppen-Filter der Admin-Liste, lazy (siehe _ensureFilterGruppen)
let _filterGruppenVersucht = false; // ein Ladeversuch pro Sitzung — ohne Gateway-Admin-Login bleibt der Filter deaktiviert
let _trainerchecklisteEintraege = null; // TrainerCheckliste-Rohdaten (read-only Cross-Read), lazy geladen (siehe _renderChecklisteStatus)
let myChecklisteStatus = null; // eigener TrainerCheckliste-Eintrag (Trainer-Selbstbedienung, seit 1.8), einmalig geladen in _initTrainerGateway (siehe _renderMyChecklisteStatus)
let _checklisteDetailOpen = false; // Aufklapp-Zustand der "Öffnen"-Detailansicht, überlebt Re-Render (siehe _showTrainerFormScreen)
let _statusTouched = false; // Status-Dropdown im Admin-Detail in dieser Sitzung angefasst? (siehe _collectDetailData)
let _adminZugriffErlaubt = false; // Administrieren-Stufe des eingeloggten Kontos (siehe _initAdminZugang) — steuert Sichtbarkeit des Einstellungen-Buttons + den Versionsbadge-Sprung

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  _renderChangelog();
  _populateLizenzArtSelect("tf-tl-art");
  _populateLizenzArtSelect("d-tl-art");
  _initTrainerForm();
  _initTrainerDocuments();
  _initTrainerKodex();
  _initTrainerJugendschutz();
  _initTrainerVertrag();
  _initMainNav();
  _initAdminConnect();
  _initAdminPanel();
  _initImport();
  _initAdminZugang();
  _tryRestoreAdminSession();
  _initTrainerGateway();
});

// Die Verwaltungs-Tabs (Trainer/Import/Einstellungen) sind nur sichtbar, wenn
// das eingeloggte Konto den Bereich auch öffnen darf (Admin oder Administrieren-
// Stufe der Trainerdaten — das Bearbeiten-Häkchen reicht seit der dritten
// Rechte-Stufe bewusst nicht mehr, hier hängt die IBAN-Vollsicht dran) —
// dieselbe Prüfung, die der Zugangs-Worker serverseitig bei jedem Zugriff
// erzwingt; hier steuert sie nur die Sichtbarkeit. Die Buttons sind im HTML
// default versteckt, damit Unberechtigten nie kurz welche aufblitzen;
// Berechtigte sehen sie nach der kurzen Gateway-Prüfung.
async function _initAdminZugang() {
  if (!getSessionToken()) return;
  try {
    _adminZugriffErlaubt = await checkTrainerdatenAdminPermission();
  } catch (_) {
    _adminZugriffErlaubt = false;
  }
  if (!_adminZugriffErlaubt) return;
  document.querySelectorAll("#main-nav .admin-only-tab").forEach(b => { b.style.display = ""; });
}

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
    // `!== false` statt `!!`: siehe Deklaration oben — ein Gateway ohne das Feld
    // (noch nicht redeployed) lässt das Formular unverändert vollständig.
    currentVertragspflichtig = me.vertragspflichtig !== false;
    _applyVertragspflichtGate();

    // Woran erkennt man "hat das Hauptformular schon ausgefüllt"? Am jeweiligen
    // Pflichtfeld der eigenen Einreichungsart (gleiche Bedingung wie handleSubmit im
    // Worker prüft): Ein Datensatz allein reicht nicht, er kann auch nur von einem
    // Dokument-Upload stammen (resolveOwnTrainerRecord) oder ein Import-Stub sein.
    // Für Vertragspflichtige ist das die iban, für alle anderen die email — sonst
    // landete ein Nicht-Trainer nach dem Einreichen wieder auf dem leeren Formular
    // statt auf seiner Bestätigung, weil er nie eine iban bekommt.
    const eigenesPflichtfeldDa = saved && (currentVertragspflichtig ? saved.iban : saved.email);
    if (eigenesPflichtfeldDa) {
      myTrainerRecord = saved;
      _renderTrainerReceipt(myTrainerRecord);
      _showReceiptScreen({ justSubmitted: false });
    } else {
      myTrainerRecord = saved || null;
      // Vorbefüllung MUSS vor _showTrainerFormScreen() passieren -- die ruft am Ende
      // _updateTrainerFormBadges() auf, das sonst mit noch leeren Feldern rechnet.
      document.getElementById("tf-vorname").value  = (saved && saved.vorname) || currentVorname  || "";
      document.getElementById("tf-nachname").value = (saved && saved.nachname) || currentNachname || "";
      _showTrainerFormScreen();
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

// Die drei Panels (Dokumente, Trainerkodex, Jugendschutzkonzept) hängen alle am
// Trainervertrag und werden deshalb gemeinsam gegated. Liefert zurück, ob sie sichtbar
// sind — die Aufrufer sparen sich damit resize()/Render-Arbeit für Karten, die gar
// nicht im Dokument stehen.
function _showTrainerVertragsPanels() {
  const anzeige = currentVertragspflichtig ? "" : "none";
  document.getElementById("trainer-documents-panel").style.display = anzeige;
  document.getElementById("trainer-kodex-panel").style.display = anzeige;
  document.getElementById("trainer-jugendschutz-panel").style.display = anzeige;
  return currentVertragspflichtig;
}

function _showTrainerFormScreen() {
  document.getElementById("trainer-connect-screen").style.display = "none";
  document.getElementById("trainer-form-screen").style.display = "";
  document.getElementById("trainer-success-screen").style.display = "none";
  if (_showTrainerVertragsPanels()) {
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
  _updateTrainerFormBadges();
}

// Blendet alles aus, was ausschließlich dem Trainervertrag dient, wenn der eingeloggte
// Nutzer gar keinen bekommt: Bankverbindung, Anlage 1 und Unterschrift im Haupt-
// formular. Übrig bleibt genau das, was der Verein braucht, um die Person zu
// erreichen — Name, Geburtsdatum, Anschrift, Telefon, E-Mail. Die drei Dokument-Panels
// erledigt _showTrainerVertragsPanels() bei jedem Screen-Wechsel.
// Nach dem Login aufgerufen; der Worker verwirft die Felder zusätzlich serverseitig,
// das hier ist die Anzeige-Seite derselben Regel.
// Bewusst symmetrisch (setzt beide Richtungen, nicht nur "ausblenden"): sonst hinge
// der Zustand des zuletzt geladenen Kontos in der Seite fest, sobald die Funktion je
// ein zweites Mal mit anderem Ergebnis läuft.
function _applyVertragspflichtGate() {
  // Trainer-Fassung des Intro-Texts steht im HTML und ist dort gepflegt — beim ersten
  // Lauf sichern statt sie hier ein zweites Mal auszuformulieren.
  const intro = document.getElementById("tf-intro-text");
  if (_introTextTrainer === null) _introTextTrainer = intro.textContent;

  document.getElementById("tf-vertragsdaten").style.display = currentVertragspflichtig ? "" : "none";
  // E-Mail rückt an die Stelle von IBAN/Nebentätigkeit: einziges Pflichtfeld dieser
  // Einreichungsart (gleiche Bedingung wie Worker-Prüfung und Dashboard-Ampel).
  document.getElementById("tf-email-field").classList.toggle("required", !currentVertragspflichtig);
  intro.textContent = currentVertragspflichtig
    ? _introTextTrainer
    : "Bitte hinterleg hier deine Kontaktdaten, damit der Verein dich erreichen kann. " +
      "Deine Daten werden sicher auf unserem Vereinsserver gespeichert.";
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
  trainerSigPad = createSignaturePad(canvas, _updateTrainerFormBadges);

  document.getElementById("btn-sig-clear").addEventListener("click", () => {
    trainerSigPad.clear();
    _updateTrainerFormBadges();
  });

  document.getElementById("trainer-form").addEventListener("submit", _handleTrainerSubmit);

  document.getElementById("btn-trainer-edit").addEventListener("click", _startEditTrainer);

  document.querySelectorAll('input[name="tf-nebentaetigkeit"]').forEach(r => {
    r.addEventListener("change", () => { _updateNebentaetigkeitBetragVisibility("tf"); _updateTrainerFormBadges(); });
  });
  document.getElementById("tf-nebentaetigkeit-betrag").addEventListener("input", _updateTrainerFormBadges);
  document.getElementById("tf-vorname").addEventListener("input", _updateTrainerFormBadges);
  document.getElementById("tf-nachname").addEventListener("input", _updateTrainerFormBadges);

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
    _updateTrainerFormBadges();
  });
}

// Aktualisiert das EINE Gesamt-Badge des Hauptformulars live bei jeder Eingabe (alle
// vier Bereiche zusammen in einer Karte, kein Einzel-Badge pro Bereich) -- anders als
// die übrigen Karten (Server-Status) ist das hier reiner Client-Zustand, noch nicht
// gespeichert. Prüft dieselben Pflichtfelder wie _handleTrainerSubmit, plus zusätzlich
// die Unterschrift (dort bewusst kein Pflichtfeld fürs Absenden, verdient aber trotzdem
// einen eigenen ausgefüllt/nicht-Status) -- "✓" heißt hier also strenger als "Absenden
// würde durchgehen": wirklich alles inkl. Unterschrift ist da.
function _updateTrainerFormBadges() {
  const vorname  = document.getElementById("tf-vorname").value.trim();
  const nachname = document.getElementById("tf-nachname").value.trim();
  const persoenlichOk = !!(vorname && nachname);

  // Ohne Vertragspflicht zählt nur, was die Person auch sieht: Name + E-Mail. Würde
  // hier weiter die IBAN geprüft, stünde das Badge dauerhaft auf "offen" für ein Feld,
  // das gar nicht im Formular ist.
  if (!currentVertragspflichtig) {
    const emailOk = !!document.getElementById("tf-email").value.trim();
    _setAccordionState("tf-hauptformular-card", (persoenlichOk && emailOk) ? "done" : "open", "tf-hauptformular-badge");
    return;
  }

  const iban = document.getElementById("tf-iban").value.replace(/\s+/g, "").toUpperCase();
  const ibanOk = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban);

  const nebenEl = document.querySelector('input[name="tf-nebentaetigkeit"]:checked');
  const betrag = document.getElementById("tf-nebentaetigkeit-betrag").value.trim();
  const nebenOk = !!nebenEl && (nebenEl.value !== "andere" || !!betrag);

  const unterschriftOk = !trainerSigPad.isEmpty();

  const alles = persoenlichOk && ibanOk && nebenOk && unterschriftOk;
  _setAccordionState("tf-hauptformular-card", alles ? "done" : "open", "tf-hauptformular-badge");
}

async function _handleTrainerSubmit(e) {
  e.preventDefault();
  _setTrainerError("");

  const vorname  = document.getElementById("tf-vorname").value.trim();
  const nachname = document.getElementById("tf-nachname").value.trim();
  const email    = document.getElementById("tf-email").value.trim().toLowerCase();

  if (!vorname)  return _setTrainerError("Bitte Vorname eingeben.");
  if (!nachname) return _setTrainerError("Bitte Nachname eingeben.");

  // Die Basisdaten sind für beide Einreichungsarten gleich; alles Weitere hängt am
  // Trainervertrag und wird nur geprüft/mitgeschickt, wenn es einen gibt. Die
  // Bedingungen spiegeln handleSubmit im Worker — der lehnt sonst ab, was das
  // Formular durchgelassen hat.
  const payload = {
    vorname,
    nachname,
    geburtsdatum: document.getElementById("tf-geburtsdatum").value,
    strasse:      document.getElementById("tf-strasse").value.trim(),
    plz:          document.getElementById("tf-plz").value.trim(),
    ort:          document.getElementById("tf-ort").value.trim(),
    telefon:      document.getElementById("tf-telefon").value.trim(),
    email
  };

  if (currentVertragspflichtig) {
    const iban = document.getElementById("tf-iban").value.replace(/\s+/g, "").toUpperCase();
    if (!iban) return _setTrainerError("Bitte IBAN eingeben.");
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

    payload.iban = iban;
    payload.bankname = document.getElementById("tf-bankname").value.trim();
    payload.bic = document.getElementById("tf-bic").value.trim().toUpperCase();
    payload.nebentaetigkeit = nebentaetigkeit;
    payload.nebentaetigkeitBetrag = nebentaetigkeit === "andere" ? nebentaetigkeitBetrag : "";
    payload.signatureDataUrl = trainerSigPad.toDataURL();
  } else if (!email) {
    // Einziges zusätzliches Pflichtfeld dieser Einreichungsart — ohne E-Mail wäre der
    // Datensatz zwecklos, sie ist der Grund für das Formular (Kontaktaufnahme).
    return _setTrainerError("Bitte E-Mail-Adresse eingeben, damit der Verein dich erreichen kann.");
  }

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
  // Ohne Vertragspflicht gibt es auch keinen Vertrag, auf den man warten könnte.
  document.getElementById("success-text").textContent = justSubmitted
    ? (currentVertragspflichtig
        ? "Deine Daten wurden erfolgreich eingereicht. Der Verein wird sich bei dir melden, sobald dein Trainervertrag fertig ist."
        : "Deine Kontaktdaten wurden erfolgreich hinterlegt. Danke!")
    : "Du hast mit diesem Konto bereits Daten eingereicht. Falls sich etwas geändert hat, kannst du sie unten bearbeiten.";
  document.getElementById("trainer-connect-screen").style.display = "none";
  document.getElementById("trainer-form-screen").style.display = "none";
  document.getElementById("trainer-success-screen").style.display = "";
  if (!_showTrainerVertragsPanels()) return;
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

  // Vertragsspezifische Zeilen ganz weglassen statt mit "—" zu füllen: wer keinen
  // Vertrag bekommt, hat diese Felder nie gesehen und soll sie hier auch nicht
  // erklärt bekommen müssen.
  const vertragsZeilen = ["r-row-iban", "r-row-bankname", "r-row-bic", "r-row-nebentaetigkeit", "r-unterschrift-divider"];
  for (const id of vertragsZeilen) {
    document.getElementById(id).style.display = currentVertragspflichtig ? "" : "none";
  }

  const sigImg = document.getElementById("r-signature");
  if (!currentVertragspflichtig) {
    sigImg.style.display = "none";
    return;
  }

  document.getElementById("r-iban").textContent = payload.iban ? payload.iban.replace(/(.{4})/g, "$1 ").trim() : "—";
  document.getElementById("r-bankname").textContent = payload.bankname || "—";
  document.getElementById("r-bic").textContent = payload.bic || "—";
  document.getElementById("r-nebentaetigkeit").textContent =
    payload.nebentaetigkeit === "andere" ? `Ja, ${payload.nebentaetigkeitBetrag || "—"} EUR`
    : payload.nebentaetigkeit === "keine" ? "Keine"
    : "—";

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
  // Ablauf mitwerten (wie Führerschein/Kodex-Badge und die Server-Ampel `lizenzOk`
  // in admin-worker.js): eine hochgeladene, aber abgelaufene Lizenz ist NICHT
  // erledigt -- sonst grünes Häkchen trotz roter Dashboard-Ampel.
  const tlErledigt = t.trainerlizenzNichtVorhanden ||
    (t.trainerlizenzHochgeladenAm && !(t.trainerlizenzGueltigBis && _dateOnlyIsPast(t.trainerlizenzGueltigBis)));
  _setAccordionState("tf-tl-card", tlErledigt ? "done" : "open", "tf-tl-badge");

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
    const data = await submitVertragUnterschrift(signedBlob);
    myTrainerRecord = {
      ...(myTrainerRecord || {}),
      vertragUnterschriebenAm: data.vertragUnterschriebenAm
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
// Passt Foto/Scan proportional in den freien Bereich unterhalb der Kopfzeilen (obenY)
// und zentriert es dort. Gleiche Geometrie für Bilder (drawImage) und eingebettete
// PDF-Seiten (drawPage) — beide haben .width/.height.
function _pdfFitBox(obj, obenY) {
  const [pw] = PDF_PAGE_A4;
  const maxW = pw - 100, maxH = obenY - 50;
  const scale = Math.min(maxW / obj.width, maxH / obj.height, 1);
  const w = obj.width * scale, h = obj.height * scale;
  return { x: (pw - w) / 2, y: 50 + (maxH - h) / 2, width: w, height: h };
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
    // Liefert die Seite samt Oberkante des freien Bereichs darunter zurück, damit
    // Foto/Scan auf DIESELBE Seite passen (vorher: Name und Bild auf zwei Seiten).
    const drawLabelPage = (lines) => {
      const page = out.addPage(PDF_PAGE_A4);
      let y = 780;
      lines.forEach((line, i) => {
        page.drawText(line, { x: 50, y, size: i === 0 ? 18 : 12, font, color: rgb(0.1, 0.1, 0.1) });
        y -= i === 0 ? 30 : 20;
      });
      return { page, freiAb: y - 10 };
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
      const { page, freiAb } = drawLabelPage([wer, `Hochgeladen: ${_fmtIso(t.fuehrerscheinHochgeladenAm)}`, `Gültig bis: ${faelligAm.toLocaleDateString("de-DE")} (${gueltig ? "gültig" : "abgelaufen"})`]);
      const ct = (t.fuehrerscheinContentType || "").toLowerCase();
      try {
        if (ct === "application/pdf") {
          // Erste Seite unter die Kopfzeilen einbetten; mehrseitige Scans hängen ihre
          // Folgeseiten wie bisher als volle Seiten an.
          const src = await PDFDocument.load(bytes);
          const [erste, ...weitere] = src.getPageIndices();
          const eingebettet = await out.embedPage(src.getPage(erste));
          page.drawPage(eingebettet, _pdfFitBox(eingebettet, freiAb));
          if (weitere.length) {
            (await out.copyPages(src, weitere)).forEach((p) => out.addPage(p));
          }
        } else if (ct === "image/png") {
          const img = await out.embedPng(bytes);
          page.drawImage(img, _pdfFitBox(img, freiAb));
        } else if (ct === "image/jpeg" || ct === "image/jpg") {
          const img = await out.embedJpg(bytes);
          page.drawImage(img, _pdfFitBox(img, freiAb));
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

// ─── Haupt-Navigation ─────────────────────────────────────────────────────────
// Ersetzt den früheren Admin/Trainer-Moduswechsel per Header-Button: EINE
// Tab-Leiste für alle. "Meine Daten" + "Info" sieht jeder (Info ist reine
// Anzeige aus config.js, braucht weder Verbindung noch Recht — damit ist die
// Versionshistorie wie in den übrigen Apps für alle erreichbar); die drei
// Verwaltungs-Tabs blendet _initAdminZugang() nur für Berechtigte ein.

function _initMainNav() {
  document.querySelectorAll("#main-nav button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => _zeigeTab(btn.dataset.tab));
  });
}

// Zentraler Tab-Umschalter. Die Verwaltungs-Tabs verbinden bei Bedarf
// automatisch (Auto-Connect — die Buttons sieht nur, wer das Recht hat, ein
// Zwischenscreen mit "Verbinden"-Klick wäre ein toter Umweg); der
// Connect-Screen bleibt nur als Fehler-Fallback mit Banner.
async function _zeigeTab(tab) {
  aktiverTab = tab;
  document.querySelectorAll("#main-nav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

  const trainerFlow = document.getElementById("trainer-flow");
  const adminFlow   = document.getElementById("admin-flow");
  const connect     = document.getElementById("admin-connect-screen");
  const panel       = document.getElementById("admin-panel");

  if (tab === "meine") {
    adminFlow.style.display = "none";
    trainerFlow.style.display = "";
    document.getElementById("file-status").style.display = "none";
    return;
  }

  trainerFlow.style.display = "none";
  adminFlow.style.display = "";

  if (tab === "info") {
    connect.style.display = "none";
    panel.style.display = "";
    document.getElementById("file-status").style.display = "none";
    _aktiviereSection("info");
    return;
  }

  // Verwaltungs-Tab (liste/import/einstellungen): Verbindung sicherstellen.
  if (!davConfig) {
    const errEl = document.getElementById("admin-connect-error");
    errEl.style.display = "none";
    connect.style.display = "none";
    panel.style.display = "none";
    try {
      await _connectAdminNow(); // zeigt via _onAdminConnected das Panel
    } catch (err) {
      if (aktiverTab !== tab) return; // Nutzer hat inzwischen weitergeklickt
      errEl.textContent = "Verbindungsfehler: " + err.message;
      errEl.style.display = "block";
      davConfig = null;
      panel.style.display = "none";
      connect.style.display = "";
      return;
    }
    if (aktiverTab !== tab) return; // Nutzer hat inzwischen weitergeklickt
  } else {
    connect.style.display = "none";
    panel.style.display = "";
  }
  document.getElementById("file-status").style.display = "";
  _aktiviereSection(tab);
  if (tab === "import") _renderImportCurrentStatus();
}

function _aktiviereSection(tab) {
  document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
}

// ─── Admin-Connect ────────────────────────────────────────────────────────────

// Gemeinsamer Verbindungs-Kern für den Auto-Connect (_zeigeTab) und
// den Fallback-Submit unten. Kein App-Passwort mehr: der Zugangs-Worker prüft
// den ToolsUebersicht-Token + Administrieren-Stufe serverseitig bei JEDEM
// Zugriff; die Vorabprüfung hier liefert nur sprechende Meldungen statt nacktem
// 401/403 und entfällt, wenn _initAdminZugang das Recht schon bestätigt hat.
async function _connectAdminNow() {
  davConfig = {
    url:      document.getElementById("admin-url").value.trim(),
    proxyUrl: document.getElementById("admin-proxy-url").value.trim() || null
  };
  if (!_adminZugriffErlaubt) {
    if (!getSessionToken()) {
      throw new NotLoggedInError("Bitte zuerst in der Tools-Übersicht anmelden (im selben Browser) und diese Seite neu laden.");
    }
    if (!(await checkTrainerdatenAdminPermission())) {
      throw new Error("Dein Konto hat kein Administrieren-Recht für Trainerdaten. Ein Admin kann es im Sichtbarkeits-Panel der Tools-Übersicht vergeben (Häkchen „Administrieren“ bei der passenden Gruppe).");
    }
  }
  const raw = await davReadFile(davConfig);
  appData = raw && Array.isArray(raw.trainer) ? raw : { version: 1, trainer: [] };
  await FileStore.setWebdavConfig(davConfig); // nur url+proxyUrl — keine Zugangsdaten
  _onAdminConnected();
}

function _initAdminConnect() {
  document.getElementById("admin-connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("admin-connect-error");
    errEl.style.display = "none";
    const btn = document.getElementById("btn-admin-connect");
    btn.disabled = true;
    btn.textContent = "Verbinde …";
    try {
      await _connectAdminNow();
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
  // Alt gespeicherte Configs enthalten noch username/password aus der
  // App-Passwort-Zeit — bewusst nur url/proxyUrl übernehmen (Rest verfällt).
  davConfig = { url: saved.url, proxyUrl: saved.proxyUrl || null };
  try {
    const raw = await davReadFile(davConfig);
    appData = raw && Array.isArray(raw.trainer) ? raw : { version: 1, trainer: [] };
    // Nur vorbereiten (Panel/Liste im Hintergrund, Status "Verbunden") — die
    // App startet für alle auf "Meine Daten", sichtbar wird die Verwaltung
    // erst über die Tabs.
    _onAdminConnected();
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
  // Header-Versionsbadge springt zur Versionshistorie (Info-Tab) — die ist
  // seit der gemeinsamen Tab-Leiste wieder für ALLE erreichbar, wie in den
  // übrigen Apps der Flotte.
  document.getElementById("btn-disconnect").addEventListener("click", async () => {
    await FileStore.clearWebdavConfig();
    davConfig = null;
    appData = { version: 1, trainer: [] };
    document.getElementById("admin-panel").style.display = "none";
    document.getElementById("admin-connect-screen").style.display = "";
    _updateFileStatus(false);
    // Ohne Verbindung ist in den Verwaltungs-Tabs nichts mehr zu sehen —
    // zurück zu "Meine Daten" (der nächste Verwaltungs-Klick verbindet neu).
    _zeigeTab("meine");
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
  // Führungszeugnis-Auswahl liegt im Export-Panel und verengt nur die
  // Exportmenge — wie die Gruppen-Auswahl darunter genügt die Info-Zeile.
  document.querySelectorAll(".export-fz-cb").forEach(cb => cb.addEventListener("change", () => {
    _updateExportInfoLine();
    _updateBankExportInfo();
  }));
  // Delegation statt Einzel-Listener: die Gruppen-Checkboxen im Export-Panel
  // werden bei jedem Listen-Render neu gebaut (siehe _renderExportGruppenSection).
  // Sie wirken nur auf die Exportmenge, nicht auf die Bildschirmliste — deshalb
  // genügt es, die Info-Zeile zu aktualisieren.
  document.getElementById("export-gruppen-section").addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("export-gruppen-cb")) {
      _updateExportInfoLine();
      _updateBankExportInfo(); // Gruppen-Auswahl verengt auch die Bank-Exportmenge
    }
  });
  _initExportPanel();
  _initBankExportPanel();

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
  document.getElementById("btn-d-tl-loeschen").addEventListener("click", () => _deleteDocumentAdmin("trainerlizenzen", "trainerlizenzHochgeladenAm", "trainerlizenzDateiName", "trainerlizenzContentType", "Trainerlizenz"));

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
  document.getElementById("btn-d-fs-loeschen").addEventListener("click", () => _deleteDocumentAdmin("fuehrerscheine", "fuehrerscheinHochgeladenAm", "fuehrerscheinDateiName", "fuehrerscheinContentType", "Führerschein"));

  document.getElementById("btn-d-fz-upload").addEventListener("click", () => document.getElementById("d-fz-file-input").click());
  document.getElementById("d-fz-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrungszeugnisse", f, "fuehrungszeugnisEingereichtAm", "fuehrungszeugnisDateiName", "fuehrungszeugnisContentType");
  });
  document.getElementById("btn-d-kodex-reset").addEventListener("click", _resetKodexAdmin);
  document.getElementById("btn-d-jugendschutz-reset").addEventListener("click", _resetJugendschutzAdmin);
  document.getElementById("btn-d-vertrag-reset").addEventListener("click", _resetVertragUnterschriftAdmin);
  document.getElementById("btn-d-vertrag-neuausstellung").addEventListener("click", _resetVertragAdmin);

  document.getElementById("btn-d-fz-camera").addEventListener("click", () => document.getElementById("d-fz-camera-input").click());
  document.getElementById("d-fz-camera-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) _uploadDocumentAdmin("fuehrungszeugnisse", f, "fuehrungszeugnisEingereichtAm", "fuehrungszeugnisDateiName", "fuehrungszeugnisContentType");
  });
  document.getElementById("btn-d-fz-ansehen").addEventListener("click", () => _ansehenDocumentAdmin("fuehrungszeugnisse"));
  document.getElementById("btn-d-fz-loeschen").addEventListener("click", () => _deleteDocumentAdmin("fuehrungszeugnisse", "fuehrungszeugnisEingereichtAm", "fuehrungszeugnisDateiName", "fuehrungszeugnisContentType", "Führungszeugnis"));

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
  // Für dieses Konto ist kein Trainervertrag vorgesehen (Geschäftsführung o.ä., siehe
  // vertragspflichtig in submit-worker.js): Der Eintrag ist mit den Kontaktdaten
  // fertig und wartet auf nichts. "Ausstehend" wäre nicht bloß falsch beschriftet —
  // generate-pdfs.ps1 -Zuweisen filtert genau auf diesen Status und würde einen
  // Trainervertrag ohne IBAN und ohne Pauschale erzeugen.
  // Bewusst `=== false` und nicht `!t.vertragspflichtig`: alle Datensätze von vor
  // diesem Feld haben undefined und müssen weiterhin Verträge bekommen.
  // Soll jemand doch einen Vertrag bekommen, gibt es zwei Wege: das Häkchen "Vertrag
  // benötigt" im Gateway setzen (dann greift ab der nächsten Einreichung wieder alles
  // automatisch) oder hier im Detail den Status manuell auf "Ausstehend" stellen.
  if (t.vertragspflichtig === false) return "kontaktdaten";
  if (t.vertragsGeneriert) return "generiert";
  return t.username ? "ausstehend" : "unvollstaendig";
}

// "Eingereicht (unterschrieben) am": unterschriftAm wird erst seit 1.5 vom
// submit-worker gesetzt. Ältere echte Einreichungen haben nur erstelltAm — bei
// vorhandener Unterschrift ist das ihr Einreichzeitpunkt (Fallback), Import-Stubs
// (keine Unterschrift) bekommen weiterhin bewusst kein Datum.
function _eingereichtAm(t) {
  // signaturVorhanden = Flag seit dem Auslagern der Unterschriften; signatureDataUrl
  // bleibt als Fallback für noch nicht migrierte Alt-Einträge (Parität mit ToolsUebersicht
  // admin-worker.js::trainervertragEingereichtAm, siehe [[feedback-status-fallback-parity]]).
  return t.unterschriftAm || ((t.signaturVorhanden || t.signatureDataUrl) ? t.erstelltAm : null);
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

// Gateway-Gruppen für die Gruppen-Auswahl im Export-Panel und die Export-
// Spalte "Gruppen" — lazy beim ersten Listen-Render, ein Versuch pro Sitzung.
// Primär über die schmale Aktion "trainerdaten-list-groups" (Admin ODER
// Trainerdaten-Bearbeiter laut Sichtbarkeits-Panel, Mitglieder auf Personal
// gefiltert); Fallback auf das admin-only "list-groups" für die Übergangszeit,
// solange der landingpage-Worker die neue Aktion noch nicht kennt. Braucht ein
// entsprechend berechtigtes ToolsUebersicht-Login im selben Browser; ohne
// zeigt die Sektion einen Hinweis statt still zu fehlen. Die zentralen Profile
// werden mitgeladen, damit auch Import-Stubs ohne Konto-Verknüpfung per
// Namensabgleich ihrer Gruppe zugeordnet werden können (siehe _trainerGatewayUsername).
async function _ensureFilterGruppen() {
  if (_filterGruppenVersucht) return;
  _filterGruppenVersucht = true;
  try {
    const [data] = await Promise.all([
      (async () => {
        try {
          return await gatewayRequest({ action: "trainerdaten-list-groups" });
        } catch (_) {
          return await gatewayRequest({ action: "list-groups" });
        }
      })(),
      (async () => {
        if (trainerProfiles === null) trainerProfiles = await fetchTrainerProfiles().catch(() => []);
      })()
    ]);
    filterGruppen = (data.groups || []).map(g => ({
      id: String(g.id),
      name: g.name || "",
      members: new Set(g.memberUsernames || [])
    }));
    // Die Bildschirmliste ist von den Gruppen unberührt (sie beschränken nur
    // den Export) — es reichen Sektion und Info-Zeile.
    _renderExportGruppenSection();
    _updateExportInfoLine();
  } catch (_) {
    document.getElementById("export-gruppen-section").innerHTML =
      `<div class="section-divider" style="margin:14px 0 8px;">Gruppen</div>
       <p class="muted" style="margin:0;">Gruppen-Auswahl nicht verfügbar — dafür im selben Browser in der Tools-Übersicht mit einem berechtigten Konto anmelden (Admin oder Administrieren-Stufe für Trainerdaten).</p>`;
  }
}

// Gateway-Konto zu einem Trainer-Datensatz: username (Self-Submit), sonst
// linkedUsername (Provisioning-Platzhalter), sonst Namensabgleich übers
// zentrale Profil (alte Import-Stubs ohne Verknüpfung) — gleiche Kette wie
// _neuerStubErlaubt(). null = kein (eindeutiges) Konto, zählt als "Ohne Gruppe".
function _trainerGatewayUsername(t) {
  if (t.username) return t.username;
  if (t.linkedUsername) return t.linkedUsername;
  const profil = _matchTrainerProfile(((t.vorname || "") + " " + (t.nachname || "")).trim());
  return profil ? profil.username : null;
}

// Baut die Sektion "Gruppen" im CSV-Export-Panel: eine Checkbox je Gruppe, in
// der mindestens eine Person der Liste Mitglied ist (leere Gruppen wären totes
// Rauschen, analog Lizenz-Filter), plus "Ohne Gruppe" für Einträge ohne
// Gruppenzuordnung. Angekreuzte Gruppen beschränken NUR die Exportmenge
// (ODER-verknüpft, siehe _exportTrainerList) — keine angekreuzt = alle
// exportieren (Filter-Konvention wie die Dropdowns der Filterleiste, so bleibt
// der Normalfall "alle" klicklos und der Mehrfach-Export ist reines Ankreuzen).
// Erhält die aktuelle Auswahl über den Neubau hinweg. Vor dem Laden der
// Gruppen: no-op (bzw. der Fehlerhinweis aus _ensureFilterGruppen bleibt stehen).
function _renderExportGruppenSection() {
  if (!filterGruppen) return;
  const wrap = document.getElementById("export-gruppen-section");
  const vorher = new Set(Array.from(wrap.querySelectorAll(".export-gruppen-cb:checked")).map(cb => cb.dataset.value));

  const vertreten = filterGruppen
    .filter(g => appData.trainer.some(t => {
      const u = _trainerGatewayUsername(t);
      return u && g.members.has(u);
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const cb = (value, label) => `
    <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; margin-bottom:0;">
      <input type="checkbox" class="export-gruppen-cb" data-value="${_esc(value)}"${vorher.has(value) ? " checked" : ""} /> ${_esc(label)}
    </label>`;

  wrap.innerHTML = `
    <div class="section-divider" style="margin:14px 0 8px;">Gruppen – nur ausgewählte exportieren</div>
    <p class="muted" style="margin:0 0 8px; font-size:12px;">Keine Gruppe angekreuzt = alle exportieren. Mehrere ankreuzbar; exportiert wird, wer in mindestens einer der angekreuzten Gruppen ist.</p>
    <div class="form-grid" style="margin-bottom:0;">
      ${vertreten.map(g => cb(g.id, g.name)).join("")}
      ${cb("__ohne__", "Ohne Gruppe")}
    </div>`;
}

// Namen aller Gruppen, in denen die Person Mitglied ist (kommasepariert,
// alphabetisch) — Wert der CSV-Export-Spalte "Gruppen". Leer, solange die
// Gruppen nicht geladen sind (kein Gateway-Admin-Login) oder die Person
// kein (eindeutiges) Konto hat.
function _trainerGruppenNamen(t) {
  if (!filterGruppen) return "";
  const u = _trainerGatewayUsername(t);
  if (!u) return "";
  return filterGruppen
    .filter(g => g.members.has(u))
    .map(g => g.name)
    .sort((a, b) => a.localeCompare(b, "de"))
    .join(", ");
}

// Zentrales Profil (ToolsUebersicht) zu einem Trainer-Datensatz: erst über das
// verknüpfte Konto, sonst über den Namensabgleich — gleiche Kette wie
// _trainerGatewayUsername(), nur mit dem Profil-Objekt statt des Kontonamens.
function _trainerProfil(t) {
  const u = t.username || t.linkedUsername;
  if (u) return (trainerProfiles || []).find(p => p.username === u) || null;
  return _matchTrainerProfile(((t.vorname || "") + " " + (t.nachname || "")).trim());
}

// Betreute Mannschaften laut zentralem Profil (kommasepariert, alphabetisch) —
// Wert der CSV-Export-Spalte "Mannschaft(en)". Gepflegt wird das ausschließlich
// in der ToolsUebersicht-Nutzerverwaltung, nicht hier; leer, solange die Profile
// nicht geladen sind (kein Gateway-Login), die Person kein eindeutiges Konto hat
// oder dort keine Mannschaft hinterlegt ist. Anders als die Gruppen-Spalte hängt
// das NICHT an einem Admin-/Bearbeiter-Recht — list-trainer-profiles steht jedem
// eingeloggten Konto offen.
function _trainerMannschaften(t) {
  const profil = _trainerProfil(t);
  if (!profil || !Array.isArray(profil.mannschaften)) return "";
  return profil.mannschaften
    .map(m => String(m).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "de"))
    .join(", ");
}

// Liest die aktuellen Filter/Suchfeld-Werte aus dem DOM und wendet sie auf
// appData.trainer an — Quelle für "was ist gerade sichtbar" (Bildschirmliste).
// Der CSV-Export nutzt _exportTrainerList(), das diese Menge zusätzlich um die
// Gruppen-Auswahl aus dem Export-Panel verengt.
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

// Führungszeugnis-Auswahl aus dem Export-Panel. Vorhandensein hängt allein an
// fuehrungszeugnisEingereichtAm — dasselbe Feld, das _renderDocumentsSection und
// die Worker-Aktionen prüfen. Keins oder beide angekreuzt = keine Einschränkung
// (gleiche Konvention wie die Gruppen-Auswahl darunter).
function _fzExportGefiltert(liste) {
  const ja   = document.getElementById("export-fz-ja").checked;
  const nein = document.getElementById("export-fz-nein").checked;
  if (ja === nein) return liste;
  return liste.filter(t => !!t.fuehrungszeugnisEingereichtAm === ja);
}

// Exportmenge = sichtbare Liste, zusätzlich verengt auf die im Export-Panel
// angekreuzten Gruppen (ODER-verknüpft; "__ohne__" = ohne Gruppenzuordnung)
// und auf den Führungszeugnis-Stand. Nichts angekreuzt = keine Einschränkung.
// Genutzt vom CSV-Export, vom Bank-Export und von der Info-Zeile, damit der
// Zähler immer die echte Exportmenge zeigt.
function _exportTrainerList() {
  const basis = _fzExportGefiltert(_filteredTrainerList());
  const auswahl = new Set(
    Array.from(document.querySelectorAll("#export-gruppen-section .export-gruppen-cb:checked")).map(cb => cb.dataset.value)
  );
  if (!auswahl.size) return basis;

  return basis.filter(t => {
    const u = _trainerGatewayUsername(t);
    const inGewaehlterGruppe = !!u && (filterGruppen || []).some(g => auswahl.has(g.id) && g.members.has(u));
    const ohneGruppe = !u || !(filterGruppen || []).some(g => g.members.has(u));
    return inGewaehlterGruppe || (auswahl.has("__ohne__") && ohneGruppe);
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
    _updateBankExportInfo();
    return;
  }
  empty.style.display = "none";
  header.style.display = "";
  filterbar.style.display = "";
  _populateLizenzFilterOptions();
  _ensureFilterGruppen(); // async, erster Aufruf lädt die Gruppen und baut danach die Export-Sektion
  _renderExportGruppenSection();

  const filtered = _filteredTrainerList();
  _updateExportInfoLine();
  _updateBankExportInfo();

  if (!filtered.length) {
    rows.innerHTML = "";
    noMatch.style.display = "";
    return;
  }
  noMatch.style.display = "none";

  const statusLabel = { generiert: "✓ Vertrag erstellt", ausstehend: "Ausstehend", unvollstaendig: "Unvollständig", kontaktdaten: "Nur Kontaktdaten" };

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
// Exportiert die aktuell gefilterte/gesuchte Liste, zusätzlich verengt auf die
// im Panel angekreuzten Gruppen (_exportTrainerList()) — anders als
// "Alle als PDF-ZIP", das bewusst immer den kompletten Bestand nimmt.
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
  const basisCount  = appData.trainer.length ? _filteredTrainerList().length : 0;
  const exportCount = appData.trainer.length ? _exportTrainerList().length : 0;
  // Weicht die Exportmenge durch Führungszeugnis- oder Gruppen-Auswahl von der
  // sichtbaren Liste ab, wird das explizit ausgewiesen statt still weggefiltert.
  el.textContent = exportCount === basisCount
    ? `${checked} von ${total} Feldern ausgewählt · exportiert ${exportCount} Trainer (aktuelle Filterung/Suche).`
    : `${checked} von ${total} Feldern ausgewählt · exportiert ${exportCount} von ${basisCount} Trainern (aktuelle Filterung/Suche + Auswahl unten).`;
}

function _handleExportCsv() {
  const selectedKeys = Array.from(document.querySelectorAll(".export-field-cb:checked")).map(cb => cb.dataset.field);
  if (!selectedKeys.length) { alert("Bitte mindestens ein Feld für den Export auswählen."); return; }

  const rows = _exportTrainerList().slice().sort((a, b) =>
    ((a.nachname || "") + (a.vorname || "")).localeCompare((b.nachname || "") + (b.vorname || ""), "de")
  );
  if (!rows.length) { alert("Die aktuelle Filterung/Suche/Gruppen-Auswahl ergibt keine Treffer zum Exportieren."); return; }

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

// ─── Bank-Export (Überweisungsliste, seit 1.8) ────────────────────────────────
// Zweiter Exportweg neben dem konfigurierbaren CSV-Export, Ziel ist das Banktool:
// je Trainer eine Zahlung über die hinterlegte Pauschale. Vier Formate, gleiche
// Datenbasis (_bankExportKandidaten):
//   CSV   — exakt die Spalten der Vorlagendatei der Bank (BANK_EXPORT_CSV_SPALTEN
//           in config.js), zum Einlesen als Überweisungsvorlagen. Braucht keine
//           Auftraggeber-Angaben, die wählt der Banker beim Import selbst.
//   XLSX  — dieselbe Tabelle als Excel-Mappe, im Aufbau der Muster-Datei des
//           Bankers (Blatt "in", Betrag als Zahl). Siehe _buildVorlagenXlsx.
//   XML   — dieselben Spalten in XML-Form, Eigenkonstruktion ohne Standard.
//   SEPA  — Sammelüberweisung pain.001.001.03, also ein fertiger Auftrag.
//           Braucht deshalb zwingend Auftraggeber-Name, -IBAN und Ausführungsdatum.
// Rein clientseitig wie der CSV-Export, kein Worker-Redeploy.

// Auftraggeber/Verwendungszweck stehen bewusst NICHT in der trainerdaten.json:
// das ist Konfiguration des Exports, kein Trainer-Datum, und die Vereins-IBAN
// hat in einem öffentlichen Repo nichts verloren. localStorage reicht — die
// Angaben müssen einmal pro Gerät eingetragen werden und bleiben dann stehen.
const BANK_EXPORT_LS_KEY = "trainerdaten_bank_export";
const BANK_EXPORT_FELDER = [
  "bank-verwendungszweck", "bank-vorlage-praefix",
  "bank-auftraggeber-name", "bank-auftraggeber-iban", "bank-auftraggeber-bic",
  "bank-ausfuehrungsdatum"
];

function _initBankExportPanel() {
  _ladeBankExportEinstellungen();

  document.getElementById("btn-bank-export-toggle").addEventListener("click", () => {
    const panel = document.getElementById("bank-export-panel");
    const willOpen = panel.style.display === "none";
    panel.style.display = willOpen ? "" : "none";
    if (willOpen) _updateBankExportInfo();
  });

  BANK_EXPORT_FELDER.forEach(id => {
    document.getElementById(id).addEventListener("input", _speichereBankExportEinstellungen);
  });

  document.getElementById("btn-bank-export-csv").addEventListener("click", () => _handleBankExport("csv"));
  document.getElementById("btn-bank-export-xlsx").addEventListener("click", () => _handleBankExport("xlsx"));
  document.getElementById("btn-bank-export-vorlage-xml").addEventListener("click", () => _handleBankExport("vorlage-xml"));
  document.getElementById("btn-bank-export-xml").addEventListener("click", () => _handleBankExport("xml"));
  _initBankCsvKonverter();
  _initBankCamtAbgleich();
}

function _ladeBankExportEinstellungen() {
  let gespeichert = {};
  try { gespeichert = JSON.parse(localStorage.getItem(BANK_EXPORT_LS_KEY) || "{}") || {}; } catch (_) {}
  BANK_EXPORT_FELDER.forEach(id => {
    if (typeof gespeichert[id] === "string") document.getElementById(id).value = gespeichert[id];
  });
  // Ausführungsdatum bewusst nicht aus dem Speicher vorbelegen, wenn es in der
  // Vergangenheit liegt — ein altes Datum würde die Bank abweisen.
  const datumEl = document.getElementById("bank-ausfuehrungsdatum");
  const heute = _heuteIsoDatum();
  if (!datumEl.value || datumEl.value < heute) datumEl.value = heute;
}

function _speichereBankExportEinstellungen() {
  const werte = {};
  BANK_EXPORT_FELDER.forEach(id => { werte[id] = document.getElementById(id).value; });
  try { localStorage.setItem(BANK_EXPORT_LS_KEY, JSON.stringify(werte)); } catch (_) {}
  _updateBankExportInfo();
}

function _heuteIsoDatum() {
  const d = new Date();
  // Lokales Datum, nicht toISOString() — das rechnet nach UTC um und liefert in
  // deutscher Sommerzeit vor 02:00 Uhr den Vortag.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Teilt die aktuelle Exportmenge in überweisbare Trainer und solche, bei denen
// eine Zahlung nicht möglich ist. Die zweite Gruppe wird NICHT still verworfen,
// sondern im Panel namentlich ausgewiesen — sonst fehlt jemand in der Zahlung,
// ohne dass es irgendwo auffällt.
function _bankExportKandidaten() {
  const zahlbar = [];
  const uebersprungen = [];

  _exportTrainerList().slice().sort((a, b) =>
    ((a.nachname || "") + (a.vorname || "")).localeCompare((b.nachname || "") + (b.vorname || ""), "de")
  ).forEach(t => {
    const iban   = (t.iban || "").replace(/\s+/g, "").toUpperCase();
    const betrag = _parseBetrag(t.pauschale);
    const gruende = [];
    if (!iban) gruende.push("keine IBAN");
    if (betrag == null || betrag <= 0) gruende.push("keine Pauschale");

    if (gruende.length) uebersprungen.push({ trainer: t, grund: gruende.join(" und ") });
    else zahlbar.push({ trainer: t, iban, betrag });
  });

  return { zahlbar, uebersprungen };
}

// Die Pauschale ist ein freies Textfeld (manuell getippt oder aus Personalkosten
// via _fmtPauschale, also deutsches Format). Akzeptiert "125", "125,50",
// "1.250,50" und "125.50" — bei einem Komma gelten Punkte als Tausendertrenner,
// ohne Komma wird ein einzelner Punkt mit 1-2 Nachkommastellen als Dezimalpunkt
// gelesen. Gibt null zurück, wenn nichts Verwertbares drinsteht.
function _parseBetrag(roh) {
  let s = String(roh == null ? "" : roh).replace(/[€\s]/g, "").trim();
  if (!s) return null;

  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Betrag für die Datei: XML verlangt einen Punkt als Dezimaltrennzeichen, die
// deutsche CSV ein Komma. Immer zwei Nachkommastellen.
function _fmtBetrag(n, trenner) {
  return n.toFixed(2).replace(".", trenner);
}

// Bringt Text in den SEPA-Zeichensatz: erst die lesbare Transliteration aus
// SEPA_UMLAUT_MAP (ü -> ue), danach alles Verbliebene außerhalb des erlaubten
// Vorrats auf ein Leerzeichen. Zum Schluss auf die erlaubte Länge kürzen.
function _sepaText(roh, maxLaenge) {
  const s = String(roh == null ? "" : roh)
    .split("")
    .map(z => (Object.prototype.hasOwnProperty.call(SEPA_UMLAUT_MAP, z) ? SEPA_UMLAUT_MAP[z] : z))
    .join("")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return maxLaenge ? s.slice(0, maxLaenge) : s;
}

function _xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function _updateBankExportInfo() {
  const el = document.getElementById("bank-export-info");
  if (!el) return;

  if (!appData.trainer.length) { el.innerHTML = ""; return; }

  const { zahlbar, uebersprungen } = _bankExportKandidaten();
  const summe = zahlbar.reduce((s, k) => s + k.betrag, 0);

  const uebersprungenBlock = uebersprungen.length ? `
    <div class="error-banner visible" style="margin:10px 0 0;">
      <strong>${uebersprungen.length} Trainer ${uebersprungen.length === 1 ? "kann" : "können"} nicht überwiesen werden</strong>
      und ${uebersprungen.length === 1 ? "fehlt" : "fehlen"} in der Datei:
      <ul style="margin:6px 0 0; padding-left:20px;">
        ${uebersprungen.map(u => `<li>${_esc(u.trainer.nachname)}, ${_esc(u.trainer.vorname)} — ${_esc(u.grund)}</li>`).join("")}
      </ul>
    </div>` : "";

  el.innerHTML = `
    <p class="muted" style="margin:0;">
      <strong>${zahlbar.length}</strong> ${zahlbar.length === 1 ? "Zahlung" : "Zahlungen"} über zusammen
      <strong>${_fmtBetrag(summe, ",")} €</strong> (aktuelle Filterung/Suche + Gruppen-Auswahl).
    </p>
    ${uebersprungenBlock}`;
}

function _setBankExportError(text) {
  const el = document.getElementById("bank-export-error");
  el.textContent = text || "";
  el.classList.toggle("visible", !!text);
}

function _handleBankExport(format) {
  _setBankExportError("");

  const { zahlbar } = _bankExportKandidaten();
  if (!zahlbar.length) {
    _setBankExportError("Kein Trainer der aktuellen Auswahl hat sowohl eine IBAN als auch eine Pauschale — es gibt nichts zu überweisen.");
    return;
  }

  const verwendungszweck = document.getElementById("bank-verwendungszweck").value.trim();
  const datumStempel = _heuteIsoDatum();

  // Die drei Wege aus der Bank-Vorlage (CSV, Excel, XML) teilen sich Datenbasis
  // und Zeilenaufbau — sie unterscheiden sich nur in der Verpackung.
  if (format === "csv" || format === "xlsx" || format === "vorlage-xml") {
    const o = _bankVorlagenOptionen(zahlbar, verwendungszweck);

    if (format === "csv") {
      const zeilen = [BANK_EXPORT_CSV_SPALTEN, ...zahlbar.map(k => _bankVorlagenWerte(k, o, n => _fmtBetrag(n, ",")))];
      // Semikolon + UTF-8-BOM wie beim bestehenden CSV-Export.
      const csv = String.fromCharCode(0xFEFF) + zeilen.map(z => z.map(_csvCell).join(";")).join("\r\n");
      _downloadBankDatei(csv, "text/csv;charset=utf-8;", `Ueberweisungen_${datumStempel}.csv`);
      return;
    }

    // Als einziger der drei Wege asynchron (ZIP-Erzeugung) — Fehler landen
    // deshalb erst im Panel, wenn die Datei wirklich fertig gepackt ist.
    if (format === "xlsx") {
      _handleBankExportXlsx(o, datumStempel);
      return;
    }

    _downloadBankDatei(
      _buildVorlagenXml(o),
      "application/xml;charset=utf-8;",
      `Ueberweisungen_${datumStempel}.xml`
    );
    return;
  }

  // ── SEPA-XML: hier sind die Auftraggeber-Angaben Pflicht ────────────────────
  const auftraggeberName = document.getElementById("bank-auftraggeber-name").value.trim();
  const auftraggeberIban = document.getElementById("bank-auftraggeber-iban").value.replace(/\s+/g, "").toUpperCase();
  const auftraggeberBic  = document.getElementById("bank-auftraggeber-bic").value.trim().toUpperCase();
  const ausfuehrungsdatum = document.getElementById("bank-ausfuehrungsdatum").value;

  const fehlt = [];
  if (!auftraggeberName) fehlt.push("Auftraggeber (Kontoinhaber)");
  if (!auftraggeberIban) fehlt.push("IBAN des Auftraggebers");
  if (!ausfuehrungsdatum) fehlt.push("Ausführungsdatum");
  if (fehlt.length) {
    _setBankExportError(`Für die SEPA-XML-Datei fehlt noch: ${fehlt.join(", ")}. (Für den CSV-Export der Bank-Vorlage sind diese Angaben nicht nötig.)`);
    return;
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(auftraggeberIban)) {
    _setBankExportError("Die IBAN des Auftraggebers scheint ungültig zu sein. Bitte prüfen.");
    return;
  }
  if (ausfuehrungsdatum < _heuteIsoDatum()) {
    _setBankExportError("Das Ausführungsdatum liegt in der Vergangenheit — die Bank würde den Auftrag abweisen.");
    return;
  }

  _downloadBankDatei(
    _buildSepaXml({ zahlbar, auftraggeberName, auftraggeberIban, auftraggeberBic, ausfuehrungsdatum, verwendungszweck }),
    "application/xml;charset=utf-8;",
    `Sammelueberweisung_${datumStempel}.xml`
  );
}

// ─── Gemeinsame Zeile der Bank-Vorlage ────────────────────────────────────────
// CSV, Excel und Vorlagen-XML zeigen dieselbe Tabelle in drei Verpackungen. Der
// Zeilenaufbau steht deshalb nur an dieser einen Stelle — sonst driften die
// Formate auseinander, sobald eine Spalte anders befüllt wird.
//
// Der Betrag ist der einzige Wert, der je Format anders aussieht (Komma in CSV
// und XML, echte Zahl in der Excel-Mappe). Er kommt deshalb durch `betragWert`
// herein, statt hier fest formatiert zu werden.
function _bankVorlagenOptionen(zahlbar, verwendungszweck) {
  return {
    zahlbar,
    verwendungszweck,
    praefix: document.getElementById("bank-vorlage-praefix").value.trim(),
    auftraggeberIban: document.getElementById("bank-auftraggeber-iban").value.replace(/\s+/g, "").toUpperCase()
  };
}

function _bankVorlagenWerte(k, o, betragWert) {
  const t = k.trainer;
  const name = `${t.vorname || ""} ${t.nachname || ""}`.trim();
  // Reihenfolge exakt wie BANK_EXPORT_CSV_SPALTEN. Umlaute bleiben erhalten —
  // kein SEPA-Zeichensatz, keine dieser drei Dateien geht als Zahlungsauftrag
  // an die Bank (das tut allein die pain.001 aus _buildSepaXml).
  return [
    o.auftraggeberIban,                        // IBAN des Auftraggebers (laut Vorlage optional)
    [o.praefix, name].filter(Boolean).join(" "), // Vorlagenbezeichnung
    name,                                      // Empfänger
    k.iban,                                    // IBAN des Empfängers
    (t.bic || "").trim().toUpperCase(),        // BIC
    (t.bankname || "").trim(),                 // Kreditinstitut
    betragWert(k.betrag),                      // Betrag
    k.zweck || o.verwendungszweck || "",       // Verwendungszweck
    "", "", "", ""                             // Kundenreferenz / Verwendungsschlüssel / dessen Bezeichnung / Abweichender Auftraggeber
  ];
}

// ─── Vorlagen-XML (seit 1.10) ─────────────────────────────────────────────────
// Dieselben Werte wie der CSV-Export, nur in XML verpackt: je Zahlung ein
// <Ueberweisung> mit einem Element je Spalte der Bank-Vorlage.
//
// ACHTUNG — das ist KEIN Standard. pain.001 (siehe _buildSepaXml) ist das
// einzige XML-Format, das Banken übernehmen; diese Datei hier ist eine
// Eigenkonstruktion aus den Spalten der Vorlagendatei und wird von keinem
// Banktool automatisch verstanden. Sie existiert als Muster zum Abstimmen mit
// der Bank und zur Weiterverarbeitung in anderen Systemen. Wenn die Bank ein
// konkretes XML-Schema nennt, gehört dessen Struktur hierher — dann ist diese
// Funktion die Stelle zum Umbauen, nicht _buildSepaXml.
//
// Elementnamen werden aus BANK_EXPORT_CSV_SPALTEN abgeleitet, damit CSV und XML
// nie auseinanderlaufen: eine geänderte Spalte wirkt automatisch in beiden.
function _xmlTagName(spaltenname) {
  const ascii = String(spaltenname)
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");
  return ascii
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(wort => wort.charAt(0).toUpperCase() + wort.slice(1))
    .join("");
}

function _buildVorlagenXml(o) {
  const summe = o.zahlbar.reduce((s, k) => s + k.betrag, 0);
  const tags = BANK_EXPORT_CSV_SPALTEN.map(_xmlTagName);

  const eintraege = o.zahlbar.map(k => {
    // Gleiche Zeile wie CSV und Excel, Betrag hier mit Komma wie in der CSV.
    const werte = _bankVorlagenWerte(k, o, n => _fmtBetrag(n, ","));
    const zeilen = tags.map((tag, i) => `      <${tag}>${_xmlEsc(werte[i])}</${tag}>`);
    return `    <Ueberweisung>\n${zeilen.join("\n")}\n    </Ueberweisung>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Überweisungsliste aus Trainerdaten, Feldaufbau nach der CSV-Vorlage der Bank.
  Hinweis: Dies ist KEIN standardisiertes Zahlungsformat. Für eine Einreichung
  bei der Bank ist die SEPA-Datei nach pain.001.001.03 vorgesehen.
-->
<Ueberweisungen anzahl="${o.zahlbar.length}" summe="${_fmtBetrag(summe, ",")}" waehrung="EUR" erstellt="${_heuteIsoDatum()}">
${eintraege}
</Ueberweisungen>
`;
}

// ─── Excel-Mappe im Aufbau der Bank-Vorlage (seit 1.11) ───────────────────────
// Der Banker hat eine Muster-Arbeitsmappe geschickt (Überweisungsvorlagen_Muster):
// ein einziges Blatt namens "in", in Zeile 1 exakt die zwölf Spalten der
// CSV-Vorlage, ab Zeile 2 je Zahlung eine Zeile — der Betrag dort als echte Zahl
// im Format #,##0.00, nicht als Text. Genau diesen Aufbau erzeugt der Export.
//
// Geschrieben wird die Datei von Hand über JSZip (für die Word-Verträge ohnehin
// geladen), bewusst ohne zusätzliche Tabellen-Bibliothek: eine .xlsx ist ein ZIP
// aus wenigen XML-Teilen, und für ein Blatt ohne Formatierung ist das
// überschaubar. Aufbau und Reihenfolge folgen der Muster-Datei, damit ein
// strenger Import nichts Ungewohntes vorfindet — Texte deshalb über
// sharedStrings (so schreibt Excel selbst) und leere Zellen gar nicht erst.
//
// GOTCHA — der Blattname "in" stammt aus der Muster-Datei und ist sehr
// wahrscheinlich der Anker, an dem das Banktool sein Import-Blatt erkennt.
// Nicht umbenennen, ohne das mit dem Banker geklärt zu haben.
const BANK_XLSX_BLATTNAME = "in";
const BANK_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function _handleBankExportXlsx(o, datumStempel) {
  try {
    const blob = await _buildVorlagenXlsx(o);
    _downloadBankDatei(blob, BANK_XLSX_MIME, `Ueberweisungen_${datumStempel}.xlsx`);
  } catch (e) {
    _setBankExportError("Die Excel-Datei konnte nicht erzeugt werden: " + ((e && e.message) || e));
  }
}

// 0 -> A, 25 -> Z, 26 -> AA. Die Vorlage hat zwölf Spalten; die Schleife hält
// aber auch, falls BANK_EXPORT_CSV_SPALTEN irgendwann über Z hinauswächst.
function _xlsxSpaltenName(index) {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

// XML kennt keine Steuerzeichen — ein einziges davon macht die ganze Mappe
// unlesbar (Excel bietet dann nur noch "Reparieren" an). Tabulator und
// Zeilenumbruch sind erlaubt und bleiben deshalb stehen.
function _xlsxText(roh) {
  return String(roh == null ? "" : roh).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

async function _buildVorlagenXlsx(o) {
  if (typeof JSZip === "undefined") throw new Error("JSZip ist nicht geladen — bitte die Seite neu laden.");

  // Kopfzeile + je Zahlung eine Zeile. Der Betrag bleibt hier eine echte Zahl:
  // als Text ("125,00") würde das Banktool ihn beim Import nicht als Betrag
  // erkennen — genau deshalb steht er auch in der Muster-Datei als Zahl.
  const zeilen = [BANK_EXPORT_CSV_SPALTEN, ...o.zahlbar.map(k => _bankVorlagenWerte(k, o, n => n))];
  const letzteSpalte = _xlsxSpaltenName(BANK_EXPORT_CSV_SPALTEN.length - 1);

  // sharedStrings: jeder Text steht einmal in der Tabelle, die Zellen verweisen
  // nur per Index darauf. count = alle Text-Zellen, uniqueCount = die Tabelle.
  const texte = [];
  const textIndex = new Map();
  let textZellen = 0;
  const textId = (text) => {
    if (!textIndex.has(text)) { textIndex.set(text, texte.length); texte.push(text); }
    return textIndex.get(text);
  };

  const zeilenXml = zeilen.map((werte, r) => {
    const zellen = werte.map((wert, c) => {
      const ref = _xlsxSpaltenName(c) + (r + 1);
      if (typeof wert === "number") {
        if (!Number.isFinite(wert)) return "";
        // s="1" = der unten definierte Betragsstil #,##0.00. Der Wert selbst
        // steht immer mit Punkt in der Datei, unabhängig von der Anzeige.
        return `<c r="${ref}" s="1"><v>${wert.toFixed(2)}</v></c>`;
      }
      const text = _xlsxText(wert);
      if (!text) return "";  // leere Zellen lässt auch die Muster-Datei weg
      textZellen++;
      return `<c r="${ref}" t="s"><v>${textId(text)}</v></c>`;
    }).filter(Boolean).join("");
    return `<row r="${r + 1}" spans="1:${werte.length}">${zellen}</row>`;
  }).join("");

  const kopf = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const teile = {
    "[Content_Types].xml": kopf +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',

    "_rels/.rels": kopf +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',

    "xl/workbook.xml": kopf +
      `<workbook xmlns="${NS}" xmlns:r="${NS_REL}">` +
      `<sheets><sheet name="${_xmlEsc(BANK_XLSX_BLATTNAME)}" sheetId="1" r:id="rId1"/></sheets>` +
      '</workbook>',

    "xl/_rels/workbook.xml.rels": kopf +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId3" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',

    // Minimale Stiltabelle mit genau einem eigenen Format: dem Betrag.
    // Eigene numFmtId ab 164 — darunter liegen die von Excel fest vergebenen.
    // Die zwei fills (none + gray125) erwartet Excel unabhängig davon, ob sie
    // benutzt werden; mit nur einem meldet es eine beschädigte Datei.
    "xl/styles.xml": kopf +
      `<styleSheet xmlns="${NS}">` +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',

    "xl/sharedStrings.xml": kopf +
      `<sst xmlns="${NS}" count="${textZellen}" uniqueCount="${texte.length}">` +
      texte.map(t => `<si><t xml:space="preserve">${_xmlEsc(t)}</t></si>`).join("") +
      '</sst>',

    "xl/worksheets/sheet1.xml": kopf +
      `<worksheet xmlns="${NS}" xmlns:r="${NS_REL}">` +
      `<dimension ref="A1:${letzteSpalte}${zeilen.length}"/>` +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr baseColWidth="10" defaultRowHeight="15"/>' +
      `<sheetData>${zeilenXml}</sheetData>` +
      '<pageMargins left="0.7" right="0.7" top="0.787" bottom="0.787" header="0.3" footer="0.3"/>' +
      '</worksheet>'
  };

  const zip = new JSZip();
  Object.keys(teile).forEach(pfad => zip.file(pfad, teile[pfad]));
  return zip.generateAsync({ type: "blob", mimeType: BANK_XLSX_MIME, compression: "DEFLATE" });
}

// SEPA Credit Transfer Initiation, Schema pain.001.001.03 — das in Deutschland
// von den Banking-Programmen breitest unterstützte Format für Sammelüberweisungen.
// Alle Freitexte laufen durch _sepaText() (Zeichensatz) und danach durch _xmlEsc().
function _buildSepaXml(o) {
  const summe = o.zahlbar.reduce((s, k) => s + k.betrag, 0);
  const jetzt = new Date();
  // Zeitstempel ohne Millisekunden und ohne Zeitzonen-Umrechnung (lokale Zeit,
  // wie es die deutschen Banking-Programme erwarten).
  const p2 = n => String(n).padStart(2, "0");
  const creDtTm = `${jetzt.getFullYear()}-${p2(jetzt.getMonth() + 1)}-${p2(jetzt.getDate())}` +
                  `T${p2(jetzt.getHours())}:${p2(jetzt.getMinutes())}:${p2(jetzt.getSeconds())}`;
  // MsgId/PmtInfId: max. 35 Zeichen, muss je Einreichung eindeutig sein.
  const lfdId = `${SEPA_MSG_PRAEFIX}-${creDtTm.replace(/[-:T]/g, "")}`.slice(0, 35);

  // Ohne BIC verlangt das Schema den ausdrücklichen Vermerk "NOTPROVIDED" —
  // ein leeres BIC-Element wäre ungültig. Bei Inlands-SEPA ist das der Normalfall.
  const agent = (bic) => bic
    ? `<FinInstnId><BIC>${_xmlEsc(bic)}</BIC></FinInstnId>`
    : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;

  const transaktionen = o.zahlbar.map((k, i) => {
    const t = k.trainer;
    const name = _sepaText(`${t.vorname || ""} ${t.nachname || ""}`.trim(), SEPA_MAX_NAME);
    const bic  = (t.bic || "").trim().toUpperCase();
    // Zweck je Zahlung schlägt den gemeinsamen: aus der Trainerliste kommt nur
    // der gemeinsame, eine eingelesene CSV kann pro Zeile einen eigenen haben.
    const zweck = _sepaText(k.zweck || o.verwendungszweck, SEPA_MAX_VERWENDUNGSZWECK);
    return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${_xmlEsc(`${lfdId}-${i + 1}`.slice(0, 35))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${_fmtBetrag(k.betrag, ".")}</InstdAmt></Amt>
        <CdtrAgt>${agent(bic)}</CdtrAgt>
        <Cdtr><Nm>${_xmlEsc(name)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${_xmlEsc(k.iban)}</IBAN></Id></CdtrAcct>${zweck ? `
        <RmtInf><Ustrd>${_xmlEsc(zweck)}</Ustrd></RmtInf>` : ""}
      </CdtTrfTxInf>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${_xmlEsc(lfdId)}</MsgId>
      <CreDtTm>${creDtTm}</CreDtTm>
      <NbOfTxs>${o.zahlbar.length}</NbOfTxs>
      <CtrlSum>${_fmtBetrag(summe, ".")}</CtrlSum>
      <InitgPty><Nm>${_xmlEsc(_sepaText(o.auftraggeberName, SEPA_MAX_NAME))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${_xmlEsc(lfdId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${o.zahlbar.length}</NbOfTxs>
      <CtrlSum>${_fmtBetrag(summe, ".")}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${_xmlEsc(o.ausfuehrungsdatum)}</ReqdExctnDt>
      <Dbtr><Nm>${_xmlEsc(_sepaText(o.auftraggeberName, SEPA_MAX_NAME))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${_xmlEsc(o.auftraggeberIban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agent(o.auftraggeberBic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transaktionen}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

// ─── CSV-Datei → SEPA-XML (dritter Weg, seit 1.9) ─────────────────────────────
// Arbeitet NICHT auf der Trainerliste, sondern auf einer vom Nutzer gewählten
// CSV im Format der Bank-Vorlage: exportierte Liste von Hand angepasst (Beträge
// geändert, Zeilen gelöscht, jemand ergänzt) und daraus die Zahlungsdatei bauen.
// Auftraggeber/Ausführungsdatum kommen weiter aus den Panel-Feldern — die stehen
// in der Vorlage nicht bzw. nur als optionale Auftraggeber-IBAN drin.

// Zeichenweiser CSV-Parser (RFC-4180-Regeln: "" ist ein escaptes Anführungszeichen,
// Trennzeichen und Zeilenumbrüche innerhalb von Anführungszeichen zählen nicht).
// Ein simples split(";") würde an jedem Verwendungszweck mit Semikolon scheitern.
// Liefert je Zeile {nr, felder} — `nr` ist die Zeilennummer in der DATEI (1-basiert,
// wie Excel sie anzeigt). Sie wird mitgeführt statt nachträglich gezählt, weil
// Leerzeilen herausfallen und eine spätere Zählung sonst verrutscht: genau das
// passiert bei einer von Hand bearbeiteten Datei, wo Zeilen gelöscht wurden.
function _parseCsvText(text) {
  const roh = text.replace(/^﻿/, "");            // BOM aus unserem eigenen Export
  const kopfzeile = roh.split(/\r?\n/)[0] || "";
  // Trennzeichen aus der Kopfzeile ableiten: deutsche Exporte nutzen Semikolon,
  // internationale Komma. Tabulator kommt bei Excel-Umwegen ebenfalls vor.
  const trenner = [";", ",", "\t"]
    .map(z => ({ z, anzahl: kopfzeile.split(z).length - 1 }))
    .sort((a, b) => b.anzahl - a.anzahl)[0].z;

  const zeilen = [];
  let feld = "", zeile = [], inQuotes = false, nr = 1;

  for (let i = 0; i < roh.length; i++) {
    const z = roh[i];
    if (inQuotes) {
      if (z === '"') {
        if (roh[i + 1] === '"') { feld += '"'; i++; }   // escaptes Anführungszeichen
        else inQuotes = false;
      } else feld += z;
      continue;
    }
    if (z === '"') { inQuotes = true; continue; }
    if (z === trenner) { zeile.push(feld); feld = ""; continue; }
    if (z === "\r") continue;
    if (z === "\n") {
      zeile.push(feld);
      zeilen.push({ nr, felder: zeile });
      zeile = []; feld = ""; nr++;
      continue;
    }
    feld += z;
  }
  if (feld !== "" || zeile.length) { zeile.push(feld); zeilen.push({ nr, felder: zeile }); }

  // Leerzeilen entfernen — die mitgeführte `nr` bleibt dadurch unberührt.
  return zeilen.filter(z => z.felder.some(f => f.trim() !== ""));
}

// Ordnet die Spalten über die Kopfzeile zu, nicht über feste Positionen — der
// Banker könnte Spalten verschoben haben. Nur wenn keine Kopfzeile erkennbar
// ist, gilt die Reihenfolge aus BANK_EXPORT_CSV_SPALTEN.
const BANK_CSV_SPALTEN_ALIAS = {
  auftraggeberIban:  ["ibandesauftraggebers", "auftraggeberiban"],
  empfaenger:        ["empfaenger", "empfangername", "name", "beguenstigter"],
  iban:              ["ibandesempfaengers", "empfaengeriban", "iban"],
  bic:               ["bic", "bicdesempfaengers", "swift"],
  betrag:            ["betrag", "betragineur", "summe"],
  verwendungszweck:  ["verwendungszweck", "zweck"]
};

function _normalisiereSpaltenname(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function _ermittleCsvSpalten(kopfzeile) {
  const normalisiert = kopfzeile.map(_normalisiereSpaltenname);
  const zuordnung = {};

  Object.keys(BANK_CSV_SPALTEN_ALIAS).forEach(feld => {
    // Exakter Treffer zuerst: "ibandesauftraggebers" und "ibandesempfaengers"
    // enthalten beide "iban", ein Teilstring-Match würde sie vertauschen.
    for (const alias of BANK_CSV_SPALTEN_ALIAS[feld]) {
      const idx = normalisiert.indexOf(alias);
      if (idx !== -1) { zuordnung[feld] = idx; return; }
    }
  });

  // Als Kopfzeile gilt sie nur, wenn die beiden Pflichtspalten gefunden wurden.
  const erkannt = zuordnung.iban != null && zuordnung.betrag != null;
  if (erkannt) return { zuordnung, istKopfzeile: true };

  // Fallback: feste Reihenfolge der Vorlage.
  return {
    zuordnung: { auftraggeberIban: 0, empfaenger: 2, iban: 3, bic: 4, betrag: 6, verwendungszweck: 7 },
    istKopfzeile: false
  };
}

// Liest die geparsten Zeilen in dieselbe Struktur, die _buildSepaXml erwartet
// ({trainer:{vorname,nachname,bic}, iban, betrag}) — so teilen beide Wege den
// gesamten XML-Erzeuger inklusive Zeichensatz- und BIC-Behandlung.
function _csvZeilenZuZahlungen(zeilen) {
  const { zuordnung, istKopfzeile } = _ermittleCsvSpalten((zeilen[0] || {}).felder || []);
  const datenzeilen = istKopfzeile ? zeilen.slice(1) : zeilen;

  const zahlbar = [];
  const uebersprungen = [];
  let auftraggeberIbanAusDatei = "";

  const hole = (zeile, feld) => {
    const idx = zuordnung[feld];
    return idx == null ? "" : String(zeile.felder[idx] == null ? "" : zeile.felder[idx]).trim();
  };

  datenzeilen.forEach(zeile => {
    const zeilennummer = zeile.nr;   // echte Zeile in der Datei, Leerzeilen mitgezählt
    const name   = hole(zeile, "empfaenger");
    const iban   = hole(zeile, "iban").replace(/\s+/g, "").toUpperCase();
    const bic    = hole(zeile, "bic").toUpperCase();
    const betrag = _parseBetrag(hole(zeile, "betrag"));
    const zweck  = hole(zeile, "verwendungszweck");

    if (!auftraggeberIbanAusDatei) {
      auftraggeberIbanAusDatei = hole(zeile, "auftraggeberIban").replace(/\s+/g, "").toUpperCase();
    }

    const gruende = [];
    if (!name) gruende.push("kein Empfänger");
    if (!iban) gruende.push("keine IBAN");
    else if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) gruende.push(`IBAN „${iban}“ ist ungültig`);
    if (betrag == null) gruende.push("kein lesbarer Betrag");
    else if (betrag <= 0) gruende.push("Betrag ist 0 oder negativ");

    if (gruende.length) {
      uebersprungen.push({ zeilennummer, name, grund: gruende.join(", ") });
      return;
    }

    // _buildSepaXml erwartet vorname/nachname getrennt und setzt sie wieder
    // zusammen — der Empfängername steht in der CSV aber als ein Feld. Deshalb
    // komplett in vorname, nachname leer: das ergibt exakt denselben Namen.
    zahlbar.push({ trainer: { vorname: name, nachname: "", bic }, iban, betrag, zweckAusDatei: zweck });
  });

  return { zahlbar, uebersprungen, auftraggeberIbanAusDatei };
}

function _initBankCsvKonverter() {
  const input = document.getElementById("bank-csv-input");

  document.getElementById("btn-bank-csv-zu-xml").addEventListener("click", () => {
    _setBankExportError("");
    document.getElementById("bank-csv-bericht").innerHTML = "";
    input.click();
  });

  input.addEventListener("change", async (e) => {
    const datei = e.target.files[0];
    e.target.value = "";                     // gleiche Datei erneut wählbar
    if (!datei) return;
    try {
      await _konvertiereCsvZuXml(datei);
    } catch (fehler) {
      _setBankExportError(`Die CSV-Datei konnte nicht gelesen werden: ${fehler.message}`);
    }
  });
}

async function _konvertiereCsvZuXml(datei) {
  const berichtEl = document.getElementById("bank-csv-bericht");
  berichtEl.innerHTML = "";

  const text = await _leseCsvDatei(datei);
  const zeilen = _parseCsvText(text);
  if (!zeilen.length) {
    _setBankExportError("Die Datei enthält keine Zeilen.");
    return;
  }

  const { zahlbar, uebersprungen, auftraggeberIbanAusDatei } = _csvZeilenZuZahlungen(zeilen);

  if (!zahlbar.length) {
    _setBankExportError("Keine einzige Zeile der Datei ergibt eine gültige Zahlung. Stimmen die Spalten mit der Bank-Vorlage überein?");
    _zeigeCsvBericht(berichtEl, 0, uebersprungen, datei.name);
    return;
  }

  // Auftraggeber: Name und Datum stehen nie in der Vorlage, die IBAN optional.
  // Steht sie in der Datei, hat sie Vorrang vor dem Panel-Feld — sie gehört zu
  // genau dieser Liste. Sonst gilt die Eingabe oben.
  const auftraggeberName = document.getElementById("bank-auftraggeber-name").value.trim();
  const auftraggeberIbanPanel = document.getElementById("bank-auftraggeber-iban").value.replace(/\s+/g, "").toUpperCase();
  const auftraggeberIban = auftraggeberIbanAusDatei || auftraggeberIbanPanel;
  const auftraggeberBic  = document.getElementById("bank-auftraggeber-bic").value.trim().toUpperCase();
  const ausfuehrungsdatum = document.getElementById("bank-ausfuehrungsdatum").value;

  const fehlt = [];
  if (!auftraggeberName) fehlt.push("Auftraggeber (Kontoinhaber)");
  if (!auftraggeberIban) fehlt.push("IBAN des Auftraggebers (steht auch nicht in der Datei)");
  if (!ausfuehrungsdatum) fehlt.push("Ausführungsdatum");
  if (fehlt.length) {
    _setBankExportError(`Für die SEPA-XML-Datei fehlt noch: ${fehlt.join(", ")}. Die Felder oben ausfüllen und die Datei erneut wählen.`);
    _zeigeCsvBericht(berichtEl, zahlbar.length, uebersprungen, datei.name);
    return;
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(auftraggeberIban)) {
    _setBankExportError("Die IBAN des Auftraggebers scheint ungültig zu sein. Bitte prüfen.");
    return;
  }
  if (ausfuehrungsdatum < _heuteIsoDatum()) {
    _setBankExportError("Das Ausführungsdatum liegt in der Vergangenheit — die Bank würde den Auftrag abweisen.");
    return;
  }

  // Verwendungszweck je Zeile aus der Datei, sonst der aus dem Panel. Steht in
  // beiden nichts, bleibt das Feld in der XML weg (es ist optional). Eine Datei
  // darf dadurch problemlos verschiedene Zwecke enthalten.
  const zweckPanel = document.getElementById("bank-verwendungszweck").value.trim();
  zahlbar.forEach(z => { z.zweck = z.zweckAusDatei || zweckPanel; });

  const xml = _buildSepaXml({
    zahlbar, auftraggeberName, auftraggeberIban, auftraggeberBic, ausfuehrungsdatum,
    verwendungszweck: zweckPanel
  });

  _downloadBankDatei(xml, "application/xml;charset=utf-8;", `Sammelueberweisung_${_heuteIsoDatum()}.xml`);
  _zeigeCsvBericht(berichtEl, zahlbar.length, uebersprungen, datei.name);
}

// Datei mit der richtigen Kodierung lesen: unser eigener Export ist UTF-8 (mit
// BOM), eine in Excel bearbeitete und neu gespeicherte Datei aber oft Windows-1252.
// Ohne BOM und mit kaputten Umlauten wird deshalb ein zweiter Versuch gemacht —
// sonst steht "Hnermund" mit Ersetzungszeichen in der Zahlung.
function _leseCsvDatei(datei) {
  return new Promise((erfuellen, ablehnen) => {
    const leser = new FileReader();
    leser.onerror = () => ablehnen(new Error("Datei nicht lesbar."));
    leser.onload = () => {
      const alsUtf8 = leser.result;
      if (!alsUtf8.includes("�")) return erfuellen(alsUtf8);

      const zweiterLeser = new FileReader();
      zweiterLeser.onerror = () => erfuellen(alsUtf8);   // dann eben mit Ersetzungszeichen
      zweiterLeser.onload = () => erfuellen(zweiterLeser.result);
      zweiterLeser.readAsText(datei, "windows-1252");
    };
    leser.readAsText(datei, "utf-8");
  });
}

function _zeigeCsvBericht(el, anzahlZahlungen, uebersprungen, dateiname) {
  const uebersprungenBlock = uebersprungen.length ? `
    <div class="error-banner visible" style="margin:10px 0 0;">
      <strong>${uebersprungen.length} ${uebersprungen.length === 1 ? "Zeile wurde" : "Zeilen wurden"} übergangen:</strong>
      <ul style="margin:6px 0 0; padding-left:20px;">
        ${uebersprungen.map(u => `<li>Zeile ${u.zeilennummer}${u.name ? ` (${_esc(u.name)})` : ""} — ${_esc(u.grund)}</li>`).join("")}
      </ul>
    </div>` : "";

  el.innerHTML = `
    <p class="muted" style="margin:0;">
      <strong>${_esc(dateiname)}</strong> gelesen:
      ${anzahlZahlungen} ${anzahlZahlungen === 1 ? "Zahlung" : "Zahlungen"} in die XML-Datei übernommen.
    </p>
    ${uebersprungenBlock}`;
}

function _downloadBankDatei(inhalt, mimeType, dateiname) {
  const blob = new Blob([inhalt], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = dateiname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

// ─── Kontoauszug prüfen: CAMT-Abgleich (seit 1.1) ─────────────────────────────
// Der Rückweg zum Bank-Export: die Zahlungsdatei geht an die Bank, der
// Kontoauszug kommt zurück. Beantwortet die eine Frage, die danach offen ist —
// ist das Geld bei jedem Trainer wirklich angekommen?
//
// BEWUSST OHNE SPEICHERUNG: die gelesenen Umsätze landen weder in der
// trainerdaten.json noch sonstwo. Eine Umsatztabelle gehört in die Buchhaltung
// der Vereinsverwaltung (dort liegt die Datenbank), nicht in eine Personendatei;
// hier ist nur die Kontrollansicht. Wer die Bewegungen weiterverarbeiten will,
// nimmt den CSV-Knopf. Rein clientseitig, kein Worker-Redeploy.
//
// Gelesen werden alle drei Auszugsformate der ISO-20022-Familie, weil die Banken
// unterschiedlich liefern: camt.053 (Tagesauszug, <Stmt>), camt.052 (untertägig,
// <Rpt>) und camt.054 (Einzelavis, <Ntfctn>). Der Aufbau darunter ist gleich.

// Letzter eingelesener Stand — nur damit der CSV-Knopf dieselbe Datei nicht ein
// zweites Mal einlesen muss. Wird bei jedem neuen Auszug ersetzt.
let _camtStand = null;

function _initBankCamtAbgleich() {
  const input = document.getElementById("bank-camt-input");

  document.getElementById("btn-bank-camt").addEventListener("click", () => {
    _setBankExportError("");
    document.getElementById("bank-camt-bericht").innerHTML = "";
    input.click();
  });

  input.addEventListener("change", async (e) => {
    const datei = e.target.files[0];
    e.target.value = "";                     // gleiche Datei erneut wählbar
    if (!datei) return;
    try {
      await _pruefeKontoauszug(datei);
    } catch (fehler) {
      _setBankExportError(`Der Kontoauszug konnte nicht gelesen werden: ${fehler.message}`);
    }
  });

  document.getElementById("btn-bank-camt-csv").addEventListener("click", _exportiereCamtUmsaetze);
}

// ─── Namespace-tolerante DOM-Helfer ───────────────────────────────────────────
// Die Auszüge kommen je nach Bank als camt.053.001.02 oder .001.08, mal mit,
// mal ohne Namespace-Präfix am Tag. Verglichen wird deshalb immer der lokale
// Name (`localName`), nie der vollständige Tagname.
function _camtKinder(el, name) {
  if (!el) return [];
  return Array.prototype.filter.call(el.children, k => k.localName === name);
}

function _camtKind(el, ...pfad) {
  let aktuell = el;
  for (const name of pfad) {
    aktuell = _camtKinder(aktuell, name)[0];
    if (!aktuell) return null;
  }
  return aktuell;
}

function _camtText(el, ...pfad) {
  const k = pfad.length ? _camtKind(el, ...pfad) : el;
  return k ? (k.textContent || "").trim() : "";
}

// Erstes Element mit diesem lokalen Namen irgendwo im Teilbaum. Nötig, weil
// einige Felder je Schema-Version unterschiedlich tief hängen: der Empfängername
// steht in .02 als <Cdtr><Nm>, ab .08 als <Cdtr><Pty><Nm>.
function _camtTiefe(el, ...namen) {
  if (!el) return null;
  const alle = el.getElementsByTagName("*");
  for (let i = 0; i < alle.length; i++) {
    if (namen.includes(alle[i].localName)) return alle[i];
  }
  return null;
}

// Alle Texte eines Feldnamens im Teilbaum — <Ustrd> darf mehrfach vorkommen und
// enthält dann die Fortsetzung desselben Verwendungszwecks.
function _camtTexteTief(el, name) {
  if (!el) return [];
  const werte = [];
  const alle = el.getElementsByTagName("*");
  for (let i = 0; i < alle.length; i++) {
    if (alle[i].localName === name) werte.push((alle[i].textContent || "").trim());
  }
  return werte.filter(Boolean);
}

// <BookgDt>/<ValDt> tragen entweder <Dt> (nur Datum) oder <DtTm> (mit Uhrzeit).
function _camtDatum(el, name) {
  const knoten = _camtKind(el, name);
  if (!knoten) return "";
  return (_camtText(knoten, "Dt") || _camtText(knoten, "DtTm")).slice(0, 10);
}

// ISO 20022 schreibt den Punkt als Dezimaltrennzeichen vor und kennt keine
// Tausendertrenner. Hier bewusst NICHT _parseBetrag verwenden — das ist für das
// freie deutsche Pauschale-Feld gebaut und läse "1.250" als 1250.
function _camtBetrag(text) {
  const roh = String(text || "").trim();
  if (!roh) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

// Beträge immer in Cent vergleichen — 0.1 + 0.2 !== 0.3 gilt auch für Euro.
function _cent(n) {
  return Math.round(Number(n || 0) * 100);
}

// ─── Parser ───────────────────────────────────────────────────────────────────
function _parseCamt(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) {
    throw new Error("Die Datei ist keine gültige XML-Datei.");
  }

  const alleElemente = doc.documentElement.getElementsByTagName("*");
  const auszuege = [];
  for (let i = 0; i < alleElemente.length; i++) {
    const lokal = alleElemente[i].localName;
    if (lokal === "Stmt" || lokal === "Rpt" || lokal === "Ntfctn") auszuege.push(alleElemente[i]);
  }
  if (!auszuege.length) {
    throw new Error("Die Datei enthält keinen Kontoauszug — erwartet wird CAMT.053, .052 oder .054.");
  }

  const konten = [];
  const umsaetze = [];

  auszuege.forEach(auszug => {
    const kontoIban = _camtText(_camtKind(auszug, "Acct", "Id"), "IBAN");

    // Anfangs- und Endsaldo stehen als <Bal> mit Typ-Code: OPBD/PRCD ist der
    // Eröffnungssaldo, CLBD der Schlusssaldo. DBIT heißt hier "Konto im Minus".
    const salden = {};
    _camtKinder(auszug, "Bal").forEach(bal => {
      const code   = _camtText(_camtKind(bal, "Tp", "CdOrPrtry"), "Cd");
      const betrag = _camtBetrag(_camtText(bal, "Amt"));
      if (betrag == null) return;
      const wert = _camtText(bal, "CdtDbtInd") === "DBIT" ? -betrag : betrag;
      if (code === "OPBD" || code === "PRCD") salden.anfang = wert;
      if (code === "CLBD") salden.ende = wert;
    });

    const frToDt = _camtKind(auszug, "FrToDt");
    konten.push({
      iban: kontoIban,
      nummer: _camtText(auszug, "ElctrncSeqNb") || _camtText(auszug, "LglSeqNb"),
      von: frToDt ? _camtText(frToDt, "FrDtTm").slice(0, 10) : "",
      bis: frToDt ? _camtText(frToDt, "ToDtTm").slice(0, 10) : "",
      saldoAnfang: salden.anfang,
      saldoEnde: salden.ende
    });

    _camtKinder(auszug, "Ntry").forEach(ntry => {
      const gemeinsam = {
        ntry,
        kontoIban,
        buchung: _camtDatum(ntry, "BookgDt"),
        wert: _camtDatum(ntry, "ValDt"),
        // <Sts> ist in .02 direkter Text ("BOOK"), ab .08 <Sts><Cd>BOOK</Cd> —
        // textContent liefert in beiden Fällen dasselbe.
        status: _camtText(ntry, "Sts"),
        richtung: _camtText(ntry, "CdtDbtInd"),
        betrag: _camtBetrag(_camtText(ntry, "Amt"))
      };

      // Eine Sammelbuchung kann mehrere <TxDtls> tragen. Fehlen sie ganz, ist
      // der <Ntry> selbst der Umsatz — so bucht die Bank Einzelposten, aber
      // eben auch eine nicht aufgeschlüsselte Sammelüberweisung.
      const details = [];
      _camtKinder(ntry, "NtryDtls").forEach(nd => {
        _camtKinder(nd, "TxDtls").forEach(td => details.push(td));
      });

      if (!details.length) {
        const btch = _camtTiefe(ntry, "Btch");
        const anzahl = btch ? parseInt(_camtText(btch, "NbOfTxs"), 10) : 0;
        umsaetze.push(_camtUmsatz(Object.assign({}, gemeinsam, {
          el: ntry,
          sammelAnzahl: Number.isFinite(anzahl) ? anzahl : 0
        })));
        return;
      }

      details.forEach(td => {
        const betrag = _camtBetrag(_camtText(td, "Amt"));
        umsaetze.push(_camtUmsatz(Object.assign({}, gemeinsam, {
          el: td,
          richtung: _camtText(td, "CdtDbtInd") || gemeinsam.richtung,
          betrag: betrag == null ? gemeinsam.betrag : betrag,
          sammelAnzahl: 0
        })));
      });
    });
  });

  return { konten, umsaetze };
}

function _camtUmsatz(o) {
  const istBelastung = o.richtung === "DBIT";

  // Die Gegenpartei ist bei einer Belastung der Empfänger (Cdtr), bei einer
  // Gutschrift der Zahler (Dbtr) — sonst steht bei jeder Gutschrift der Verein
  // selbst als Gegenpartei da.
  const parteien = _camtTiefe(o.el, "RltdPties");
  const partei   = parteien ? _camtKind(parteien, istBelastung ? "Cdtr" : "Dbtr") : null;
  const konto    = parteien ? _camtKind(parteien, istBelastung ? "CdtrAcct" : "DbtrAcct") : null;
  const agenten  = _camtTiefe(o.el, "RltdAgts");
  const agent    = agenten ? _camtKind(agenten, istBelastung ? "CdtrAgt" : "DbtrAgt") : null;

  const nameEl = partei ? _camtTiefe(partei, "Nm") : null;
  const ibanEl = konto ? _camtTiefe(konto, "IBAN") : null;
  const bicEl  = agent ? _camtTiefe(agent, "BIC", "BICFI") : null;   // .08 nennt es BICFI

  // Verwendungszweck: strukturierte und unstrukturierte Angabe, sonst der
  // Freitext der Buchungszeile.
  const zweck = _camtTexteTief(_camtTiefe(o.el, "RmtInf"), "Ustrd").join(" ")
    || _camtText(o.ntry, "AddtlNtryInf");

  // "NOTPROVIDED" ist der Platzhalter für "keine Referenz vergeben" und als
  // Kennung wertlos.
  const endToEnd = _camtText(_camtTiefe(o.el, "Refs"), "EndToEndId");

  return {
    buchung: o.buchung,
    wert: o.wert,
    status: o.status,
    betrag: o.betrag,
    richtung: o.richtung,
    istBelastung,
    kontoIban: o.kontoIban,
    name: nameEl ? (nameEl.textContent || "").trim() : "",
    iban: ibanEl ? (ibanEl.textContent || "").replace(/\s+/g, "").toUpperCase() : "",
    bic: bicEl ? (bicEl.textContent || "").trim().toUpperCase() : "",
    zweck,
    endToEnd: endToEnd === "NOTPROVIDED" ? "" : endToEnd,
    ausUnseremExport: endToEnd.startsWith(SEPA_MSG_PRAEFIX + "-"),
    sammelAnzahl: o.sammelAnzahl || 0,
    zugeordnetZu: ""
  };
}

// ─── Abgleich ─────────────────────────────────────────────────────────────────
// Schlüssel für den Ersatz-Abgleich über den Namen: der Auszug führt die
// Gegenpartei als EINEN String, mal „Max Mustermann“, mal „Mustermann Max“ —
// verglichen wird deshalb die sortierte Wortmenge. Die Umlaute laufen durch
// dieselbe Transliteration wie der SEPA-Export, denn genau dessen Schreibweise
// (Hünermund → Huenermund) steht anschließend im Auszug.
function _camtNameKey(name) {
  return _sepaText(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function _camtAbgleich(umsaetze, zahlbar) {
  // Jede erwartete Zahlung bekommt höchstens einen Umsatz und jeder Umsatz
  // höchstens eine Zahlung. Ohne diese Sperre beanspruchen zwei Trainer mit
  // derselben IBAN (gemeinsames Konto) dieselbe Buchung, und der Bericht meldet
  // beide als bezahlt, obwohl nur einer sein Geld hat.
  const posten = zahlbar.map(k => ({
    kandidat: k,
    name: `${k.trainer.vorname || ""} ${k.trainer.nachname || ""}`.trim(),
    umsatz: null,
    ueberName: false
  }));

  const nachIban = new Map();
  const nachName = new Map();
  const eintragen = (map, schluessel, p) => {
    if (!schluessel) return;
    if (!map.has(schluessel)) map.set(schluessel, []);
    map.get(schluessel).push(p);
  };
  posten.forEach(p => {
    eintragen(nachIban, p.kandidat.iban, p);
    eintragen(nachName, _camtNameKey(p.name), p);
  });

  const belastungen = umsaetze.filter(u => u.istBelastung);
  const nichtZugeordnet = [];

  belastungen.forEach(u => {
    u.zugeordnetZu = "";                       // Vorlauf zurücksetzen (Datei erneut geprüft)

    // IBAN zuerst — sie ist eindeutig. Der Name ist nur der Notnagel für
    // Auszüge, die keine Empfänger-IBAN mitliefern.
    let kandidaten = (u.iban && nachIban.get(u.iban)) || [];
    let ueberName = false;
    if (!kandidaten.length) {
      kandidaten = nachName.get(_camtNameKey(u.name)) || [];
      ueberName = kandidaten.length > 0;
    }

    const frei = kandidaten.filter(p => !p.umsatz);
    if (!frei.length) { nichtZugeordnet.push(u); return; }

    // Bei mehreren freien Kandidaten gewinnt der mit exakt passendem Betrag —
    // sonst schnappt der erste sich die Buchung und für den zweiten meldet der
    // Bericht eine Abweichung, die es gar nicht gibt.
    const treffer = frei.find(p => _cent(p.kandidat.betrag) === _cent(u.betrag)) || frei[0];
    treffer.umsatz = u;
    treffer.ueberName = ueberName;
    u.zugeordnetZu = treffer.name;
  });

  const bezahlt = [], abweichend = [], offen = [];
  posten.forEach(p => {
    if (!p.umsatz) offen.push(p);
    else if (_cent(p.umsatz.betrag) === _cent(p.kandidat.betrag)) bezahlt.push(p);
    else abweichend.push(p);
  });

  return { bezahlt, abweichend, offen, nichtZugeordnet, anzahlBelastungen: belastungen.length };
}

// Bucht die Bank die Sammelüberweisung als EINE Zeile ohne Einzelposten, findet
// der Abgleich naturgemäß keine einzige Zahlung wieder und meldete sonst
// wahrheitswidrig „alle fehlen“. Erkennbar ist der Fall an einer nicht
// zugeordneten Belastung, die entweder ausdrücklich als Sammelposten
// ausgewiesen ist oder exakt der Summe der vermissten Zahlungen entspricht.
function _camtSammelbuchung(nichtZugeordnet, offen) {
  const summeOffen = _cent(offen.reduce((s, p) => s + p.kandidat.betrag, 0));
  return nichtZugeordnet.find(u =>
    u.sammelAnzahl > 1 || (summeOffen > 0 && _cent(u.betrag) === summeOffen)
  ) || null;
}

// ─── Ablauf ───────────────────────────────────────────────────────────────────
async function _pruefeKontoauszug(datei) {
  const berichtEl = document.getElementById("bank-camt-bericht");
  berichtEl.innerHTML = "";
  _camtStand = null;
  _setCamtCsvKnopf(false);

  const { konten, umsaetze } = _parseCamt(await _leseXmlDatei(datei));
  if (!umsaetze.length) {
    _setBankExportError("Der Kontoauszug enthält keine Umsätze.");
    return;
  }

  // Abgeglichen wird gegen dieselbe Menge, aus der auch die Zahlungsdatei
  // entsteht — also inklusive Suche, Filter und Gruppen-Auswahl.
  const { zahlbar } = _bankExportKandidaten();
  const abgleich = _camtAbgleich(umsaetze, zahlbar);

  _camtStand = { dateiname: datei.name, konten, umsaetze };
  _setCamtCsvKnopf(true);
  _zeigeCamtBericht(berichtEl, datei.name, konten, umsaetze, abgleich, zahlbar.length);
}

function _setCamtCsvKnopf(aktiv) {
  const btn = document.getElementById("btn-bank-camt-csv");
  if (btn) btn.disabled = !aktiv;
}

// Wie _leseCsvDatei, aber die Kodierung steht bei XML in der Datei selbst.
// Deshalb erst als UTF-8 lesen, die Deklaration auswerten und nur bei einer
// abweichenden Angabe ein zweites Mal lesen — Auszüge älterer Banksoftware
// kommen durchaus als ISO-8859-1.
function _leseXmlDatei(datei) {
  return new Promise((erfuellen, ablehnen) => {
    const leser = new FileReader();
    leser.onerror = () => ablehnen(new Error("Datei nicht lesbar."));
    leser.onload = () => {
      const alsUtf8 = leser.result;
      const deklariert = (/<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(alsUtf8 || "") || [])[1];
      const kodierung = (deklariert || "utf-8").toLowerCase();
      if (kodierung === "utf-8" || kodierung === "utf8") return erfuellen(alsUtf8);

      const zweiterLeser = new FileReader();
      zweiterLeser.onerror = () => erfuellen(alsUtf8);          // dann eben als UTF-8
      zweiterLeser.onload = () => erfuellen(zweiterLeser.result);
      zweiterLeser.readAsText(datei, kodierung);
    };
    leser.readAsText(datei, "utf-8");
  });
}

// ─── Bericht ──────────────────────────────────────────────────────────────────
function _zeigeCamtBericht(el, dateiname, konten, umsaetze, abgleich, anzahlErwartet) {
  const { bezahlt, abweichend, offen, nichtZugeordnet } = abgleich;
  const summeBezahlt = bezahlt.reduce((s, p) => s + p.umsatz.betrag, 0);
  const gutschriften = umsaetze.length - abgleich.anzahlBelastungen;

  const kontoZeilen = konten.map(k => {
    const teile = [];
    if (k.iban) teile.push(`Konto <strong>${_esc(k.iban)}</strong>`);
    if (k.nummer) teile.push(`Auszug Nr. ${_esc(k.nummer)}`);
    if (k.von || k.bis) teile.push(`${_fmtDateOnly(k.von) || "?"} – ${_fmtDateOnly(k.bis) || "?"}`);
    if (k.saldoAnfang != null) teile.push(`Anfangssaldo ${_fmtBetrag(k.saldoAnfang, ",")} €`);
    if (k.saldoEnde != null) teile.push(`Endsaldo ${_fmtBetrag(k.saldoEnde, ",")} €`);
    return `<li>${teile.join(" · ")}</li>`;
  }).join("");

  const liste = (eintraege) =>
    `<ul style="margin:6px 0 0; padding-left:20px;">${eintraege.join("")}</ul>`;

  // Ein zugeordneter Umsatz ohne IBAN-Treffer ist nur wahrscheinlich richtig —
  // das wird ausgewiesen, statt es als sichere Zahlung auszugeben.
  const ueberNamen = bezahlt.filter(p => p.ueberName).length;

  // Ohne erwartete Zahlungen gibt es nichts abzugleichen — dann wäre „0 von 0
  // wiedergefunden“ eine Aussage, die nach einem Ergebnis klingt und keines ist.
  const bezahltBlock = anzahlErwartet === 0 ? `
    <p class="muted" style="margin:10px 0 0;">
      In der aktuellen Auswahl gibt es keine Zahlung, gegen die sich der Auszug abgleichen ließe —
      kein Trainer hat sowohl eine IBAN als auch eine Pauschale. Die Umsätze oben sind trotzdem gelesen.
    </p>` : `
    <p class="muted" style="margin:10px 0 0;">
      <strong>${bezahlt.length} von ${anzahlErwartet}</strong>
      ${anzahlErwartet === 1 ? "erwarteter Zahlung" : "erwarteten Zahlungen"} im Auszug wiedergefunden
      (zusammen <strong>${_fmtBetrag(summeBezahlt, ",")} €</strong>).${ueberNamen ? `
      <br /><em>${ueberNamen} davon nur über den Empfängernamen zugeordnet, nicht über die IBAN — bitte stichprobenhaft prüfen.</em>` : ""}
    </p>`;

  const abweichendBlock = abweichend.length ? `
    <div class="error-banner visible" style="margin:10px 0 0;">
      <strong>${abweichend.length} ${abweichend.length === 1 ? "Zahlung wurde" : "Zahlungen wurden"} mit einem anderen Betrag gebucht:</strong>
      ${liste(abweichend.map(p => `<li>${_esc(p.name)} — erwartet ${_fmtBetrag(p.kandidat.betrag, ",")} €,
        gebucht <strong>${_fmtBetrag(p.umsatz.betrag, ",")} €</strong>${p.umsatz.buchung ? ` am ${_fmtDateOnly(p.umsatz.buchung)}` : ""}</li>`))}
    </div>` : "";

  const offenBlock = offen.length ? `
    <div class="error-banner visible" style="margin:10px 0 0;">
      <strong>${offen.length} ${offen.length === 1 ? "Zahlung fehlt" : "Zahlungen fehlen"} im Auszug:</strong>
      ${liste(offen.map(p => `<li>${_esc(p.name)} — ${_fmtBetrag(p.kandidat.betrag, ",")} € an ${_esc(p.kandidat.iban)}</li>`))}
    </div>` : "";

  // Nicht zugeordnete Belastungen werden vollständig gezeigt, nicht still
  // verschluckt: darunter steckt sonst genau die Zahlung, die an eine falsche
  // IBAN ging.
  const restBlock = nichtZugeordnet.length ? `
    <div class="muted" style="margin:10px 0 0;">
      <strong>${nichtZugeordnet.length} ${nichtZugeordnet.length === 1 ? "Belastung" : "Belastungen"}</strong>
      ${nichtZugeordnet.length === 1 ? "gehört" : "gehören"} zu keinem Trainer der aktuellen Auswahl:
      ${liste(nichtZugeordnet.map(u => `<li>${u.buchung ? _fmtDateOnly(u.buchung) + " · " : ""}${_fmtBetrag(u.betrag, ",")} €
        · ${_esc(u.name || "ohne Empfängernamen")}${u.iban ? ` · ${_esc(u.iban)}` : ""}${u.ausUnseremExport ? `
        <em>(trägt unsere Referenz ${_esc(u.endToEnd)})</em>` : ""}</li>`))}
    </div>` : "";

  const sammel = _camtSammelbuchung(nichtZugeordnet, offen);
  const sammelBlock = sammel ? `
    <div class="error-banner visible" style="margin:10px 0 0;">
      <strong>Der Auszug enthält die Überweisung offenbar als eine einzige Sammelbuchung</strong>
      (${_fmtBetrag(sammel.betrag, ",")} €${sammel.sammelAnzahl > 1 ? ` über ${sammel.sammelAnzahl} Posten` : ""})
      ohne die einzelnen Empfänger. Ein Abgleich je Trainer ist damit nicht möglich —
      die Summe stimmt aber überein. Für einen Abgleich je Person braucht es einen Auszug
      mit Einzelposten oder die Umsatzanzeige CAMT.054 der Bank.
    </div>` : "";

  el.innerHTML = `
    <div class="muted" style="margin:0;">
      <strong>${_esc(dateiname)}</strong> gelesen:
      ${umsaetze.length} ${umsaetze.length === 1 ? "Umsatz" : "Umsätze"}
      (${abgleich.anzahlBelastungen} ${abgleich.anzahlBelastungen === 1 ? "Belastung" : "Belastungen"},
      ${gutschriften} ${gutschriften === 1 ? "Gutschrift" : "Gutschriften"}).
      ${kontoZeilen ? `<ul style="margin:6px 0 0; padding-left:20px;">${kontoZeilen}</ul>` : ""}
    </div>
    ${sammelBlock}
    ${bezahltBlock}
    ${abweichendBlock}
    ${offenBlock}
    ${restBlock}`;
}

// ─── Umsätze als CSV ──────────────────────────────────────────────────────────
// Brücke nach draußen: hier wird bewusst nichts gespeichert, aber die gelesenen
// Bewegungen sollen sich weiterverarbeiten lassen — in der Buchhaltung der
// Vereinsverwaltung, in Excel oder im Kassenbuch. Eigenes Format, keine
// Vorgabe der Bank (anders als BANK_EXPORT_CSV_SPALTEN).
const CAMT_CSV_SPALTEN = [
  "Buchungstag", "Wertstellung", "Betrag", "Währung", "Soll/Haben",
  "Name", "IBAN", "BIC", "Verwendungszweck", "Referenz (EndToEndId)",
  "Zugeordnet zu", "Konto"
];

function _exportiereCamtUmsaetze() {
  if (!_camtStand) return;

  const zeilen = [CAMT_CSV_SPALTEN, ..._camtStand.umsaetze.map(u => [
    _fmtDateOnly(u.buchung),
    _fmtDateOnly(u.wert),
    // Belastungen mit Minus: so ergibt eine Summenformel über die Spalte
    // unmittelbar die Kontoveränderung.
    _fmtBetrag(u.istBelastung ? -u.betrag : u.betrag, ","),
    "EUR",
    u.istBelastung ? "Soll" : "Haben",
    u.name,
    u.iban,
    u.bic,
    u.zweck,
    u.endToEnd,
    u.zugeordnetZu,
    u.kontoIban
  ])];

  const csv = String.fromCharCode(0xFEFF) + zeilen.map(z => z.map(_csvCell).join(";")).join("\r\n");
  _downloadBankDatei(csv, "text/csv;charset=utf-8;", `Kontoumsaetze_${_heuteIsoDatum()}.csv`);
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
      const labels = { generiert: "Vertrag erstellt", ausstehend: "Ausstehend", unvollstaendig: "Unvollständig", kontaktdaten: "Nur Kontaktdaten" };
      return labels[_trainerStatus(t)] || "";
    }
    case "derived-eingereicht":
      return _eingereichtAm(t) ? _fmtIso(_eingereichtAm(t)) : "";
    case "derived-gruppen":
      return _trainerGruppenNamen(t);
    case "derived-mannschaften":
      return _trainerMannschaften(t);
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

  // Unterschrift-Vorschau (jetzt ausgelagert -> per WebDAV nachladen). Der Guard gegen
  // currentTrainerId verhindert, dass eine langsame Antwort ins Detail eines inzwischen
  // gewechselten Trainers rendert.
  const prev = document.getElementById("d-signature-preview");
  const hint = document.getElementById("d-signature-hint");
  const _zeigeSignatur = (dataUrl) => {
    prev.innerHTML = `<img src="${_esc(dataUrl)}" alt="Unterschrift" style="max-width:260px; max-height:90px; border:1px solid #dde1e8; border-radius:6px;" />`;
    hint.textContent = "";
  };
  if (t.signatureDataUrl) {
    // Alt-Eintrag, noch nicht migriert -> die inline vorhandene Unterschrift direkt zeigen.
    _zeigeSignatur(t.signatureDataUrl);
  } else if (t.signaturVorhanden) {
    prev.innerHTML = "";
    hint.textContent = "Unterschrift wird geladen …";
    _ladeSignaturDataUrl(SIGNATUR_SUBDIR.haupt, t.id).then(dataUrl => {
      if (currentTrainerId !== t.id) return;
      if (dataUrl) _zeigeSignatur(dataUrl);
      else hint.textContent = "Unterschrift konnte nicht geladen werden.";
    });
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

// Unterschriften liegen (ausgelagert aus der JSON) als eigene PNG-Dateien in
// Geschwister-Unterordnern von trainerdaten.json — gleiche Ablage wie die Dokumente.
const SIGNATUR_SUBDIR = {
  haupt:        "unterschriften",
  kodex:        "kodex-unterschriften",
  jugendschutz: "jugendschutz-unterschriften"
};

// Lädt eine ausgelagerte Unterschrift im Admin-Modus direkt per WebDAV (davReadBinary
// über den CORS-Proxy, wie _ansehenDocumentAdmin) und gibt sie als anzeigbare PNG-
// DataURL zurück — "" bei fehlender Datei/Fehler (Anzeige zeigt dann einen Hinweis).
async function _ladeSignaturDataUrl(subdir, trainerId) {
  try {
    const blob = await davReadBinary(_trainerDocConfig(subdir, trainerId), "image/png");
    if (!blob) return "";
    return await _blobToDataUrl(blob);
  } catch (_) {
    return "";
  }
}

function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error("Blob-Lesefehler"));
    fr.readAsDataURL(blob);
  });
}

function _renderDocumentsSection(t) {
  const tlStatusEl   = document.getElementById("d-tl-status");
  const tlAnsehenBtn = document.getElementById("btn-d-tl-ansehen");
  const tlUploadBtn  = document.getElementById("btn-d-tl-upload");
  const tlCameraBtn  = document.getElementById("btn-d-tl-camera");
  const tlLoeschBtn  = document.getElementById("btn-d-tl-loeschen");
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
  // Löschen hat dieselbe Bedingung wie Ansehen (es muss eine Datei da sein), deshalb
  // einmal nach dem Block statt in jedem Zweig.
  tlLoeschBtn.disabled = !t.trainerlizenzHochgeladenAm;

  const fsStatusEl   = document.getElementById("d-fs-status");
  const fsAnsehenBtn = document.getElementById("btn-d-fs-ansehen");
  const fsUploadBtn  = document.getElementById("btn-d-fs-upload");
  const fsCameraBtn  = document.getElementById("btn-d-fs-camera");
  const fsLoeschBtn  = document.getElementById("btn-d-fs-loeschen");
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
  fsLoeschBtn.disabled = !t.fuehrerscheinHochgeladenAm;

  const fzStatusEl   = document.getElementById("d-fz-status");
  const fzAnsehenBtn = document.getElementById("btn-d-fz-ansehen");
  const fzUploadBtn  = document.getElementById("btn-d-fz-upload");
  const fzCameraBtn  = document.getElementById("btn-d-fz-camera");
  const fzLoeschBtn  = document.getElementById("btn-d-fz-loeschen");
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
  fzLoeschBtn.disabled = !t.fuehrungszeugnisEingereichtAm;

  const vStatusEl = document.getElementById("d-vertrag-status");
  const vOrigBtn  = document.getElementById("btn-d-vertrag-ansehen");
  const vSignBtn  = document.getElementById("btn-d-vertrag-signiert-ansehen");
  const vResetBtn = document.getElementById("btn-d-vertrag-reset");
  const vNeuBtn   = document.getElementById("btn-d-vertrag-neuausstellung");
  if (t.vertragPdfBereitgestelltAm) {
    let html = "Bereitgestellt am " + _esc(_fmtIso(t.vertragPdfBereitgestelltAm));
    html += t.vertragUnterschriebenAm
      ? ` · <span class="badge generiert">Unterschrieben am ${_esc(_fmtIso(t.vertragUnterschriebenAm))}</span>`
      : ` · <span class="muted">noch nicht unterschrieben</span>`;
    vStatusEl.innerHTML = html;
    vOrigBtn.disabled = false;
    vSignBtn.disabled = !t.vertragUnterschriebenAm;
    vResetBtn.disabled = !t.vertragUnterschriebenAm;
    vNeuBtn.disabled = false;
  } else {
    vStatusEl.textContent = "Noch kein Vertrag zugewiesen (per generate-pdfs.ps1 -Zuweisen).";
    vOrigBtn.disabled = true;
    vSignBtn.disabled = true;
    vResetBtn.disabled = true;
    vNeuBtn.disabled = true;
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
    // Signatur ausgelagert -> per WebDAV nachladen (Guard gegen Trainer-Wechsel).
    // Alt-Eintrag mit noch inline vorhandener Signatur (nicht migriert): direkt zeigen.
    if (t.kodexSignatureDataUrl) {
      imgEl.src = t.kodexSignatureDataUrl;
      imgEl.style.display = "";
    } else {
      imgEl.style.display = "none";
      _ladeSignaturDataUrl(SIGNATUR_SUBDIR.kodex, t.id).then(dataUrl => {
        if (currentTrainerId !== t.id || !dataUrl) return;
        imgEl.src = dataUrl;
        imgEl.style.display = "";
      });
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
    // Ausgelagerte Unterschrift-Datei mitentfernen (best-effort; die Anzeige ist ohnehin
    // an kodexBestaetigtAm gegated, eine verwaiste Datei würde nie mehr gezeigt).
    try { await davDeleteFile(_trainerDocConfig(SIGNATUR_SUBDIR.kodex, currentTrainerId)); } catch (_) {}
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
    // Signatur ausgelagert -> per WebDAV nachladen (Guard gegen Trainer-Wechsel).
    // Alt-Eintrag mit noch inline vorhandener Signatur (nicht migriert): direkt zeigen.
    if (t.jugendschutzSignatureDataUrl) {
      imgEl.src = t.jugendschutzSignatureDataUrl;
      imgEl.style.display = "";
    } else {
      imgEl.style.display = "none";
      _ladeSignaturDataUrl(SIGNATUR_SUBDIR.jugendschutz, t.id).then(dataUrl => {
        if (currentTrainerId !== t.id || !dataUrl) return;
        imgEl.src = dataUrl;
        imgEl.style.display = "";
      });
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
    // Ausgelagerte Unterschrift-Datei mitentfernen (best-effort, siehe _resetKodexAdmin).
    try { await davDeleteFile(_trainerDocConfig(SIGNATUR_SUBDIR.jugendschutz, currentTrainerId)); } catch (_) {}
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

  appData.trainer[idx] = { ...appData.trainer[idx], vertragUnterschriebenAm: "", vertragSigniertPfad: "" };
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Zurücksetzen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  _renderDocumentsSection(appData.trainer[idx]);
}

// Setzt die KOMPLETTE Vertragszuweisung zurueck (anders als der reine Unterschrift-
// Reset oben) -- fuer den Einzelfall "ausgestellter Vertrag war fehlerhaft, bitte neu
// ausstellen". generate-pdfs.ps1 -Zuweisen ueberspringt bewusst jeden Trainer mit
// gesetztem vertragPdfBereitgestelltAm; erst dieses Zuruecksetzen macht den Trainer
// dort wieder sichtbar. Das Status-Override wird mitgeleert (wie handleSubmit im
// Worker), damit die Ampel nicht auf einem manuellen Wert haengen bleibt.
async function _resetVertragAdmin() {
  if (!currentTrainerId) return;
  const t = appData.trainer.find(x => x.id === currentTrainerId);
  if (!t) return;
  if (!confirm(`Trainervertrag von ${t.vorname} ${t.nachname} wirklich zurücksetzen? Der zugewiesene Vertrag samt Unterschrift wird entfernt. Der nächste Lauf von generate-pdfs.ps1 -Zuweisen stellt einen neuen Vertrag aus.`)) return;

  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;

  const altePfade = [appData.trainer[idx].vertragSigniertPfad, appData.trainer[idx].vertragPdfPfad].filter(Boolean);
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    vertragPdfPfad: "", vertragPdfBereitgestelltAm: "",
    vertragUnterschriebenAm: "", vertragSigniertPfad: "",
    vertragsGeneriert: false,
    status: ""
  };
  try {
    await _saveMerged();
    // Abgelegte PDFs best-effort mitentfernen (wie _resetKodexAdmin) -- sonst blieben
    // bei einer Namenskorrektur verwaiste Dateien im alten vertraege/-Ordner zurueck.
    const dir = davConfig.url.slice(0, davConfig.url.lastIndexOf("/"));
    for (const rel of altePfade) {
      try { await davDeleteFile({ ...davConfig, url: dir + "/" + rel }); } catch (_) {}
    }
  } catch (err) {
    errEl.textContent = "Zurücksetzen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
  }
  const statusSelect = document.getElementById("d-status");
  if (statusSelect) statusSelect.value = _trainerStatus(appData.trainer[idx]);
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

// Löscht ein hinterlegtes Dokument — Gegenstück zu _uploadDocumentAdmin, für den Fall
// "das Hinterlegte taugt nicht, die Person soll ein neues hochladen". Bewusst getrennt
// von "Ersetzen": danach steht der Status wieder auf offen, die Person sieht ihre
// Aufgabe in der eigenen Dokumente-Karte wieder.
//
// Reihenfolge ist _uploadDocumentAdmin gespiegelt (erst Datei, dann Metadaten): bricht
// Schritt 2 ab, ist das Dokument weg und der Status behauptet noch "vorhanden" — ein
// erneuter Löschversuch heilt das (davDeleteFile toleriert 404). Andersherum bliebe die
// Datei ohne jeden Verweis darauf liegen, was gerade beim Führungszeugnis niemand will.
async function _deleteDocumentAdmin(subdir, dateField, nameField, ctypeField, label) {
  if (!currentTrainerId) return;
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;
  const t = appData.trainer[idx];
  if (!t[dateField]) return;
  if (!confirm(`${label} von ${t.vorname} ${t.nachname} wirklich löschen? Die Datei wird endgültig entfernt — danach steht das Dokument wieder als offen da und muss neu hochgeladen werden.`)) return;

  const errEl = document.getElementById("d-doc-error");
  errEl.style.display = "none";
  try {
    await davDeleteFile(_trainerDocConfig(subdir, t.id));
  } catch (err) {
    errEl.textContent = "Löschen fehlgeschlagen: " + err.message;
    errEl.style.display = "block";
    return;
  }

  // trainerlizenzNichtVorhanden/-Art/-GueltigBis bleiben stehen: das sind Aussagen über
  // die Lizenz der Person, nicht über die gelöschte Scan-Datei — gleiche Trennung wie
  // beim Re-Upload, der Art/Gültig-bis ebenfalls unangetastet lässt.
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    [dateField]: "",
    [nameField]: "",
    [ctypeField]: ""
  };
  try {
    await _saveMerged();
  } catch (err) {
    errEl.textContent = "Datei gelöscht, aber Speichern der Metadaten fehlgeschlagen: " + err.message;
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

// Kopie fürs PDF: die (ausgelagerte) Unterschrift transient nachladen, aber NICHT in
// appData.trainer zurückschreiben — sonst landete sie beim nächsten Speichern wieder
// inline in der JSON und der ganze Größenvorteil wäre dahin. Beide PDF-Wege (einzeln
// und Sammel-ZIP) müssen da durch, sonst fehlt die Unterschrift im fertigen Vertrag.
async function _trainerMitSignatur(t) {
  const kopie = { ...t };
  if (kopie.signaturVorhanden && !kopie.signatureDataUrl) {
    kopie.signatureDataUrl = await _ladeSignaturDataUrl(SIGNATUR_SUBDIR.haupt, kopie.id);
  }
  return kopie;
}

async function _generatePdfEinzeln() {
  const btn = document.getElementById("btn-pdf-einzeln");
  if (!currentTrainerId) return;
  const idx = appData.trainer.findIndex(x => x.id === currentTrainerId);
  if (idx === -1) return;
  appData.trainer[idx] = { ...appData.trainer[idx], ..._collectDetailData() };
  btn.disabled = true;
  btn.textContent = "Generiere PDF …";
  try {
    await generiereVertrag(await _trainerMitSignatur(appData.trainer[idx]));
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
    }, _trainerMitSignatur);
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
