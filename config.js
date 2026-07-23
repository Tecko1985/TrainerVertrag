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
      { key: "email", label: "E-Mail" }
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
    version: "1.2",
    groups: [
      {
        title: "Eingereichte Trainerdaten",
        items: [
          "Neuer Filter „Alle Gruppen“ in der Filterleiste: zeigt nur Personen, die Mitglied der gewählten Benutzergruppe aus der Tools-Übersicht sind. „Ohne Gruppe“ findet umgekehrt alle Einträge ohne Gruppenzuordnung. Suche, übrige Filter und der CSV-Export berücksichtigen den Gruppen-Filter automatisch mit. Voraussetzung ist ein Admin-Login in der Tools-Übersicht im selben Browser — ohne bleibt der Filter ausgegraut."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Führerschein-Register",
        items: [
          "PDF-Export: Name, Upload-Datum und Gültigkeit stehen jetzt auf derselben Seite wie das zugehörige Führerschein-Foto. Vorher kam das Foto immer auf einer eigenen Folgeseite — das PDF war dadurch doppelt so lang und wirkte halb leer."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Trainer-Dateneingabe",
        items: [
          "Formular für Trainer: Stammdaten (Name, Adresse, Geburtsdatum, Telefon, E-Mail) und Bankdaten (IBAN, BIC, Bank) + digitale Unterschrift.",
          "Anmeldung über das zentrale Tools-Übersicht-Konto ist Pflicht: die eigene Einreichung wird eindeutig dem Konto zugeordnet und auf jedem Gerät wiedererkannt; pro Konto gibt es genau eine Einreichung, erneutes Absenden aktualisiert sie.",
          "Bestätigungs-Screen zeigt die übermittelten Daten samt Unterschrift zur Selbstkontrolle — mit „Bearbeiten“-Button und Link zurück zur Tools-Übersicht.",
          "Daten werden über einen Cloudflare Worker sicher auf dem vereinseigenen Nextcloud-Server gespeichert; die Zugangsdaten liegen ausschließlich auf dem Server, nie im Browser."
        ]
      },
      {
        title: "Übersichtliche Darstellung im Trainerbereich",
        items: [
          "Persönliche Daten, Bankverbindung, Erklärung Nebentätigkeit und Unterschrift sowie Trainervertrag, Checkliste Trainerzu-/-abgang, Trainerlizenz, Führerschein, Führungszeugnis, Trainerkodex und Jugendschutzkonzept lassen sich jeweils einzeln auf-/zuklappen — die Seite bleibt dadurch deutlich kompakter.",
          "Jede Karte zeigt direkt im Titel ein Häkchen (erledigt), Kreuz (noch offen) oder einen Strich (aktuell nicht zutreffend), aktualisiert live beim Tippen. Beim ersten Laden starten offene Punkte automatisch ausgeklappt, erledigte eingeklappt."
        ]
      },
      {
        title: "Konten ohne Trainervertrag: nur noch Kontaktdaten",
        items: [
          "Wer keinen Trainervertrag bekommt (z. B. Geschäftsstelle/Geschäftsführung), sieht im Formular nur noch die Kontaktdaten: Name, Geburtsdatum, Anschrift, Telefon und E-Mail. Bankverbindung, Erklärung zur Nebentätigkeit, Unterschrift sowie die Karten für Vertrag, Checkliste, Trainerlizenz, Führerschein, Führungszeugnis, Trainerkodex und Jugendschutzkonzept entfallen für diese Konten komplett.",
          "Maßgeblich ist dasselbe Kriterium wie beim Personalkosten-Import: Mitglied der Gruppe „Trainer“ ODER individuell als „Vertrag benötigt“ markiert. An der Ansicht von Trainern ändert sich dadurch nichts.",
          "Die E-Mail-Adresse ist für diese Konten Pflichtfeld — sie ist der Grund für den Eintrag. In der Admin-Liste erscheinen solche Einträge als „Nur Kontaktdaten“ und werden bei der Vertragserstellung übersprungen."
        ]
      },
      {
        title: "Trainervertrag ansehen & digital unterschreiben",
        items: [
          "Sobald der Vertrag bereitgestellt wurde, im Trainerbereich direkt ansehen und digital unterschreiben. Die Unterschrift wird zusätzlich zur angehängten Bestätigungsseite direkt auf die beiden echten Unterschriftslinien im Vertrag gestempelt — er sieht damit auch an den gewohnten Stellen unterschrieben aus.",
          "Der unterschriebene Vertrag ist jederzeit wieder einsehbar; unterschriebene und bereitgestellte Verträge werden in der Cloud nach Jahr und Trainername abgelegt statt unter technischen IDs.",
          "Admin-Detail: Original- und unterschriebenen Vertrag ansehen sowie den Unterschrift-Status je Trainer; die Unterschrift lässt sich bei Bedarf zurücksetzen (erneutes Unterschreiben möglich, Original-Vertrag bleibt unangetastet), oder die komplette Vertragszuweisung eines Trainers zurücksetzen (inkl. Unterschrift und Dateien), damit beim nächsten Lauf von generate-pdfs.ps1 -Zuweisen ein neuer Vertrag ausgestellt wird."
        ]
      },
      {
        title: "Vertragsgenerierung",
        items: [
          "Word-Vertrag generieren — befüllt das Original-Vertragstemplate mit den Trainerdaten, originalgetreues Layout, inkl. digitaler Unterschrift.",
          "Erklärung zur Übungsleiterpauschale (Anlage 1, § 3 Nr. 26 EStG) wird im Formular abgefragt und im Word-Vertrag automatisch angekreuzt bzw. mit Betrag befüllt — nicht mehr von Hand nötig.",
          "PDF-Datenblatt herunterladen — einzeln oder als ZIP für alle Trainer auf einmal (namensgleiche Trainer werden automatisch nummeriert)."
        ]
      },
      {
        title: "Dokumente: Trainerlizenz, Führerschein & Führungszeugnis",
        items: [
          "Trainerlizenz, Führerschein und erweitertes Führungszeugnis direkt hochladen (Kamera oder Datei/PDF), an derselben Stelle im Trainerbereich — die eigene Datei ist jederzeit selbst einsehbar; fremde Führungszeugnisse bleiben aus Datenschutzgründen nur für Admins sichtbar.",
          "Führerschein: „Gültig bis …“ mit Erinnerung, alle 6 Monate erneut einzureichen. Eigenes Register für Admin und die Gruppe „Führerschein Einsicht“ inklusive Sammel-PDF-Export aller eingereichten Kopien.",
          "Trainerlizenz: Lizenzart per Dropdown (C-/B-/A-Lizenz, DFB-Basis-/Elite-Jugend-/Fußball-Lehrer-Lizenz u. a.) und Datum „gültig bis“ mit automatischer Gültig/Abgelaufen-Anzeige, sobald eine Datei hochgeladen ist; Checkbox „Ich habe keine Trainerlizenz“ für alle, damit der Status nicht dauerhaft als ausstehend erscheint.",
          "Admin kann alle drei Dokumente im Detailbereich auch für Trainer ohne eigenen Login hochladen/ansehen/ersetzen (u. a. direkt aus der Personalakte) — ein hinterlegtes Dokument öffnet sich dabei im Browser statt herunterzuladen.",
          "Löschen-Button je Dokument für den Fall, dass das Hinterlegte unbrauchbar ist (unscharfes Foto, falsche Datei) — danach steht es beim Trainer wieder als offen da und kann neu hochgeladen werden; Lizenzart, „gültig bis“ und die Checkbox „Keine Trainerlizenz“ bleiben davon unberührt."
        ]
      },
      {
        title: "Trainerkodex",
        items: [
          "Verhaltenskodex lesen und mit Unterschrift bestätigen, direkt im Trainerbereich über denselben zentralen Login.",
          "Die Bestätigung ist alle 6 Monate erneut fällig — abgelaufene Bestätigungen werden entsprechend markiert.",
          "Admin-Detail zeigt Bestätigungsdatum, Gültigkeit und Unterschrift, mit der Möglichkeit, eine Bestätigung zurückzusetzen."
        ]
      },
      {
        title: "Jugendschutzkonzept",
        items: [
          "Kinder- und Jugendschutzkonzept lesen und mit Unterschrift bestätigen — gleiches Prinzip wie beim Trainerkodex, unabhängig davon geführt.",
          "Die Bestätigung ist ebenfalls alle 6 Monate erneut fällig; ist sie abgelaufen, zählt das mit zum Gesamtstatus (rotes Kreuz auf der Dashboard-Kachel, Eingabe erforderlich).",
          "Admin-Detail zeigt Bestätigungsdatum, Gültigkeit und Unterschrift, mit der Möglichkeit, eine Bestätigung zurückzusetzen."
        ]
      },
      {
        title: "Checkliste Trainerzu-/-abgang im Trainerdaten-Tab",
        items: [
          "Eigene Karte direkt im Trainerbereich: zeigt an, ob der eigene Zugang (Onboarding) laut Geschäftsstelle abgeschlossen ist. „Öffnen“ zeigt die komplette Checkliste zum Nachlesen — alle abgehakten Punkte, Bemerkungen sowie die Unterschriften von Trainer/Betreuer und Geschäftsstelle, rein informativ.",
          "Admin-Detail zeigt zusätzlich, ob für den Trainer in TrainerCheckliste Zugang bzw. Abgang abgeschlossen sind."
        ]
      },
      {
        title: "Admin-Ansicht",
        items: [
          "Übersicht aller eingereichten Trainer-Einträge mit Status (Unvollständig / Ausstehend / Vertrag generiert), Lizenz und Pauschale direkt in der Liste.",
          "Suchfeld (nach Name) sowie Filter nach Status, Lizenz und Vertragsunterschrift.",
          "Trainer-Daten bearbeiten und speichern (automatisches Speichern, zusätzlich ein „Speichern“-Button für sofortiges, sichtbares Sichern); Eintrag löschen mit Sicherheitsabfrage.",
          "Während einer Admin-Sitzung neu eingegangene Einreichungen werden beim Speichern übernommen statt überschrieben.",
          "Status im Detail ist manuell umstellbar, wird bei einer erneuten Einreichung des Trainers aber automatisch zurückgesetzt (ein bereits generierter Vertrag fällt so wieder als veraltet auf).",
          "Lizenz wird beim Öffnen eines Trainer-Details automatisch aus dem zentralen Trainerprofil vorbelegt, sofern das Feld noch leer ist.",
          "Konfigurierbarer CSV-Export der Liste „Eingereichte Trainerdaten“ — jedes Feld (Stammdaten, Bankverbindung, Vertrag & Status, Dokumente) einzeln per Checkbox an-/abwählbar; berücksichtigt die aktuelle Such-/Filter-Einstellung."
        ]
      },
      {
        title: "Datenimport",
        items: [
          "„Von Personalkosten laden“ holt Lizenz und monatliche Pauschale aller Trainer der aktuellen Saison direkt aus der Personalkosten-App (Namensabgleich) — Personalkosten ist damit die einzige Pflegestelle für diese Werte.",
          "Vorschau zeigt alle geladenen Zeilen mit automatischer Trainer-Zuordnung; jede Zeile hat einen eigenen Import-Button, um einzelne Trainer unabhängig vom Sammel-Import zu übernehmen.",
          "Ein neuer Trainer-Eintrag wird nur angelegt, wenn die Person Mitglied der Gruppe „Trainer“ ist ODER individuell als „Vertrag benötigt“ markiert wurde — verhindert Einträge für Personen ohne Trainer-Rolle. Namen ohne bestehenden Trainer werden als „Unvollständig“ markiert und automatisch vervollständigt, sobald sich die Person selbst über das Trainer-Formular anmeldet.",
          "Bereich „Aktueller Stand“ zeigt alle Trainer mit ihrer aktuell hinterlegten Lizenz und Pauschale (bzw. „fehlt“), aktualisiert sich nach jedem Import."
        ]
      },
      {
        title: "Lokaler Stapel-Export",
        items: [
          "generate-pdfs.ps1 erzeugt PDFs für alle Trainer auf einmal im Original-Vertragslayout (lokal über Microsoft Word, IBANs verlassen den Rechner nicht). Verarbeitet dabei nur Trainer mit Status „Ausstehend“ — unvollständige (Stub ohne Anmeldung) und bereits generierte Verträge werden automatisch übersprungen.",
          "Skript und Vertragsvorlage lassen sich im Einstellungen-Tab (Admin) direkt herunterladen, inklusive zweier Doppelklick-Starter (nur lokal erzeugen, oder erzeugen und den Trainern zuweisen) — umgeht die Windows-Blockade für heruntergeladene PowerShell-Skripte."
        ]
      }
    ]
  }
];
