// Hauptlogik: Trainer-Flow (Formular + Submit) und Admin-Flow (WebDAV, Liste, Detail, PDF).

// ─── State ───────────────────────────────────────────────────────────────────

let appData   = { version: 1, trainer: [] }; // Arbeitskopie im Admin-Modus
let davConfig = null;
let saveTid   = null;
let mode      = "trainer"; // "trainer" | "admin"
let activeAdminTab = "liste";
let currentTrainerId = null;

let trainerSigPad = null;

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
});

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

  document.getElementById("btn-trainer-neu").addEventListener("click", () => {
    document.getElementById("trainer-success-screen").style.display = "none";
    document.getElementById("trainer-form-screen").style.display = "";
    document.getElementById("trainer-form").reset();
    trainerSigPad.clear();
    _setTrainerError("");
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
    const resp = await fetch(SUBMIT_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    document.getElementById("trainer-form-screen").style.display = "none";
    document.getElementById("trainer-success-screen").style.display = "";
  } catch (err) {
    _setTrainerError("Übermittlung fehlgeschlagen: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Daten einreichen";
  }
}

function _setTrainerError(msg) {
  const el = document.getElementById("trainer-error");
  el.textContent = msg;
  el.classList.toggle("visible", !!msg);
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
    <div class="trainer-row" data-id="${t.id}">
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
    await davWriteFile(davConfig, appData);
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
  try {
    await davWriteFile(davConfig, appData);
  } catch (err) {
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
  if (idx !== -1) {
    appData.trainer[idx] = { ...appData.trainer[idx], ..._collectDetailData() };
  }
  const trainer = appData.trainer[idx];

  btn.disabled = true;
  btn.textContent = "Generiere PDF …";

  try {
    await generiereVertrag(trainer);

    // Status auf "generiert" setzen und speichern
    appData.trainer[idx].vertragsGeneriert = true;
    await davWriteFile(davConfig, appData);

    // Badge in Detailansicht aktualisieren
    document.getElementById("admin-detail-title").textContent =
      `${trainer.vorname} ${trainer.nachname}`;
  } catch (err) {
    document.getElementById("admin-detail-error").textContent = "PDF-Fehler: " + err.message;
    document.getElementById("admin-detail-error").classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "PDF Vertrag generieren";
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

// ─── Excel-Import ─────────────────────────────────────────────────────────────

let _importRows    = [];   // geparste Zeilen aus der Excel-Datei
let _importHeaders = [];   // Spaltennamen (erste Zeile)

function _initImport() {
  document.getElementById("import-file-input").addEventListener("change", _handleImportFile);
  document.getElementById("btn-import-start").addEventListener("click", _doImport);
  document.getElementById("btn-import-reset").addEventListener("click", _resetImport);
  document.getElementById("btn-import-nochmal").addEventListener("click", _resetImport);

  // Spalten-Dropdowns: bei Änderung Vorschau aktualisieren
  ["import-col-nachname","import-col-vorname","import-col-pauschale","import-col-lizenz"].forEach(id => {
    document.getElementById(id).addEventListener("change", _renderImportPreview);
  });
}

function _resetImport() {
  _importRows    = [];
  _importHeaders = [];
  document.getElementById("import-file-input").value = "";
  document.getElementById("import-step-1").style.display = "";
  document.getElementById("import-step-2").style.display = "none";
  document.getElementById("import-step-3").style.display = "none";
  document.getElementById("import-error").classList.remove("visible");
  document.getElementById("import-preview-wrap").innerHTML = "";
}

function _handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb    = XLSX.read(ev.target.result, { type: "array" });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const data  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!data.length) throw new Error("Leere Tabelle");

      _importHeaders = data[0].map(h => String(h));
      _importRows    = data.slice(1).filter(r => r.some(c => c !== ""));

      _populateColSelects();
      _renderImportPreview();
      document.getElementById("import-step-1").style.display = "none";
      document.getElementById("import-step-2").style.display = "";
      document.getElementById("import-error").classList.remove("visible");
    } catch (err) {
      document.getElementById("import-error").textContent = "Fehler beim Lesen: " + err.message;
      document.getElementById("import-error").classList.add("visible");
    }
  };
  reader.readAsArrayBuffer(file);
}

function _populateColSelects() {
  const optionsHtml = ["— nicht verwenden —", ..._importHeaders]
    .map((h, i) => `<option value="${i - 1}">${h}</option>`)
    .join("");

  ["import-col-nachname","import-col-vorname","import-col-pauschale","import-col-lizenz"].forEach(id => {
    document.getElementById(id).innerHTML = optionsHtml;
  });

  // Auto-Erkennung häufiger Spaltennamen
  const autoMap = {
    "import-col-nachname":  ["nachname","name","familienname","last name","lastname"],
    "import-col-vorname":   ["vorname","first name","firstname","rufname"],
    "import-col-pauschale": ["pauschale","betrag","betrag eur","honorar","verguetung","vergütung","euro"],
    "import-col-lizenz":    ["lizenz","trainerlizenz","license","licence"]
  };
  for (const [selId, keywords] of Object.entries(autoMap)) {
    const found = _importHeaders.findIndex(h =>
      keywords.some(k => h.toLowerCase().includes(k))
    );
    if (found >= 0) {
      document.getElementById(selId).value = String(found);
    }
  }
}

function _renderImportPreview() {
  const iNachname  = parseInt(document.getElementById("import-col-nachname").value);
  const iVorname   = parseInt(document.getElementById("import-col-vorname").value);
  const iPauschale = parseInt(document.getElementById("import-col-pauschale").value);
  const iLizenz    = parseInt(document.getElementById("import-col-lizenz").value);

  const preview = _importRows.slice(0, 6).map(row => {
    const nachname  = iNachname  >= 0 ? row[iNachname]  : "";
    const vorname   = iVorname   >= 0 ? row[iVorname]   : "";
    const pauschale = iPauschale >= 0 ? row[iPauschale] : "";
    const lizenz    = iLizenz    >= 0 ? row[iLizenz]    : "";
    const match     = appData.trainer.find(t =>
      t.nachname.toLowerCase() === String(nachname).trim().toLowerCase()
    );
    const status = match
      ? `<span class="badge generiert">Gefunden: ${_esc(match.vorname)} ${_esc(match.nachname)}</span>`
      : `<span class="badge offen">Nicht gefunden</span>`;
    return `<tr>
      <td style="padding:6px 10px;">${_esc(String(nachname))} ${_esc(String(vorname))}</td>
      <td style="padding:6px 10px;">${_esc(String(pauschale))}</td>
      <td style="padding:6px 10px;">${_esc(String(lizenz))}</td>
      <td style="padding:6px 10px;">${status}</td>
    </tr>`;
  }).join("");

  document.getElementById("import-preview-wrap").innerHTML = `
    <p class="muted" style="font-size:12px; margin-bottom:8px;">Vorschau (erste ${Math.min(6, _importRows.length)} von ${_importRows.length} Zeilen)</p>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead style="background:var(--gray);">
        <tr>
          <th style="padding:6px 10px; text-align:left;">Name</th>
          <th style="padding:6px 10px; text-align:left;">Pauschale</th>
          <th style="padding:6px 10px; text-align:left;">Lizenz</th>
          <th style="padding:6px 10px; text-align:left;">Zuordnung</th>
        </tr>
      </thead>
      <tbody>${preview}</tbody>
    </table>
  `;
}

async function _doImport() {
  const iNachname  = parseInt(document.getElementById("import-col-nachname").value);
  const iPauschale = parseInt(document.getElementById("import-col-pauschale").value);
  const iLizenz    = parseInt(document.getElementById("import-col-lizenz").value);

  if (iNachname < 0) {
    document.getElementById("import-error").textContent = "Bitte die Spalte für den Nachnamen auswählen.";
    document.getElementById("import-error").classList.add("visible");
    return;
  }

  let updated = 0, skipped = 0;

  for (const row of _importRows) {
    const nachname = String(row[iNachname] || "").trim().toLowerCase();
    if (!nachname) continue;

    const idx = appData.trainer.findIndex(t => t.nachname.toLowerCase() === nachname);
    if (idx === -1) { skipped++; continue; }

    if (iPauschale >= 0 && row[iPauschale] !== "") {
      appData.trainer[idx].pauschale = String(row[iPauschale]).trim();
    }
    if (iLizenz >= 0 && row[iLizenz] !== "") {
      appData.trainer[idx].lizenz = String(row[iLizenz]).trim();
    }
    updated++;
  }

  const btn = document.getElementById("btn-import-start");
  btn.disabled = true;
  btn.textContent = "Speichere …";
  try {
    await davWriteFile(davConfig, appData);
  } catch (err) {
    document.getElementById("import-error").textContent = "Speicherfehler: " + err.message;
    document.getElementById("import-error").classList.add("visible");
    btn.disabled = false;
    btn.textContent = "Import starten";
    return;
  }
  btn.disabled = false;
  btn.textContent = "Import starten";

  document.getElementById("import-step-2").style.display = "none";
  document.getElementById("import-step-3").style.display = "";
  document.getElementById("import-result").innerHTML = `
    <p style="color:var(--green); font-weight:700; font-size:15px; margin-bottom:8px;">
      Import abgeschlossen
    </p>
    <p class="muted"><strong>${updated}</strong> Trainer aktualisiert</p>
    ${skipped ? `<p class="muted"><strong>${skipped}</strong> Zeilen nicht zugeordnet (Nachname nicht gefunden)</p>` : ""}
  `;
}
