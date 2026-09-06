const APP_VERSION = "1.0";

// WebDAV-Pfad für Admin-Zugriff (vorausgefüllt, App-Passwort wird nicht gespeichert)
const WEBDAV_DEFAULT_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/Trainerdaten/trainerdaten.json";
const WEBDAV_DEFAULT_USERNAME = "admin";
const CORS_PROXY_DEFAULT_URL = "https://trainerdaten.michel-brunner.workers.dev";

// Read-only-Quelle für den Lizenz/Pauschale-Sync im Import-Tab: gleiche
// Nextcloud-Freigabe/Account wie oben, daher mit denselben Admin-WebDAV-
// Credentials + demselben CORS-Proxy lesbar (siehe cors-proxy-worker.js,
// prüft nur das Freigabe-Präfix, nicht den Dateinamen). Kanonischer Pfad
// steht in DAV_APPS["personalkosten"] in E:\ToolsUebersicht\admin-worker.js —
// dort nachsehen, falls die Datei mal verschoben wird.
const PERSONALKOSTEN_WEBDAV_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/Personalkosten/personalkosten.json";

// Read-only-Quelle für den TrainerCheckliste-Status im Admin-Detail (Phase 3,
// siehe CLAUDE.md) — gleiche Technik wie PERSONALKOSTEN_WEBDAV_URL oben, gleiche
// Nextcloud-Freigabe/Account, gleicher CORS-Proxy. Achtung Namensfalle: Ordner/
// Datei heißen "TrainerCheckin"/"trainercheckin.json", NICHT "TrainerCheckliste"
// (siehe DAV_APPS["trainercheckliste"] in admin-worker.js).
const TRAINERCHECKLISTE_WEBDAV_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/TrainerCheckin/trainercheckin.json";

// Trainer-Einreichung (Login über das ToolsUebersicht-Konto): POST an diesen
// Cloudflare-Worker-Endpunkt. Der Worker hält die Nextcloud-Zugangsdaten als
// Worker-Secrets (nie im Code) und verifiziert den Login-Token serverseitig.
const SUBMIT_WORKER_URL = "https://trainerdaten1.michel-brunner.workers.dev";

// Führerschein-Kopie: nach der ersten Einreichung alle 6 Monate erneut einzureichen
// (1:1 aus dem migrierten Fahrtenbuch-Feature übernommen, siehe [[project-trainerdaten]]).
const FUEHRERSCHEIN_GUELTIGKEIT_MONATE = 6;

// Trainerkodex: nach der letzten Bestätigung alle 6 Monate erneut zu bestätigen
// (gleiche Frist/Berechnung wie beim Führerschein, unabhängig davon gewählt).
const KODEX_GUELTIGKEIT_MONATE = 6;

// Jugendschutzkonzept: gleiche 6-Monats-Frist wie beim Trainerkodex, unabhängig
// davon berechnet (eigenständiges Dokument, eigene Bestätigung).
const JUGENDSCHUTZKONZEPT_GUELTIGKEIT_MONATE = 6;

// Gruppe, deren Mitglieder (plus Admin) alle eingereichten Führerschein-Kopien im
// Register einsehen dürfen — dieselbe Gruppe, die vorher im Fahrtenbuch galt.
const FS_VIEW_GROUP_ID = "fuehrerschein-einsicht";

// Größenlimit pro hochgeladener Datei (Führerschein/Führungszeugnis) — muss zum
// Worker-Cap DOC_MAX_FILE_BYTES in submit-worker.js passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Auswahlwerte für das Lizenzart-Dropdown im Trainerlizenz-Dokumentenbereich (nicht
// zu verwechseln mit dem bestehenden Freitext-Feld "Lizenz" für den Vertrag/
// {{LIZENZ}}-Platzhalter, siehe CLAUDE.md). Einzige Quelle für beide <select>-Felder
// (Trainer-Selbstbedienung + Admin-Detail), von _populateLizenzArtSelect() in app.js
// befüllt.
const TRAINERLIZENZ_ARTEN = [
  "C-Lizenz",
  "B-Lizenz",
  "A-Lizenz",
  "DFB-Basis-Lizenz",
  "DFB-Elite-Jugend-Lizenz",
  "Fußball-Lehrer-Lizenz (Pro-Lizenz)",
  "Torwarttrainer-Lizenz",
  "Sonstige"
];

// Konfigurierbarer CSV-Export in der Admin-Liste (siehe _initExportPanel/
// _handleExportCsv in app.js): jedes Feld einzeln per Checkbox an-/abwählbar,
// gruppiert wie das Trainer-Formular. "type" steuert nur die Formatierung des
// Zellwerts (_exportFieldValue in app.js) — ohne "type" wird der Rohwert
// unverändert exportiert. Bewusst ohne interne Felder (id, Dateipfade,
// Content-Types, Signatur-Bilddaten) — kein sinnvoller Tabellenwert.
const EXPORT_FIELD_GROUPS = [
  {
    title: "Stammdaten",
    fields: [
      { key: "vorname", label: "Vorname" },
      { key: "nachname", label: "Nachname" },
      { key: "geburtsdatum", label: "Geburtsdatum", type: "dateonly" },
      { key: "strasse", label: "Straße" },
      { key: "plz", label: "PLZ" },
      { key: "ort", label: "Ort" },
      { key: "telefon", label: "Telefon" },
      { key: "email", label: "E-Mail" },
      { key: "gruppen", label: "Gruppen", type: "derived-gruppen" },
      { key: "mannschaften", label: "Mannschaft(en)", type: "derived-mannschaften" }
    ]
  },
  {
    title: "Bankverbindung",
    fields: [
      { key: "iban", label: "IBAN", type: "iban" },
      { key: "bankname", label: "Bankname" },
      { key: "bic", label: "BIC" }
    ]
  },
  {
    title: "Vertrag & Status",
    fields: [
      { key: "lizenz", label: "Lizenz" },
      { key: "pauschale", label: "Pauschale (EUR)" },
      { key: "nebentaetigkeit", label: "Nebentätigkeit", type: "nebentaetigkeit" },
      { key: "nebentaetigkeitBetrag", label: "Nebentätigkeit Betrag (EUR)" },
      { key: "status", label: "Status", type: "status" },
      { key: "eingereichtAm", label: "Eingereicht am", type: "derived-eingereicht" },
      { key: "vertragPdfBereitgestelltAm", label: "Vertrag bereitgestellt am", type: "date" },
      { key: "vertragUnterschriebenAm", label: "Vertrag unterschrieben am", type: "date" }
    ]
  },
  {
    title: "Dokumente",
    fields: [
      { key: "trainerlizenzArt", label: "Trainerlizenz-Art" },
      { key: "trainerlizenzGueltigBis", label: "Trainerlizenz gültig bis", type: "dateonly" },
      { key: "trainerlizenzNichtVorhanden", label: "Keine Trainerlizenz vorhanden", type: "bool" },
      { key: "trainerlizenzHochgeladenAm", label: "Trainerlizenz hochgeladen am", type: "date" },
      { key: "fuehrerscheinHochgeladenAm", label: "Führerschein hochgeladen am", type: "date" },
      { key: "fuehrungszeugnisEingereichtAm", label: "Führungszeugnis eingereicht am", type: "date" }
    ]
  }
];

// ─── Ortsgruppen für den Wohnort-Filter des CSV-Exports ───────────────────
// Ein Ortsteil zählt zu seiner Gemeinde: ein Haken auf "Heilbad Heiligenstadt"
// nimmt Kalteneber und Rengelrode mit. Anlass ist dieselbe Frage wie in der
// Dokumentenvorlagen-App — wer nicht hier gemeldet ist, muss das erweiterte
// Führungszeugnis beim eigenen Meldeamt beantragen.
// ⚠️ Wortgleich mit ORT_GRUPPEN in E:\dokumentenvorlagen\config.js. Wird dort
// ein Ortsteil ergänzt, gehört er auch hierher — sonst filtern die beiden Apps
// bei identischer Datenlage unterschiedlich.
const ORT_GRUPPEN = [
  {
    name: "Heilbad Heiligenstadt",
    orte: [
      "Heilbad Heiligenstadt", "Heiligenstadt",
      "Bernterode", "Bischhagen", "Flinsberg", "Glasehausen", "Günterode",
      "Kalteneber", "Mengelrode", "Rengelrode", "Siemerode", "Streitholz"
    ]
  }
];

// ─── Bank-Export (Überweisungsliste für die Bank) ─────────────────────────────
// Zweiter, vom konfigurierbaren CSV-Export getrennter Export: erzeugt aus den
// Trainern der aktuellen Liste eine Zahlungsdatei (Empfänger + IBAN + BIC +
// Pauschale als Betrag) in vier Formaten, siehe _initBankExportPanel in app.js.
//
// Die folgende Spaltenliste ist die Grundlage von dreien davon: CSV, Excel-Mappe
// und Vorlagen-XML zeigen dieselbe Tabelle in unterschiedlicher Verpackung.
//
// 1) CSV: exakt die Spalten der Vorlage-Datei der Bank ("Vorlage_IBAN.csv") —
//    Reihenfolge und Schreibweise sind vom Banktool vorgegeben und dürfen NICHT
//    umsortiert/umbenannt werden, sonst weist der Import die Datei ab. Pflicht
//    laut Vorlage sind nur Empfänger, IBAN des Empfängers, BIC und Betrag; die
//    übrigen Spalten müssen zwar vorhanden, dürfen aber leer sein.
// 2) Excel-Mappe (.xlsx) nach der Muster-Datei des Bankers: dieselben Spalten
//    auf einem Blatt namens "in", Betrag als echte Zahl. Siehe
//    _buildVorlagenXlsx in app.js.
// 3) XML im Aufbau der Vorlage — dieselben Spalten als XML-Elemente. Kein
//    standardisiertes Zahlungsformat, sondern ein Muster zum Abstimmen.
// 4) SEPA-XML nach pain.001.001.03 (Sammelüberweisung) — braucht zusätzlich
//    Auftraggeber (Name/IBAN) und ein Ausführungsdatum, die es im Trainer-
//    Datensatz nicht gibt und die deshalb im Panel eingegeben werden.
const BANK_EXPORT_CSV_SPALTEN = [
  "IBAN des Auftraggebers",
  "Vorlagenbezeichnung",
  "Empfänger",
  "IBAN des Empfängers",
  "BIC",
  "Kreditinstitut",
  "Betrag",
  "Verwendungszweck",
  "Kundenreferenz",
  "Verwendungsschlüssel",
  "Bezeichnung des Verwendungsschlüssels",
  "Abweichender Auftraggeber"
];

// Der SEPA-Zeichensatz kennt keine Umlaute. Ein Umlaut im Empfängernamen führt
// zur Abweisung der ganzen Datei durch die Bank, deshalb werden sie hier lesbar
// transliteriert (Hünermund -> Huenermund) statt gelöscht. Alles, was danach
// immer noch außerhalb des erlaubten Zeichensatzes liegt, ersetzt _sepaText()
// in app.js pauschal durch ein Leerzeichen — diese Map ist also nur die
// lesbarkeitserhaltende Vorstufe, nicht die Absicherung.
// ACHTUNG beim Bearbeiten dieser Map: die typografischen Anführungszeichen sind
// hier Objektschlüssel. Wird eines davon versehentlich zu einem geraden " , ist
// die Datei ein lautloser SyntaxError und die ganze App startet nicht mehr —
// nach jeder Änderung hier `node --check config.js` laufen lassen.
const SEPA_UMLAUT_MAP = {
  "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss",
  "á": "a", "à": "a", "â": "a", "é": "e", "è": "e", "ê": "e", "í": "i", "ì": "i",
  "ó": "o", "ò": "o", "ô": "o", "ú": "u", "ù": "u", "û": "u", "ç": "c", "ñ": "n",
  "&": "+",
  "„": "'", "“": "'", "”": "'", "‘": "'", "’": "'",
  "–": "-", "—": "-", "…": "."
};

// Längenbegrenzungen aus dem SEPA-Regelwerk (pain.001) — längere Werte werden
// beim Export gekürzt statt die Datei ungültig zu machen.
const SEPA_MAX_NAME = 70;
const SEPA_MAX_VERWENDUNGSZWECK = 140;

// Zulässige Form eines BIC, wortgleich mit der Restriktion "BICIdentifier" aus
// dem Schema pain.001.001.03: sechs Buchstaben (Bank + Land), dann eine Stelle
// ohne 0/1 und eine ohne O, optional drei Zeichen für die Filiale. Also genau
// 8 oder 11 Zeichen — nichts dazwischen, keine Leerzeichen, keine Umlaute.
// ⚠️ Ein BIC, der hier durchfällt, darf NICHT in die Datei: das Bankprogramm
// prüft gegen dasselbe Muster und weist die ganze Sammelüberweisung ab
// (Fehler 0390, siehe Changelog 1.21). Die IBAN wurde immer geprüft, der BIC
// bis 1.22 nicht — ein Tippfehler reichte für eine unbrauchbare Datei.
const SEPA_BIC_MUSTER = /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/;

// ⚠️ Das Muster allein reicht nicht: "NOTPROVIDED" besteht es zufällig
// (NOTPRO + V + I + DED ist eine formal gültige 11-stellige BIC-Form). Genau
// dieser Wert war es aber, den das VR-Banking mit 0390 abwies — er stand bis
// 1.21 als Platzhalter in der erzeugten Datei. Landet er über einen Import
// oder von Hand in einem BIC-Feld, ginge er hier ungeprüft wieder durch.
// Deshalb prüft alles, was einen BIC annimmt, über diese Funktion statt
// direkt über das Muster.
const SEPA_BIC_PLATZHALTER = ["NOTPROVIDED"];

// ⚠️ Bewusst OHNE trim/toUpperCase: die Funktion soll genau so streng bleiben
// wie das Muster allein, damit sich am bisherigen Verhalten nichts ausser dem
// Platzhalter aendert. Wer einen rohen Wert prueft, normiert ihn vorher selbst
// (so macht es bicOderLeer im XML-Weg).
function sepaBicGueltig(bic) {
  const b = String(bic == null ? "" : bic);
  if (!SEPA_BIC_MUSTER.test(b)) return false;
  return SEPA_BIC_PLATZHALTER.indexOf(b) === -1;
}

// Kennung, mit der jede von uns erzeugte SEPA-Datei ihre MsgId und ihre
// EndToEndIds beginnt (_buildSepaXml in app.js). Der Kontoauszug-Abgleich
// erkennt daran später eine Buchung wieder, die aus unserem eigenen Export
// stammt — deshalb steht der Wert hier und nicht zweimal im Code.
const SEPA_MSG_PRAEFIX = "SC1911";

// PDF-Feldkoordinaten für das Vertragstemplate (Punkte, Ursprung unten-links, A4).
// Diese Werte müssen nach Kalibrierung mit dem echten vertrag-template.pdf
// angepasst werden. Bis dahin greift der Fallback-PDF-Pfad in pdf-utils.js.
const PDF_FIELDS = {
  vorname:      { x: 175, y: 694, size: 11 },
  nachname:     { x: 175, y: 676, size: 11 },
  geburtsdatum: { x: 175, y: 658, size: 11 },
  strasse:      { x: 175, y: 640, size: 11 },
  plz_ort:      { x: 175, y: 622, size: 11 },
  telefon:      { x: 175, y: 604, size: 11 },
  email:        { x: 175, y: 586, size: 11 },
  iban:         { x: 175, y: 550, size: 11 },
  bankname:     { x: 175, y: 532, size: 11 },
  bic:          { x: 175, y: 514, size: 11 },
  datum:        { x: 350, y: 140, size: 11 },
  // Unterschrift-Bild (x/y = untere-linke Ecke des Bildes)
  signature:    { x: 60,  y: 90,  width: 200, height: 60 }
};

// Kalibrierte Unterschrift-Stellen im WORD-generierten Vertrags-PDF (generate-pdfs.ps1
// -> vertrag-template.docx -> Word-Export, NICHT der obige PDF_FIELDS-Fallback-Pfad).
// buildSignedVertragPdf() in pdf-utils.js stempelt die Signatur hier zusätzlich zur
// angehängten Bestätigungsseite direkt auf die beiden echten Unterschriftslinien des
// Vertrags: Seite 2 (Hauptvertrag, rechte Linie "Übungsleiter") und Seite 4
// (Anlage 1, einzelne Linie "Übungsleiter"). seite ist 0-basiert (pdf-lib), xMitte/
// yUnten in Punkten, Ursprung unten-links. Kalibriert am 2026-07-10 per pdfplumber
// gegen ein mit `generate-pdfs.ps1 -Test` erzeugtes Muster-PDF (A4, 595.5x842pt).
// Die Stellen liegen in großzügigem Leerraum oberhalb der jeweiligen Linie -- kleine
// Textlängen-Unterschiede (Name/Lizenz/Betrag) verschieben nichts nennenswert. Bei
// einer größeren Template-Änderung (neue Absätze, viel längere Felder) ggf. neu
// kalibrieren: `generate-pdfs.ps1 -Test` laufen lassen und die Linien-Koordinaten in
// PDFs/Mustermann_Max_Vertrag.pdf neu vermessen.
const VERTRAG_SIGNATURE_STELLEN = [
  { seite: 1, xMitte: 413, yUnten: 120, maxBreite: 125, maxHoehe: 30 }, // Hauptvertrag, Linie "Übungsleiter"
  { seite: 3, xMitte: 129, yUnten: 396, maxBreite: 135, maxHoehe: 30 }  // Anlage 1, Linie "Übungsleiter"
];

const APP_CHANGELOG = [
  {
    version: "1.10",
    groups: [
      {
        title: "Der unterschriebene Vertrag muss wirklich ein Vertrag sein",
        items: [
          "Beim Einreichen der Vertragsunterschrift wurde bisher nur geprüft, ob überhaupt etwas ankommt — nicht, ob es das unterschriebene Vertrags-PDF ist. Im Zweifel stand danach „unterschrieben“ in der Akte, obwohl niemand nachgesehen hatte, was dort abgelegt wurde.",
          "Jetzt wird der Inhalt geprüft: ist es kein PDF, wird die Einreichung mit einer Meldung abgewiesen und der Vertrag bleibt offen. Bereits geleistete Unterschriften sind davon nicht betroffen."
        ]
      }
    ]
  },
  {
    version: "1.9",
    groups: [
      {
        title: "Hochgeladene Dokumente werden am Inhalt geprüft, nicht an der Beschriftung",
        items: [
          "Beim Hochladen von Trainerlizenz, Führerschein und Führungszeugnis hat bisher der hochladende Browser bestimmt, als was für ein Dateityp das Dokument gespeichert wird — geprüft wurde der Inhalt nie. Wer beim Ansehen darauf klickte, öffnete also eine Datei, deren Art niemand nachgesehen hatte.",
          "Jetzt entscheiden die ersten Bytes der Datei: erlaubt sind PDF und die üblichen Bildformate (JPEG, PNG, GIF, WebP, HEIC vom iPhone). Alles andere wird beim Hochladen mit einer Meldung abgewiesen, statt später beim Ansehen zu überraschen.",
          "Beim Anzeigen gibt es zusätzlich nur noch geprüfte Dateiarten heraus. Bereits hinterlegte Dokumente bleiben abrufbar — ein Dokument mit einer unbekannten Dateiart wird zum Herunterladen angeboten statt direkt angezeigt."
        ]
      }
    ]
  },
  {
    version: "1.8",
    groups: [
      {
        title: "Einreichungen während einer offenen Verwaltungssitzung bleiben stehen",
        items: [
          "Wer die Verwaltung offen hatte und danach irgendwo etwas tippte, schrieb damit den Stand zurück, der beim Öffnen geladen worden war. Alles, was ein Trainer in der Zwischenzeit selbst gemacht hatte, war weg: Kodex und Jugendschutzkonzept bestätigen, Führerschein, Führungszeugnis oder Trainerlizenz hochladen, die Freigabe für die Kontaktliste ändern, Stammdaten aktualisieren — und die Unterschrift unter dem Trainervertrag.",
          "Besonders unangenehm war dabei, dass die Datei selbst in der Vereins-Cloud blieb (Unterschrift, Scan, unterschriebener Vertrag) und nur der Verweis darauf verschwand. Danach behauptete die Akte „noch nicht eingereicht“, obwohl alles vorlag.",
          "Beim Speichern wird jetzt Feld für Feld abgeglichen: Was der Trainer geändert hat, wird übernommen; was in der Verwaltung geändert wurde, hat Vorrang. Ein bewusstes Zurücksetzen — Kodex, Jugendschutz, Vertrag, Unterschrift — bleibt damit ein Zurücksetzen und wird nicht vom Server wieder aufgefüllt. Bereits erstellte Verträge und geleistete Unterschriften werden dadurch nicht neu bewertet."
        ]
      }
    ]
  },
  {
    version: "1.7",
    groups: [
      {
        title: "Die hinterlegte Lizenzart bleibt erhalten",
        items: [
          "Beim Öffnen eines Trainers in der Verwaltung wurde die gespeicherte Lizenzart im Auswahlfeld nicht angezeigt — dort stand immer „— bitte wählen —“. Sobald danach irgendwo im Detail etwas getippt wurde, schrieb das automatische Speichern diese leere Auswahl in den Datensatz: die Lizenzart war weg, ohne Meldung und ohne dass es in der Verwaltung auffiel. Bemerkt hat es erst der Trainer auf seiner eigenen Seite oder wer die Spalte „Trainerlizenz-Art“ exportiert hat.",
          "Das Auswahlfeld zeigt jetzt wieder die hinterlegte Lizenzart, und das automatische Speichern schreibt sie unverändert zurück. Bereits geleerte Einträge müssen einmal von Hand nachgetragen werden — die App kann nicht wissen, was dort stand."
        ]
      }
    ]
  },
  {
    version: "1.6",
    groups: [
      {
        title: "Kontoauszug: vorgemerkte Belastungen sind jetzt als solche erkennbar",
        items: [
          "Beim Abgleich eines untertägigen Kontoauszugs (camt.052) zählte eine erst vorgemerkte Belastung wie eine gebuchte. Der Bericht meldete „n von n erwarteten Zahlungen wiedergefunden“, obwohl das Geld noch gar nicht abgeflossen war und die Bank die Vormerkung noch hätte zurücknehmen können.",
          "Vorgemerkte Belastungen zählen weiterhin als wiedergefunden — sie werden jetzt aber ausdrücklich als „erst vorgemerkt“ ausgewiesen, sowohl in der Zusammenfassung als auch bei den einzelnen Buchungen. Der Auszugs-Export als Tabelle hat dafür eine neue Spalte „Status“ am Ende. Am Tagesauszug (camt.053) ändert sich nichts, dort ist alles gebucht."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Führerschein-Register ist für die Geschäftsstelle wieder sichtbar",
        items: [
          "Das Führerschein-Register mit dem Sammel-Export stand innerhalb des Bereichs zum Jugendschutzkonzept. Dieser Bereich wird für alle ausgeblendet, die selbst keinen Trainervertrag bekommen — also für Geschäftsstelle und Funktionäre, und damit für genau die Gruppe, für die das Register gebaut wurde. Sie sahen weder die Liste noch den Knopf „Alle als PDF exportieren“, und es gab keinen Hinweis darauf.",
          "Das Register steht jetzt als eigener Bereich unter „Meine Daten“ und erscheint für alle, die die Berechtigung dafür haben — unabhängig davon, ob sie selbst einen Trainervertrag haben."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Jugendschutzkonzept: „es wurde nichts gespeichert“ stimmt jetzt auch",
        items: [
          "Wenn beim Bestätigen des Jugendschutzkonzepts die geltende Fassung gerade nicht abrufbar war oder sich zwischendurch geändert hatte, meldete die App „es wurde nichts gespeichert“ — die neue Unterschrift war zu diesem Zeitpunkt aber schon abgelegt und hatte die vorherige überschrieben. In der Akte stand danach ein altes Bestätigungsdatum mit einer Unterschrift, die nicht dazu gehörte.",
          "Die Fassung wird jetzt zuerst geprüft und die Unterschrift erst danach gespeichert. Bricht die Bestätigung ab, bleibt die bisherige Unterschrift unangetastet."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Zurückgenommene Unterschrift verschwindet jetzt auch aus der Vereins-Cloud",
        items: [
          "Beim Knopf „Unterschrift zurücksetzen“ in der Trainerverwaltung wurde zwar der Vermerk im Datensatz gelöscht, der bereits unterschriebene Vertrag blieb aber als PDF in der Vereins-Cloud liegen. In der Ablage stand danach eine Unterschrift, die ausdrücklich zurückgenommen worden war, und niemand erfuhr davon.",
          "Jetzt wird das unterschriebene PDF mitgelöscht — genau wie bei den Knöpfen für Kodex und Jugendschutzkonzept. Klappt das Löschen einmal nicht, steht es als Hinweis unter dem Knopf, damit die Datei von Hand geräumt werden kann."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Kontoauszug: keine falsche Sammelbuchungs-Warnung mehr",
        items: [
          "Beim Abgleich eines Kontoauszugs erschien der rote Hinweis „Der Auszug enthält die Überweisung offenbar als eine einzige Sammelbuchung“ auch dann, wenn alle Zahlungen sauber einzeln gefunden wurden. Ausgelöst hat ihn jede fremde Sammelbuchung im selben Auszug — etwa der Beitragslauf. Er stand damit direkt unter der Zeile „n von n erwarteten Zahlungen wiedergefunden“ und widersprach ihr.",
          "Der Hinweis erscheint jetzt nur noch, wenn tatsächlich eine Zahlung vermisst wird."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Eingaben gehen beim Schließen nicht mehr verloren",
        items: [
          "Die Detailansicht eines Trainers speichert automatisch, aber erst gut eine Sekunde nach der letzten Eingabe. Wurde der Reiter in dieser Sekunde geschlossen oder das Handy gesperrt, war das zuletzt Getippte weg — betroffen waren auch IBAN, Pauschale und Lizenzangaben.",
          "Jetzt wird beim Wegwechseln, beim Sperren des Bildschirms und beim Schließen der Seite noch gespeichert. Am Bedienen ändert sich nichts."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Aufbau, Rechte und Bedienung am Handy",
        items: [
          "Die Reiterleiste zeigt jedem „Meine Daten“ mit dem eigenen Formular und ganz rechts „Info“. Wer die Trainerdaten verwalten darf, sieht dazwischen zusätzlich „Trainer“, „Import“ und „Einstellungen“ — die drei stehen zusammen rechts, weil sie nicht jeder hat.",
          "Die Anmeldung über das zentrale Konto der Tools-Übersicht ist Pflicht: die eigene Einreichung wird dem Konto eindeutig zugeordnet und auf jedem Gerät wiedererkannt. Pro Konto gibt es genau eine Einreichung; erneutes Absenden aktualisiert sie.",
          "Jeder angemeldete Nutzer pflegt seine eigenen Daten und Dokumente. Der gesamte Verwaltungsbereich — Trainerliste, Import, Einstellungen und damit die volle Sicht auf die Bankverbindungen — hängt dagegen an der Stufe „Administrieren“, nicht an „Bearbeiten“. So lässt sich ein Bearbeiten-Recht vergeben, ohne die Bankdaten aller Trainer zu öffnen. Vergeben wird das im Sichtbarkeits-Panel der Tools-Übersicht.",
          "Geprüft wird bei jedem Zugriff auf dem Server, nicht nur in der Oberfläche. Ein geteiltes Passwort braucht es dafür nicht.",
          "Läuft die Anmeldung ab, während die App offen ist, erscheint der Hinweis „bitte neu anmelden“, und der Bildschirm dahinter wird geleert — auch der Verwaltungsteil mit der Trainerliste. Sonst blieben Anschrift, Geburtsdatum und Bankverbindung für jeden stehen, der sich an denselben Rechner setzt.",
          "Die Daten liegen auf dem vereinseigenen Nextcloud-Server. Der Zugriff läuft über einen eigenen Server-Dienst; die Zugangsdaten dazu liegen ausschließlich dort und nie im Browser. Wegen der Bankverbindungen läuft dieses Werkzeug bewusst nicht über den allgemeinen Datenweg der übrigen Apps.",
          "Die Reiterleiste bricht am Handy um, statt seitlich aus dem Bild zu laufen — auch die hinteren Reiter sind auf schmalen Bildschirmen erreichbar. Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt. Unterschreiben und Dokumente per Kamera hochladen funktionieren am Handy."
        ]
      },
      {
        title: "Die eigenen Daten — mit und ohne Trainervertrag",
        items: [
          "Unter „Meine Daten“ trägt jede Person ihre Stammdaten selbst ein — Name, Anschrift, Geburtsdatum, Telefon und E-Mail — dazu die Bankdaten mit IBAN, BIC und Bank, die Erklärung zur Nebentätigkeit und die digitale Unterschrift. Jede Person sieht dort ausschließlich sich selbst.",
          "Vollständige Angaben sind Pflicht: Vorname, Nachname, Geburtsdatum, Straße und Hausnummer, PLZ, Ort, Telefonnummer und E-Mail-Adresse. Wer einen Trainervertrag bekommt, braucht zusätzlich IBAN, Bankname und die Erklärung zur Nebentätigkeit; wer dort „andere Einnahmen“ ankreuzt, auch deren Höhe. Der BIC bleibt absichtlich freiwillig — bei einer deutschen IBAN wird er für die Überweisung nicht gebraucht, und die wenigsten kennen ihn auswendig.",
          "Alle Pflichtfelder sind mit einem Sternchen gekennzeichnet. Fehlt eines, sagt die App beim Speichern, welches — und zwar immer das oberste, damit man nicht springen muss.",
          "Wer sich anmeldet und hier noch Lücken hat, landet einmal je Anmeldung direkt im vorausgefüllten Formular statt auf der Bestätigungsseite. Oben steht, was genau noch fehlt. Wer alles beisammen hat, sieht zuerst seine Bestätigungsseite: ein Bild der übermittelten Angaben samt Unterschrift zur Selbstkontrolle, mit Knopf zum Bearbeiten und dem Weg zurück zur Tools-Übersicht.",
          "Persönliche Daten, Bankverbindung, Erklärung zur Nebentätigkeit und Unterschrift sowie die Karten für Vertrag, Checkliste, Trainerlizenz, Führerschein, Führungszeugnis, Trainerkodex und Jugendschutzkonzept lassen sich einzeln auf- und zuklappen. Jede Karte trägt im Titel ein Häkchen für erledigt, ein Kreuz für offen oder einen Strich für nicht zutreffend — aktualisiert schon beim Tippen. Beim ersten Laden stehen offene Punkte aufgeklappt, erledigte zugeklappt.",
          "Hochgeladene Unterschriften prüft der Server selbst darauf, dass wirklich ein PNG-Bild ankommt, und begrenzt sie auf 2 MB. Wird etwas abgelehnt, steht der Grund im Klartext da.",
          "Wer keinen Trainervertrag bekommt, etwa in Geschäftsstelle oder Geschäftsführung, sieht nur die Kontaktdaten: Name, Geburtsdatum, Anschrift, Telefon und E-Mail. Bankverbindung, Erklärung zur Nebentätigkeit, Unterschrift und sämtliche Dokumentenkarten entfallen für diese Konten — auch in der Verwaltungsansicht, samt der Knöpfe für den Vertrag. An ihrer Stelle steht ein kurzer Hinweis.",
          "Maßgeblich ist dasselbe Kriterium wie beim Personalkosten-Import: Mitglied der Gruppe „Trainer“ oder einzeln als „Vertrag benötigt“ markiert. Soll jemand doch einen Vertrag bekommen, genügt der Status „Ausstehend“ — dann sind alle Felder sofort wieder da.",
          "Die E-Mail-Adresse ist für diese Konten Pflicht, sie ist der Grund für den Eintrag. In der Verwaltungsliste erscheinen sie als „Nur Kontaktdaten“ und werden bei der Vertragserstellung übersprungen."
        ]
      },
      {
        title: "Trainervertrag",
        items: [
          "Sobald der Vertrag bereitsteht, lässt er sich im eigenen Bereich ansehen und digital unterschreiben. Die Unterschrift wird zusätzlich zur angehängten Bestätigungsseite direkt auf die beiden echten Unterschriftslinien im Vertrag gesetzt — er sieht damit auch an den gewohnten Stellen unterschrieben aus.",
          "Der unterschriebene Vertrag bleibt jederzeit einsehbar. Verträge werden in der Vereins-Cloud nach Jahr und Trainername abgelegt, nicht unter technischen Kennungen.",
          "Der Word-Vertrag entsteht aus der Originalvorlage und übernimmt Layout und Trainerdaten. Die Erklärung zur Übungsleiterpauschale nach § 3 Nr. 26 EStG wird im Formular abgefragt und im Vertrag automatisch angekreuzt und mit Betrag gefüllt.",
          "In der Verwaltung lassen sich Original und unterschriebene Fassung ansehen, die Unterschrift zurücksetzen oder die komplette Vertragszuweisung zurücknehmen, damit beim nächsten Lauf ein neuer Vertrag ausgestellt wird.",
          "Ein beiliegendes Skript erzeugt die PDFs für alle Trainer auf einmal im Original-Layout — lokal über Microsoft Word, die IBANs verlassen den Rechner nicht. Verarbeitet werden nur Trainer mit Status „Ausstehend“; unvollständige und bereits erzeugte Verträge werden übersprungen. Skript und Vertragsvorlage stehen im Reiter „Einstellungen“ zum Herunterladen, dazu zwei Doppelklick-Starter — einer nur zum Erzeugen, einer zum Erzeugen und Zuweisen. Sie umgehen die Windows-Sperre für heruntergeladene Skripte."
        ]
      },
      {
        title: "Trainerlizenz, Führerschein und Führungszeugnis",
        items: [
          "Alle drei Dokumente lassen sich direkt hochladen, per Kamera oder als Datei. Die eigene Datei ist jederzeit selbst einsehbar; fremde Führungszeugnisse bleiben aus Datenschutzgründen den Administratoren vorbehalten.",
          "Der Führerschein hat ein „gültig bis“ und eine Erinnerung, ihn alle sechs Monate erneut einzureichen. Für Administratoren und die Gruppe „Führerschein Einsicht“ gibt es ein eigenes Register samt Sammel-PDF aller Kopien; darin steht der Name mit Upload-Datum und Gültigkeit auf derselben Seite wie das Foto.",
          "Die Trainerlizenz wird mit Lizenzart erfasst — C, B, A, DFB-Basis, Elite-Jugend, Fußball-Lehrer und weitere — und mit Datum „gültig bis“, dazu die Anzeige, ob sie gilt oder abgelaufen ist. Ein Häkchen „Ich habe keine Trainerlizenz“ verhindert, dass der Status dauerhaft als offen erscheint.",
          "Administratoren können alle drei Dokumente auch für Trainer ohne eigenen Zugang hochladen, ansehen und ersetzen, unter anderem direkt aus der Personalakte.",
          "Ein unbrauchbares Dokument lässt sich löschen — unscharfes Foto, falsche Datei. Es steht danach beim Trainer wieder als offen; Lizenzart, Gültigkeit und das Häkchen bleiben davon unberührt."
        ]
      },
      {
        title: "Trainerkodex, Jugendschutz und Checkliste",
        items: [
          "Der Trainerkodex lässt sich hier lesen und mit Unterschrift bestätigen. Die Bestätigung ist alle sechs Monate erneut fällig; abgelaufene werden markiert. Die Verwaltung sieht Bestätigungsdatum, Gültigkeit und Unterschrift und kann eine Bestätigung zurücksetzen.",
          "Wortlaut, Schulung und Bestätigung des Kinder- und Jugendschutzkonzepts stehen in der App „Kinder- und Jugendschutz“ — dort wird gelesen, geschult und unterschrieben. Die Karte hier zeigt nur noch, ob und wann bestätigt wurde und bis wann es gilt, mit einem Knopf, der direkt zur Schulung führt. Die Bestätigung landet danach in der Akte hier: Datum, Fassung und Unterschrift. Ist das Konzept abgelaufen, zählt das zum Gesamtstatus und erscheint als rotes Kreuz auf der Kachel im Dashboard.",
          "Eine eigene Karte zeigt, ob der eigene Zugang laut Geschäftsstelle abgeschlossen ist. „Öffnen“ zeigt die komplette Checkliste zum Nachlesen — alle abgehakten Punkte, Bemerkungen und die Unterschriften von Trainer und Geschäftsstelle, rein zur Information. Die Verwaltung sieht zusätzlich, ob Zugang und Abgang in der TrainerCheckliste abgeschlossen sind.",
          "Wird eine Bestätigung oder ein Vertrag zurückgesetzt, verschwindet auch die gespeicherte Unterschrift beziehungsweise das abgelegte PDF aus der Vereins-Cloud. Klappt das nicht, weil die Cloud gerade nicht erreichbar ist, steht jetzt da, welche Datei liegen geblieben ist und warum — das Zurücksetzen selbst bricht deswegen nicht ab."
        ]
      },
      {
        title: "Verwaltung und Export der Trainerliste",
        items: [
          "Der Reiter „Trainer“ zeigt alle eingereichten Einträge mit Status — unvollständig, ausstehend, Vertrag erstellt oder nur Kontaktdaten —, dazu Lizenz und Pauschale direkt in der Liste. Gesucht wird nach Namen, gefiltert nach Status, Lizenz und Vertragsunterschrift.",
          "Daten lassen sich bearbeiten und speichern; gespeichert wird laufend, zusätzlich gibt es einen Knopf für sofortiges sichtbares Sichern. Einträge lassen sich mit Rückfrage löschen. Während einer laufenden Sitzung neu eingegangene Einreichungen werden beim Speichern übernommen statt überschrieben.",
          "Der Status lässt sich von Hand umstellen, wird bei einer erneuten Einreichung aber zurückgesetzt — ein bereits erzeugter Vertrag fällt so wieder als veraltet auf. Die Lizenz wird beim Öffnen aus dem zentralen Trainerprofil vorbelegt, sofern das Feld noch leer ist.",
          "Der CSV-Export ist frei zusammenstellbar: Stammdaten, Bankverbindung, Vertrag und Status sowie Dokumente sind einzeln wählbar, und der Export übernimmt Suche und Filter. Das Feld „Mannschaft(en)“ kommt aus dem Profil in der Tools-Übersicht und wird allein dort gepflegt; das Feld „Gruppen“ nennt alle Benutzergruppen, in denen die Person Mitglied ist.",
          "Zusätzlich lässt sich der Export auf Gruppen, auf das Führungszeugnis und auf Wohnorte einschränken. Kein Kästchen angekreuzt heißt jeweils „alle“. Bei „Führungszeugnis fehlt“ bleiben Konten ohne Trainervertrag draußen — sie sollen gar keins einreichen; „Führungszeugnis eingereicht“ nimmt jeden mit, der eins abgegeben hat.",
          "Beim Wohnort steht je Ort ein Kästchen mit der Zahl der Trainer dahinter. Verschiedene Schreibweisen desselben Ortes stehen in einer Zeile — „37308 Heiligenstadt“, „Heilbad Heiligenstadt“ und „heiligenstadt“ ebenso wie „Mühlhausen“ und „Muehlhausen“ —, und ein Haken auf eine Gemeinde nimmt ihre Ortsteile mit; welche das sind, steht klein darunter. Der Knopf „Umkehren“ ist der kurze Weg zu „alle außer Heiligenstadt“ — gedacht für das erweiterte Führungszeugnis, das jeder auswärts Gemeldete bei seinem eigenen Meldeamt beantragt.",
          "Die Zeile über dem Export-Knopf sagt immer, wie viele Trainer bei der aktuellen Auswahl wirklich herauskommen. Alle Verträge auf einmal gibt es als PDF-ZIP."
        ]
      },
      {
        title: "Bank-Export und Kontoauszug",
        items: [
          "Der Knopf „Bank-Export“ über der Trainerliste erzeugt aus den gerade gefilterten Trainern eine fertige Überweisungsliste: Empfänger, IBAN, BIC und die hinterlegte Pauschale als Betrag. Vier Formate stehen zur Wahl — CSV im Aufbau der Bank-Vorlage, eine Excel-Mappe im Aufbau derselben Vorlage, eine SEPA-XML als fertige Sammelüberweisung (pain.001) und eine XML im Aufbau der Vorlage.",
          "Die Excel-Mappe trägt ein Blatt namens „in“, in der ersten Zeile die zwölf Spalten der Bank-Vorlage, darunter je Trainer eine Zahlung. Der Betrag steht darin als echte Zahl und nicht als Text, damit das Banktool ihn als Betrag erkennt.",
          "Für die SEPA-Datei werden Auftraggeber — Name und IBAN des Vereinskontos — sowie das gewünschte Ausführungsdatum abgefragt; diese Angaben stehen in keinem Trainer-Datensatz. Sie bleiben im Browser gespeichert und müssen nur einmal eingetragen werden. Die Bank des Empfängers braucht die Datei seit der Umstellung auf IBAN-Only nicht mehr: ein BIC steht nur noch drin, wenn wirklich einer hinterlegt ist.",
          "IBAN und BIC werden vor dem Erzeugen geprüft. Ein BIC hat genau 8 oder 11 Zeichen, nur Großbuchstaben und Ziffern; beim BIC des Auftraggebers meldet sich der Export vorher und sagt, was falsch ist, das Feld darf aber leer bleiben. Beim BIC eines einzelnen Trainers wird der Export nicht angehalten — ein krummer Wert wird für diese Zahlung weggelassen, die IBAN allein genügt.",
          "Umlaute werden für die SEPA-Datei automatisch umgeschrieben, aus „Hünermund“ wird „Huenermund“. Der Standard erlaubt keine Umlaute, und die Bank würde die Datei sonst vollständig abweisen. In den übrigen drei Formaten bleiben Umlaute erhalten.",
          "Trainer ohne IBAN oder ohne Pauschale lassen sich nicht überweisen. Sie werden nicht stillschweigend weggelassen, sondern namentlich aufgeführt.",
          "„CSV-Datei wählen → SEPA-XML“ wandelt eine bereits vorhandene Liste im Format der Bank-Vorlage in eine Sammelüberweisung um — etwa die zuvor exportierte Datei, nachdem Beträge angepasst oder Zeilen gelöscht wurden. Die Spalten werden über die Kopfzeile erkannt, verschobene Spalten sind also unkritisch; fehlt die Kopfzeile, gilt die Reihenfolge der Vorlage. Zeilen ohne Empfänger, ohne gültige IBAN oder ohne lesbaren Betrag landen nicht in der Datei, sondern mit Zeilennummer und Grund in einer Liste. In Excel bearbeitete Dateien werden ebenfalls gelesen: erkennt die App zerschossene Umlaute, liest sie die Datei automatisch ein zweites Mal in der älteren Windows-Zeichenkodierung.",
          "Der Bank-Export hat einen Rückweg: Im Bereich „Kontoauszug prüfen“ wird der Auszug aus dem Online-Banking eingelesen — Format CAMT.053, ebenso .052 und .054 — und gegen die Überweisungsliste gehalten. Das beantwortet die Frage nach der Zahlung: Ist das Geld bei jedem Trainer angekommen?",
          "Der Bericht nennt jede wiedergefundene Zahlung, jede mit abweichendem Betrag samt erwartetem und tatsächlich gebuchtem Wert, jede fehlende — und jede Belastung des Kontos, die zu keinem Trainer der aktuellen Auswahl gehört. Zugeordnet wird über die IBAN, ersatzweise über den Empfängernamen, der auch in vertauschter Reihenfolge und in der umgeschriebenen Form erkannt wird; solche Treffer weist der Bericht getrennt aus. Über dem Ergebnis stehen Konto, Auszugsnummer, Zeitraum sowie Anfangs- und Endsaldo. Bucht die Bank die Sammelüberweisung als eine einzige Zeile ohne die einzelnen Empfänger, sagt der Bericht das ausdrücklich — sonst sähe es aus, als sei keine einzige Zahlung angekommen.",
          "Gespeichert wird beim Abgleich nichts: die Datei bleibt im Browser, der Abgleich ist eine reine Kontrollansicht. Wer die Bewegungen weiterverarbeiten will, lädt sie mit „Umsätze als CSV“ herunter — mit Buchungstag, Betrag, Empfänger, Verwendungszweck und der jeweiligen Zuordnung."
        ]
      },
      {
        title: "Import aus den Personalkosten",
        items: [
          "„Von Personalkosten laden“ holt Lizenz und monatliche Pauschale aller Trainer der laufenden Saison über einen Namensabgleich. Damit bleiben die Personalkosten die einzige Pflegestelle für diese Werte.",
          "Die Vorschau zeigt alle geladenen Zeilen mit ihrer Zuordnung. Jede Zeile hat einen eigenen Knopf, um einzelne Trainer unabhängig vom Sammelimport zu übernehmen.",
          "Ein neuer Eintrag entsteht nur, wenn die Person in der Gruppe „Trainer“ ist oder einzeln als „Vertrag benötigt“ markiert wurde. Namen ohne bestehenden Eintrag werden als unvollständig geführt und ergänzen sich, sobald die Person sich selbst anmeldet.",
          "Der Bereich „Aktueller Stand“ zeigt alle Trainer mit ihrer hinterlegten Lizenz und Pauschale und aktualisiert sich nach jedem Import."
        ]
      }
    ]
  }
];
