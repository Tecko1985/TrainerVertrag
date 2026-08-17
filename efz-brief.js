// Bestätigungsschreiben zur Vorlage bei der Meldebehörde (§ 30a BZRG), erzeugt im
// Browser mit pdf-lib (global `PDFLib`, im index.html ohnehin geladen).
//
// Warum hier und nicht im Worker: pdf-lib liegt im Client bereits vor (Vertrags-
// PDFs), im Worker wäre es eine neue, große Abhängigkeit. Der Worker liefert nur
// die Inhalte und ist die Schranke davor — ohne Freigabe bekommt der Client weder
// Stempelbild noch Absender, und ohne die kann diese Datei nichts bauen.
//
// Vorlage ist die Word-Datei EFZ.docx: gleicher Aufbau, gleiche Formulierungen.
// Wer den Wortlaut ändert, ändert eine Erklärung des Vereins gegenüber einer
// Behörde — nicht nebenbei umformulieren.
//
// ⚠️ Keine Anrede „Frau/Herr" wie in der Word-Vorlage: das Geschlecht steht in
// keinem Feld dieser App, und geraten wäre schlimmer als weggelassen. Der Satz
// funktioniert mit dem blossen Namen genauso.

const EFZ_SEITE_BREITE = 595.28;  // A4 in PDF-Punkten
const EFZ_SEITE_HOEHE  = 841.89;
const EFZ_RAND_LINKS   = 70;
const EFZ_RAND_RECHTS  = 70;

// StandardFonts sind WinAnsi-kodiert. Ein Zeichen ausserhalb davon lässt
// drawText werfen und damit den ganzen Brief scheitern — ein einziges aus einer
// Textverarbeitung kopiertes Sonderzeichen im Absender oder Einsatzbereich
// würde reichen. Deshalb werden die gängigen Fälle ersetzt und der Rest fällt
// weg, statt den Vorgang abzubrechen.
function _efzWinAnsi(text) {
  return String(text == null ? "" : text)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    // Übrig bleiben ASCII und Latin-1 — Umlaute, ß und § inbegriffen, also genau
    // das, was WinAnsi sicher darstellen kann.
    .replace(/[^\x20-\x7e¡-ÿ]/g, "");
}

// "2001-04-27" -> "27.04.2001". Bewusst regex-basiert und NICHT über new Date():
// ein reines Datum wird dort als UTC-Mitternacht gelesen und kann in der
// Ortszeit einen Tag zurückspringen (gleiche Falle wie fmtBirthdate in der
// Personalakte). Was nicht passt, geht unverändert durch.
function _efzDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "").trim();
}

function _efzHeuteDatum() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Ort für die Unterschriftszeile aus der letzten Absenderzeile ("37308 Heilbad
// Heiligenstadt" -> "Heilbad Heiligenstadt"). Ohne erkennbare PLZ bleibt die
// Zeile beim blossen Datum — ein geratener Ort wäre eine falsche Angabe auf
// einem Dokument, ein fehlender nur eine knappere Zeile.
function _efzOrtAusAbsender(absender) {
  const zeilen = String(absender || "").split("\n").map(z => z.trim()).filter(Boolean);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const m = /^\d{5}\s+(.+)$/.exec(zeilen[i]);
    if (m) return m[1].trim();
  }
  return "";
}

// Bricht Text auf die verfügbare Breite um. Ein einzelnes überlanges Wort wird
// NICHT getrennt, sondern läuft über — ein zerhacktes Wort im Namen des Vereins
// sähe schlechter aus als eine etwas zu lange Zeile.
function _efzUmbruch(text, font, groesse, maxBreite) {
  const zeilen = [];
  for (const absatz of String(text || "").split("\n")) {
    const worte = absatz.split(/\s+/).filter(Boolean);
    if (!worte.length) { zeilen.push(""); continue; }
    let aktuell = worte[0];
    for (let i = 1; i < worte.length; i++) {
      const versuch = aktuell + " " + worte[i];
      if (font.widthOfTextAtSize(versuch, groesse) <= maxBreite) {
        aktuell = versuch;
      } else {
        zeilen.push(aktuell);
        aktuell = worte[i];
      }
    }
    zeilen.push(aktuell);
  }
  return zeilen;
}

// Vereinslogo als PNG-Bytes. Das Original ist ein SVG, das pdf-lib nicht
// einbetten kann — es wird deshalb über ein Canvas gerastert.
//
// ⚠️ Der Umweg über eine data:-URL statt der Bild-URL direkt ist kein Umstand,
// sondern Absicht: ein fremdes Bild würde das Canvas sperren und toDataURL()
// werfen lassen. Live ist die Datei ohnehin gleichen Ursprungs, auf dem
// Entwicklungsserver nicht — dort fällt das Logo einfach weg.
async function _efzLogoPngBytes() {
  try {
    const resp = await fetch("https://sc1911heiligenstadt.github.io/logo.svg");
    if (!resp.ok) return null;
    const svgText = await resp.text();
    const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Logo nicht ladbar"));
      i.src = dataUrl;
    });
    const breite = 400;
    const hoehe = Math.max(1, Math.round(breite * (img.height || 1) / (img.width || 1)));
    const cv = document.createElement("canvas");
    cv.width = breite; cv.height = hoehe;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, breite, hoehe);
    const png = cv.toDataURL("image/png");
    const b64 = png.slice(png.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch (_) {
    return null;
  }
}

// daten: { person:{vorname,nachname,geburtsdatum,strasse,plz,ort}, absender,
//          einsatzbereich, stempelBase64, stempelContentType }
// -> Blob (application/pdf)
async function baueEfzBriefPdf(daten) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc  = await PDFDocument.create();
  const page = doc.addPage([EFZ_SEITE_BREITE, EFZ_SEITE_HOEHE]);
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const breite = EFZ_SEITE_BREITE - EFZ_RAND_LINKS - EFZ_RAND_RECHTS;
  const schwarz = rgb(0, 0, 0);
  let y = EFZ_SEITE_HOEHE - 60;

  const schreibe = (text, opts) => {
    const o = opts || {};
    const groesse = o.groesse || 11;
    const f = o.fett ? fontBold : font;
    const zeilen = _efzUmbruch(_efzWinAnsi(text), f, groesse, o.breite || breite);
    for (const z of zeilen) {
      page.drawText(z, { x: o.x || EFZ_RAND_LINKS, y, size: groesse, font: f, color: schwarz });
      y -= groesse * 1.35;
    }
  };
  const abstand = (pt) => { y -= pt; };

  // Logo oben rechts, sofern erreichbar. Der Brief steht auch ohne.
  const logoBytes = await _efzLogoPngBytes();
  if (logoBytes) {
    try {
      const logo = await doc.embedPng(logoBytes);
      const lb = 90;
      const lh = lb * (logo.height / logo.width);
      page.drawImage(logo, { x: EFZ_SEITE_BREITE - EFZ_RAND_RECHTS - lb, y: EFZ_SEITE_HOEHE - 40 - lh, width: lb, height: lh });
    } catch (_) { /* ohne Logo weiter */ }
  }

  // ⚠️ Deckel auf sechs Zeilen: der Absender ist freier Text aus den Einstellungen,
  // und jede Zeile schiebt den ganzen Brief nach unten. Ohne Grenze landete der
  // Schluss bei genug Zeilen unterhalb des Seitenrands — unsichtbar, ohne Fehler.
  const absenderZeilen = String(daten.absender || "")
    .split("\n").map(z => z.trim()).filter(Boolean).slice(0, 6);
  const vereinsname = absenderZeilen[0] || "unserem Verein";

  // Absenderblock
  for (const z of absenderZeilen) {
    page.drawText(_efzWinAnsi(z), { x: EFZ_RAND_LINKS, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
    y -= 12;
  }

  // Anschriftenfeld
  abstand(48);
  const p = daten.person || {};
  const empfaengerZeilen = [
    `${p.vorname || ""} ${p.nachname || ""}`.trim(),
    String(p.strasse || "").trim(),
    `${String(p.plz || "").trim()} ${String(p.ort || "").trim()}`.trim()
  ].filter(Boolean);
  for (const z of empfaengerZeilen) {
    page.drawText(_efzWinAnsi(z), { x: EFZ_RAND_LINKS, y, size: 11, font, color: schwarz });
    y -= 15;
  }

  // Betreff
  abstand(50);
  schreibe("Bestätigung zur Vorlage bei der Meldebehörde", { fett: true, groesse: 13 });
  abstand(2);
  schreibe("(Beantragung eines erweiterten Führungszeugnisses gemäß § 30a BZRG)", { groesse: 11 });

  abstand(24);
  schreibe(
    `Hiermit wird bestätigt, dass ${`${p.vorname || ""} ${p.nachname || ""}`.trim()}, geboren am ` +
    `${_efzDatum(p.geburtsdatum)}, für unseren Verein ${vereinsname} tätig ist bzw. eine solche ` +
    `Tätigkeit aufnehmen soll.`
  );

  abstand(14);
  schreibe("Die Person wird in folgendem Bereich eingesetzt:");
  abstand(4);
  schreibe(String(daten.einsatzbereich || ""), { fett: true });

  abstand(14);
  schreibe(
    "Im Rahmen dieser Tätigkeit nimmt die oben genannte Person Aufgaben wahr, die eine " +
    "Beaufsichtigung, Betreuung, Erziehung oder Ausbildung Minderjähriger beinhalten oder bei " +
    "denen ein vergleichbarer intensiver Kontakt zu Minderjährigen besteht."
  );

  abstand(14);
  schreibe(
    "Die Voraussetzungen des § 30a Abs. 1 Nr. 2 BZRG (Bundeszentralregistergesetz) für die " +
    "Erteilung eines erweiterten Führungszeugnisses liegen somit vor."
  );

  abstand(14);
  schreibe(
    "Es wird zudem bestätigt, dass die Tätigkeit ehrenamtlich ausgeübt wird. Wir bitten daher " +
    "darum, die Gebühr für das Führungszeugnis gemäß den Richtlinien des Bundesamtes für Justiz " +
    "zu erlassen."
  );

  abstand(26);
  schreibe("Mit freundlichen Grüßen");

  // Stempel mit Unterschrift. Der Worker liefert ihn nur an Freigegebene, und
  // ohne ihn kommt der Brief gar nicht erst zustande (409 dort) — hier ist er
  // deshalb keine Option, sondern der Abschluss des Dokuments.
  abstand(16);
  const stempelBytes = _efzBase64ZuBytes(daten.stempelBase64 || "");
  if (stempelBytes) {
    const ctype = String(daten.stempelContentType || "").toLowerCase();
    const bild = ctype.includes("jpeg") || ctype.includes("jpg")
      ? await doc.embedJpg(stempelBytes)
      : await doc.embedPng(stempelBytes);
    const maxB = 200, maxH = 90;
    let sb = bild.width, sh = bild.height;
    const faktor = Math.min(maxB / sb, maxH / sh, 1);
    sb *= faktor; sh *= faktor;
    y -= sh;
    page.drawImage(bild, { x: EFZ_RAND_LINKS, y, width: sb, height: sh });
  }

  abstand(10);
  const ort = _efzOrtAusAbsender(daten.absender);
  page.drawText(_efzWinAnsi("_".repeat(48)), { x: EFZ_RAND_LINKS, y, size: 11, font, color: schwarz });
  y -= 14;
  schreibe(
    (ort ? ort + ", " : "") + _efzHeuteDatum() + " — Unterschrift des Vorstands & Vereinsstempel",
    { groesse: 9 }
  );

  const bytes = await doc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

function _efzBase64ZuBytes(b64) {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.length ? bytes : null;
  } catch (_) {
    return null;
  }
}
