// PDF-Generierung mit pdf-lib (als globales `PDFLib` über CDN geladen).
//
// Strategie:
//   1. Versuche, vertrag-template.pdf zu laden.
//   2. Falls vorhanden: Text an Koordinaten aus PDF_FIELDS (config.js) einsetzen.
//      → Koordinaten müssen nach Kalibrierung mit dem echten Template in
//        config.js angepasst werden (aktuell Platzhalter-Werte).
//   3. Falls kein Template: strukturiertes Fallback-PDF aus pdf-lib erstellen.
// Die Trainer-Unterschrift wird in beiden Pfaden als PNG-Bild eingebettet.

// ---------------------------------------------------------------------------
// pdf-lib (202 KB) und JSZip (28 KB) hängen bewusst NICHT fest im <head>: zusammen
// waren sie 230 KB bei JEDEM Seitenaufbau — auch für den Trainer, der nur seine
// Telefonnummer ändert. Gebraucht werden sie ausschließlich beim Erzeugen einer
// Datei (Vertrag, ZIP, signiertes PDF, Führerschein-Sammelexport).
//
// Erster Bedarf lädt nach, jeder weitere Aufruf bekommt dieselbe Promise. Gleiche
// Bauform wie ladeJsZip in raumnutzung/app.js und ladeBibliothek in
// vereinsverwaltung/db.js.
//
// ⚠️ Beide Funktionen sind global (klassisches Script, kein Modul) — app.js ruft
// sie an seinen eigenen vier Stellen ebenfalls auf.
const _bibliotheken = {};
function _ladeBibliothek(name, url, globalName) {
  if (typeof window[globalName] !== "undefined") return Promise.resolve();
  if (_bibliotheken[url]) return _bibliotheken[url];
  _bibliotheken[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => {
      if (typeof window[globalName] === "undefined") {
        delete _bibliotheken[url];
        reject(new Error(name + " geladen, aber nicht nutzbar — bitte Seite neu laden."));
        return;
      }
      resolve();
    };
    s.onerror = () => {
      delete _bibliotheken[url]; // nächster Versuch darf es erneut probieren
      reject(new Error(name + " konnte nicht geladen werden (Internetverbindung nötig)."));
    };
    document.head.appendChild(s);
  });
  return _bibliotheken[url];
}

function ladePdfLib() {
  return _ladeBibliothek("PDF-Bibliothek", "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "PDFLib");
}

function ladeJsZip() {
  return _ladeBibliothek("ZIP-Bibliothek", "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");
}

async function _buildPdfBlob(trainer) {
  await ladePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  let pdfDoc;
  let useTemplate = false;

  try {
    const resp = await fetch("vertrag-template.pdf");
    if (resp.ok && resp.headers.get("Content-Type")?.includes("pdf")) {
      const bytes = await resp.arrayBuffer();
      pdfDoc = await PDFDocument.load(bytes);
      useTemplate = true;
    }
  } catch (_) {}

  if (useTemplate) {
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    await _fillTemplate(pdfDoc, trainer, font, fontBold, rgb);
  } else {
    pdfDoc = await _buildFallbackPdf(null, trainer, rgb, PDFDocument, StandardFonts);
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function generiereVertrag(trainer) {
  const blob = await _buildPdfBlob(trainer);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${trainer.nachname}_${trainer.vorname}_Vertrag.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

// prepareTrainer (optional) darf pro Trainer eine angereicherte Kopie liefern -- der
// Admin haengt darueber die ausgelagerte Unterschrift an, ohne dass pdf-utils.js den
// WebDAV-Weg kennen muss. Ohne den Hook wird die Liste unveraendert verarbeitet.
async function generiereAlleVertraegeZip(trainerList, onProgress, prepareTrainer) {
  // Beide parallel: dieser Weg erzeugt PDFs UND packt sie in ein Archiv.
  await Promise.all([ladePdfLib(), ladeJsZip()]);
  const zip = new JSZip();
  let done = 0;
  const usedNames = new Set();
  for (const t0 of trainerList) {
    const t = prepareTrainer ? await prepareTrainer(t0) : t0;
    const blob = await _buildPdfBlob(t);
    // Namensgleiche Trainer würden sich sonst im ZIP gegenseitig überschreiben.
    let name = `${t.nachname}_${t.vorname}_Vertrag.pdf`;
    let i = 2;
    while (usedNames.has(name)) name = `${t.nachname}_${t.vorname}_Vertrag_${i++}.pdf`;
    usedNames.add(name);
    zip.file(name, blob);
    done++;
    if (onProgress) onProgress(done, trainerList.length);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = "Trainervertraege_PDFs.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// Fertig unterschriebenes Vertrags-PDF bauen (seit 1.10): lädt das vom Skript
// generate-pdfs.ps1 bereitgestellte Original-Vertrags-PDF (Bytes), stempelt die
// Signatur zusätzlich direkt auf die beiden echten Unterschriftslinien des Vertrags
// (VERTRAG_SIGNATURE_STELLEN in config.js, seit 1.14) und hängt danach weiterhin EINE
// Unterschriftenseite an (Name, Datum, Signaturbild, Bestätigungstext) -- die dient
// als eindeutiger Audit-Nachweis (Wer/Was/Wann), unabhängig von den beiden Stellen im
// Fließtext, die selbst kein Datum tragen.
// Gibt ein Uint8Array zurück (Aufrufer verpackt es in einen application/pdf-Blob).
async function buildSignedVertragPdf(originalBytes, opts) {
  await ladePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(originalBytes);
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark  = rgb(0.12, 0.14, 0.19);
  const muted = rgb(0.42, 0.45, 0.5);

  // Signaturbild einmal einbetten -- wird fuer die kalibrierten Stellen im Original
  // UND fuer die angehaengte Bestaetigungsseite weiterverwendet.
  let signaturePng = null;
  try {
    signaturePng = await doc.embedPng(_dataUrlToUint8(opts.signaturePngDataUrl));
  } catch (_) {}

  if (signaturePng) {
    const pages = doc.getPages();
    for (const stelle of VERTRAG_SIGNATURE_STELLEN) {
      const zielSeite = pages[stelle.seite];
      if (!zielSeite) continue; // Vertrag hat unerwartet weniger Seiten -> Stelle ueberspringen statt Fehler
      const scale = Math.min(stelle.maxBreite / signaturePng.width, stelle.maxHoehe / signaturePng.height, 1);
      const w = signaturePng.width * scale, h = signaturePng.height * scale;
      zielSeite.drawImage(signaturePng, { x: stelle.xMitte - w / 2, y: stelle.yUnten, width: w, height: h });
    }
  }

  const [pw, ph] = [595.28, 841.89]; // A4, wie das Vertragstemplate
  const page = doc.addPage([pw, ph]);
  const marginX = 60;
  let y = ph - 90;

  page.drawText("Unterschrift zum Trainervertrag", { x: marginX, y, size: 18, font: fontBold, color: dark });
  y -= 40;

  const line = (label, value) => {
    page.drawText(label, { x: marginX, y, size: 11, font: fontBold, color: muted });
    page.drawText(String(value || ""), { x: marginX + 140, y, size: 11, font, color: dark });
    y -= 22;
  };
  line("Name:", opts.name || "");
  line("Unterschrieben am:", opts.dateStr || "");
  y -= 16;

  page.drawText("Mit meiner Unterschrift bestaetige ich den vorstehenden Trainervertrag.",
    { x: marginX, y, size: 11, font, color: dark });
  y -= 48;

  page.drawText("Unterschrift:", { x: marginX, y, size: 11, font: fontBold, color: muted });
  y -= 12;

  // Signaturbild: feste Maximalhöhe, Breite proportional.
  let lineWidth = 200;
  if (signaturePng) {
    const maxW = 260, maxH = 90;
    const scale = Math.min(maxW / signaturePng.width, maxH / signaturePng.height, 1);
    const w = signaturePng.width * scale, h = signaturePng.height * scale;
    page.drawImage(signaturePng, { x: marginX, y: y - h, width: w, height: h });
    y -= h;
    lineWidth = Math.max(w, 200);
  } else {
    y -= 60; // ohne gültiges Bild trotzdem Platz für die Linie lassen
  }
  page.drawLine({ start: { x: marginX, y: y - 6 }, end: { x: marginX + lineWidth, y: y - 6 }, thickness: 0.75, color: muted });

  return doc.save();
}

// PNG-DataURL -> Uint8Array für pdf-lib embedPng (akzeptiert Wert mit/ohne data:-Präfix).
function _dataUrlToUint8(dataUrl) {
  const s = String(dataUrl || "");
  const comma = s.indexOf(",");
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function _fillTemplate(pdfDoc, trainer, font, fontBold, rgb) {
  const pages = pdfDoc.getPages();
  const page  = pages[0];
  const black = rgb(0, 0, 0);

  function write(key, text) {
    const f = PDF_FIELDS[key];
    if (!f || !text) return;
    page.drawText(String(text), { x: f.x, y: f.y, size: f.size || 11, font, color: black });
  }

  write("vorname",      trainer.vorname);
  write("nachname",     trainer.nachname);
  write("geburtsdatum", trainer.geburtsdatum ? _fmt(trainer.geburtsdatum) : "");
  write("strasse",      trainer.strasse);
  write("plz_ort",      `${trainer.plz} ${trainer.ort}`.trim());
  write("telefon",      trainer.telefon);
  write("email",        trainer.email);
  write("iban",         _ibanFmt(trainer.iban));
  write("bankname",     trainer.bankname);
  write("bic",          trainer.bic);
  write("datum",        _fmt(new Date().toISOString().slice(0, 10)));

  await _embedSignature(pdfDoc, page, trainer, PDF_FIELDS.signature);
}

async function _buildFallbackPdf(pdfDoc, trainer, rgb, PDFDocument, StandardFonts) {
  pdfDoc = pdfDoc || await PDFDocument.create();
  const page   = pdfDoc.addPage([595.28, 841.89]); // A4
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const blue  = rgb(0.10, 0.34, 0.63);
  const black = rgb(0, 0, 0);
  const gray  = rgb(0.43, 0.44, 0.50);

  let y = height - 50;

  // Titel
  page.drawText("TRAINERVERTRAG", { x: 60, y, size: 18, font: fontBold, color: blue });
  y -= 10;
  page.drawLine({ start: { x: 60, y }, end: { x: width - 60, y }, thickness: 2, color: blue });
  y -= 28;

  // Hinweis, dass kein Template geladen wurde
  page.drawText("(Vorschau ohne Template — Feldkoordinaten in config.js kalibrieren)", {
    x: 60, y, size: 8, font, color: gray
  });
  y -= 26;

  function section(title) {
    page.drawText(title.toUpperCase(), { x: 60, y, size: 9, font: fontBold, color: blue });
    y -= 6;
    page.drawLine({ start: { x: 60, y }, end: { x: width - 60, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 16;
  }

  function row(label, value) {
    if (!value) return;
    page.drawText(label, { x: 60, y, size: 10, font: fontBold, color: gray });
    page.drawText(String(value), { x: 200, y, size: 10, font, color: black });
    y -= 18;
  }

  section("Persönliche Daten");
  row("Vorname",      trainer.vorname);
  row("Nachname",     trainer.nachname);
  row("Geburtsdatum", trainer.geburtsdatum ? _fmt(trainer.geburtsdatum) : "");
  row("Straße",       trainer.strasse);
  row("PLZ / Ort",    `${trainer.plz} ${trainer.ort}`.trim());
  row("Telefon",      trainer.telefon);
  row("E-Mail",       trainer.email);

  y -= 8;
  section("Bankverbindung");
  row("IBAN",     _ibanFmt(trainer.iban));
  row("Bank",     trainer.bankname);
  row("BIC",      trainer.bic);

  y -= 16;
  page.drawLine({ start: { x: 60, y }, end: { x: width - 60, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 30;

  // Unterschrift
  const sigField = { x: 60, y: y - 60, width: 200, height: 60 };
  const sigPlaced = await _embedSignature(pdfDoc, page, trainer, sigField);
  if (sigPlaced) {
    y -= 70;
    page.drawLine({ start: { x: 60, y }, end: { x: 265, y }, thickness: 0.5, color: black });
    y -= 14;
    page.drawText(`${trainer.vorname} ${trainer.nachname}`, { x: 60, y, size: 9, font, color: gray });
    y -= 14;
    page.drawText("Datum: " + _fmt(new Date().toISOString().slice(0, 10)), { x: 60, y, size: 9, font, color: gray });
  }

  return pdfDoc;
}

async function _embedSignature(pdfDoc, page, trainer, field) {
  if (!trainer.signatureDataUrl || !/^data:image\/png;base64,/.test(trainer.signatureDataUrl)) {
    return false;
  }
  try {
    const base64  = trainer.signatureDataUrl.split(",")[1];
    const sigBytes = _b64ToUint8(base64);
    const sigImg   = await pdfDoc.embedPng(sigBytes);
    page.drawImage(sigImg, { x: field.x, y: field.y, width: field.width, height: field.height });
    return true;
  } catch (_) { return false; }
}

function _fmt(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function _ibanFmt(iban) {
  if (!iban) return "";
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

function _b64ToUint8(b64) {
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// DOCX-Generierung via JSZip: lädt vertrag-template.docx, ersetzt {{PLATZHALTER}} in
// word/document.xml und bietet die gefüllte Datei als Download an.
async function generiereVertragDocx(trainer) {
  await ladeJsZip();

  const heute = new Date();
  const dd   = String(heute.getDate()).padStart(2, "0");
  const mm   = String(heute.getMonth() + 1).padStart(2, "0");
  const yyyy = heute.getFullYear();

  const ersatz = {
    "{{VORNAME}}":   trainer.vorname   || "",
    "{{NACHNAME}}":  trainer.nachname  || "",
    "{{LIZENZ}}":    trainer.lizenz    || "",
    "{{PAUSCHALE}}": trainer.pauschale || "",
    "{{IBAN}}":      _ibanFmt(trainer.iban),
    "{{BANKNAME}}":  trainer.bankname  || "",
    "{{BIC}}":       trainer.bic       || "",
    "{{DATUM}}":     `${dd}.${mm}.${yyyy}`,
    "{{JAHR}}":      String(yyyy),
    ..._nebentaetigkeitPlatzhalter(trainer),
  };

  const resp = await fetch("vertrag-template.docx");
  if (!resp.ok) throw new Error(`vertrag-template.docx nicht gefunden (HTTP ${resp.status})`);
  const templateBytes = await resp.arrayBuffer();

  const zip = await JSZip.loadAsync(templateBytes);
  // Manche Tools speichern ZIP-Einträge mit "\" statt "/" (siehe generate-pdfs.ps1-Gotcha) —
  // exakten Namen zuerst versuchen, sonst slash-robust suchen.
  let xmlFile = zip.file("word/document.xml");
  let xmlEntryName = "word/document.xml";
  if (!xmlFile) {
    const hit = Object.keys(zip.files).find(name => name.replace(/\\/g, "/") === "word/document.xml");
    if (hit) { xmlFile = zip.file(hit); xmlEntryName = hit; }
  }
  if (!xmlFile) throw new Error("Ungültiges Template: word/document.xml fehlt");

  let xml = await xmlFile.async("string");
  for (const [ph, val] of Object.entries(ersatz)) {
    xml = xml.split(ph).join(_escXml(val));
  }
  zip.file(xmlEntryName, xml);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `Trainervertrag_${trainer.nachname}_${trainer.vorname}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Anlage 1 (§ 3 Nr. 26 EStG): welche der beiden Ankreuz-Boxen im Template markiert
// wird ({{CHECK_KEINE}}/{{CHECK_ANDERE}}, je 5 Zeichen breit wie die unbefüllte Box
// im Original, damit sich am Layout nichts verschiebt) + der Betrags-Blank bei
// "andere Einnahmen". Fehlt die Erklärung (alte/unvollständige Datensätze), bleiben
// beide Boxen bewusst leer statt zu raten — spiegelt sich 1:1 in generate-pdfs.ps1
// (Build-Replacements), da dort kein gemeinsames JS-Modul eingebunden werden kann.
function _nebentaetigkeitPlatzhalter(trainer) {
  const gewaehlt = trainer.nebentaetigkeit;
  return {
    "{{CHECK_KEINE}}":  gewaehlt === "keine"  ? "  X  " : "     ",
    "{{CHECK_ANDERE}}": gewaehlt === "andere" ? "  X  " : "     ",
    "{{NEBENTAETIGKEIT_BETRAG}}": (gewaehlt === "andere" && trainer.nebentaetigkeitBetrag)
      ? `${trainer.nebentaetigkeitBetrag} EUR`
      : "",
  };
}

function _escXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
