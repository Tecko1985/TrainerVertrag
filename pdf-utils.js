// PDF-Generierung mit pdf-lib (als globales `PDFLib` über CDN geladen).
//
// Strategie:
//   1. Versuche, vertrag-template.pdf zu laden.
//   2. Falls vorhanden: Text an Koordinaten aus PDF_FIELDS (config.js) einsetzen.
//      → Koordinaten müssen nach Kalibrierung mit dem echten Template in
//        config.js angepasst werden (aktuell Platzhalter-Werte).
//   3. Falls kein Template: strukturiertes Fallback-PDF aus pdf-lib erstellen.
// Die Trainer-Unterschrift wird in beiden Pfaden als PNG-Bild eingebettet.

async function _buildPdfBlob(trainer) {
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

async function generiereAlleVertraegeZip(trainerList, onProgress) {
  if (typeof JSZip === "undefined") throw new Error("JSZip nicht geladen.");
  const zip = new JSZip();
  let done = 0;
  for (const t of trainerList) {
    const blob = await _buildPdfBlob(t);
    zip.file(`${t.nachname}_${t.vorname}_Vertrag.pdf`, blob);
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
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip nicht geladen – bitte Seite neu laden.");
  }

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
  };

  const resp = await fetch("vertrag-template.docx");
  if (!resp.ok) throw new Error(`vertrag-template.docx nicht gefunden (HTTP ${resp.status})`);
  const templateBytes = await resp.arrayBuffer();

  const zip = await JSZip.loadAsync(templateBytes);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("Ungültiges Template: word/document.xml fehlt");

  let xml = await xmlFile.async("string");
  for (const [ph, val] of Object.entries(ersatz)) {
    xml = xml.split(ph).join(_escXml(val));
  }
  zip.file("word/document.xml", xml);

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

function _escXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
