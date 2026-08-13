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
    version: "1.2",
    groups: [
      {
        title: "Kontaktliste des Vereins",
        items: [
          "Neuer Bereich „Kontaktliste des Vereins“ unter „Meine Daten“: Dort gibst du selbst frei, mit welchen Angaben du im neuen Werkzeug „Kontakte“ erscheinst. Von uns aus steht dort nichts über dich — ohne dein Häkchen bist du nicht in der Liste.",
          "Gefragt wird einzeln: erst, ob du überhaupt mit deinem Namen in der Liste stehen möchtest, und darunter für Telefonnummer, E-Mail-Adresse und Anschrift getrennt. Du kannst also die Telefonnummer freigeben und die Anschrift für dich behalten.",
          "Jedes Häkchen lässt sich jederzeit wieder entfernen. Die Angabe verschwindet dann sofort aus der Liste.",
          "Die Freigabe gilt nur für angemeldete Personen des Vereins. Nach außen wird nichts veröffentlicht; Bankverbindung, Geburtsdatum und Dokumente sind in der Kontaktliste grundsätzlich nie zu sehen.",
          "Der Bereich steht allen offen — auch denen, die keinen Trainervertrag bekommen. Gerade sie sollen ja erreichbar sein."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Kontoauszug prüfen",
        items: [
          "Der Bank-Export hat einen Rückweg bekommen: Im neuen Bereich „Kontoauszug prüfen“ wird der Auszug aus dem Online-Banking eingelesen — Format CAMT.053, ebenso .052 und .054 — und gegen die Überweisungsliste gehalten. Das beantwortet die Frage nach der Zahlung: Ist das Geld bei jedem Trainer angekommen?",
          "Der Bericht nennt jede wiedergefundene Zahlung, jede mit abweichendem Betrag samt erwartetem und tatsächlich gebuchtem Wert, jede fehlende — und jede Belastung des Kontos, die zu keinem Trainer der aktuellen Auswahl gehört. Nichts wird stillschweigend weggelassen.",
          "Zugeordnet wird über die IBAN, ersatzweise über den Empfängernamen. Der Name wird auch in vertauschter Reihenfolge erkannt und in der Schreibweise, die für die Bank aus Umlauten wird — aus Hünermund wird dort Huenermund. Zahlungen, die nur über den Namen zugeordnet werden konnten, weist der Bericht getrennt aus.",
          "Über dem Ergebnis stehen Konto, Auszugsnummer, Zeitraum sowie Anfangs- und Endsaldo aus dem Auszug.",
          "Bucht die Bank die Sammelüberweisung als eine einzige Zeile ohne die einzelnen Empfänger, sagt der Bericht das ausdrücklich — sonst sähe es aus, als sei keine einzige Zahlung angekommen.",
          "Gespeichert wird dabei nichts: die Datei bleibt im Browser, der Abgleich ist eine reine Kontrollansicht. Wer die Bewegungen weiterverarbeiten will, lädt sie mit „Umsätze als CSV“ herunter — mit Buchungstag, Betrag, Empfänger, Verwendungszweck und der jeweiligen Zuordnung."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Aufbau",
        items: [
          "Die Reiterleiste zeigt jedem „Meine Daten“ mit dem eigenen Formular und „Info“. Wer die Trainerdaten verwalten darf, sieht zusätzlich „Trainer“, „Import“ und „Einstellungen“.",
          "Die Verwaltung öffnet sich beim Klick direkt, ohne Zwischenschritt. Die App startet für alle bei „Meine Daten“."
        ]
      },
      {
        title: "Die eigenen Daten",
        items: [
          "Formular für Stammdaten — Name, Adresse, Geburtsdatum, Telefon, E-Mail — sowie Bankdaten mit IBAN, BIC und Bank, dazu die digitale Unterschrift.",
          "Die Anmeldung über das zentrale Konto ist Pflicht: die eigene Einreichung wird dem Konto eindeutig zugeordnet und auf jedem Gerät wiedererkannt. Pro Konto gibt es genau eine Einreichung; erneutes Absenden aktualisiert sie.",
          "Ein Bestätigungsbild zeigt die übermittelten Angaben samt Unterschrift zur Selbstkontrolle, mit Knopf zum Bearbeiten und Weg zurück zur Tools-Übersicht.",
          "Persönliche Daten, Bankverbindung, Erklärung zur Nebentätigkeit und Unterschrift sowie die Karten für Vertrag, Checkliste, Trainerlizenz, Führerschein, Führungszeugnis, Trainerkodex und Jugendschutzkonzept lassen sich einzeln auf- und zuklappen.",
          "Jede Karte trägt im Titel ein Häkchen für erledigt, ein Kreuz für offen oder einen Strich für nicht zutreffend — aktualisiert schon beim Tippen. Beim ersten Laden stehen offene Punkte aufgeklappt, erledigte zugeklappt."
        ]
      },
      {
        title: "Konten ohne Trainervertrag",
        items: [
          "Wer keinen Trainervertrag bekommt, etwa in Geschäftsstelle oder Geschäftsführung, sieht nur die Kontaktdaten: Name, Geburtsdatum, Anschrift, Telefon und E-Mail.",
          "Bankverbindung, Erklärung zur Nebentätigkeit, Unterschrift und sämtliche Dokumentenkarten entfallen für diese Konten.",
          "Maßgeblich ist dasselbe Kriterium wie beim Personalkosten-Import: Mitglied der Gruppe „Trainer“ oder einzeln als „Vertrag benötigt“ markiert.",
          "Die E-Mail-Adresse ist für diese Konten Pflicht — sie ist der Grund für den Eintrag. In der Verwaltungsliste erscheinen sie als „Nur Kontaktdaten“ und werden bei der Vertragserstellung übersprungen."
        ]
      },
      {
        title: "Trainervertrag",
        items: [
          "Sobald der Vertrag bereitsteht, lässt er sich im eigenen Bereich ansehen und digital unterschreiben.",
          "Die Unterschrift wird zusätzlich zur angehängten Bestätigungsseite direkt auf die beiden echten Unterschriftslinien im Vertrag gesetzt — er sieht damit auch an den gewohnten Stellen unterschrieben aus.",
          "Der unterschriebene Vertrag bleibt jederzeit einsehbar. Verträge werden in der Cloud nach Jahr und Trainername abgelegt, nicht unter technischen Kennungen.",
          "Der Word-Vertrag entsteht aus der Originalvorlage und übernimmt Layout und Trainerdaten.",
          "Die Erklärung zur Übungsleiterpauschale nach § 3 Nr. 26 EStG wird im Formular abgefragt und im Vertrag automatisch angekreuzt und mit Betrag gefüllt.",
          "In der Verwaltung lassen sich Original und unterschriebene Fassung ansehen, die Unterschrift zurücksetzen oder die komplette Vertragszuweisung zurücknehmen, damit beim nächsten Lauf ein neuer Vertrag ausgestellt wird."
        ]
      },
      {
        title: "Trainerlizenz, Führerschein und Führungszeugnis",
        items: [
          "Alle drei Dokumente lassen sich direkt hochladen, per Kamera oder als Datei. Die eigene Datei ist jederzeit selbst einsehbar; fremde Führungszeugnisse bleiben aus Datenschutzgründen den Administratoren vorbehalten.",
          "Führerschein mit „gültig bis“ und Erinnerung, ihn alle sechs Monate erneut einzureichen. Für Administratoren und die Gruppe „Führerschein Einsicht“ gibt es ein eigenes Register samt Sammel-PDF aller Kopien. Darin steht der Name mit Upload-Datum und Gültigkeit auf derselben Seite wie das Foto.",
          "Trainerlizenz mit Lizenzart zur Auswahl — C, B, A, DFB-Basis, Elite-Jugend, Fußball-Lehrer und weitere — und Datum „gültig bis“ mit automatischer Anzeige, ob sie gilt oder abgelaufen ist. Ein Häkchen „Ich habe keine Trainerlizenz“ verhindert, dass der Status dauerhaft als offen erscheint.",
          "Administratoren können alle drei Dokumente auch für Trainer ohne eigenen Zugang hochladen, ansehen und ersetzen, unter anderem direkt aus der Personalakte.",
          "Ein unbrauchbares Dokument lässt sich löschen — unscharfes Foto, falsche Datei. Es steht danach beim Trainer wieder als offen. Lizenzart, Gültigkeit und das Häkchen bleiben davon unberührt."
        ]
      },
      {
        title: "Trainerkodex und Jugendschutzkonzept",
        items: [
          "Beide lassen sich lesen und mit Unterschrift bestätigen, im eigenen Bereich über denselben Zugang.",
          "Die Bestätigung ist jeweils alle sechs Monate erneut fällig; abgelaufene werden markiert.",
          "Ist das Jugendschutzkonzept abgelaufen, zählt das zum Gesamtstatus und erscheint als rotes Kreuz auf der Kachel im Dashboard.",
          "Die Verwaltung zeigt Bestätigungsdatum, Gültigkeit und Unterschrift und kann eine Bestätigung zurücksetzen."
        ]
      },
      {
        title: "Checkliste Trainerzu- und -abgang",
        items: [
          "Eine eigene Karte zeigt, ob der eigene Zugang laut Geschäftsstelle abgeschlossen ist.",
          "„Öffnen“ zeigt die komplette Checkliste zum Nachlesen: alle abgehakten Punkte, Bemerkungen und die Unterschriften von Trainer und Geschäftsstelle — rein zur Information.",
          "Die Verwaltung sieht zusätzlich, ob Zugang und Abgang in der TrainerCheckliste abgeschlossen sind."
        ]
      },
      {
        title: "Verwaltung",
        items: [
          "Übersicht aller eingereichten Einträge mit Status — unvollständig, ausstehend oder Vertrag generiert —, Lizenz und Pauschale direkt in der Liste.",
          "Suchfeld nach Namen sowie Filter nach Status, Lizenz und Vertragsunterschrift.",
          "Daten bearbeiten und speichern; gespeichert wird laufend, zusätzlich gibt es einen Knopf für sofortiges sichtbares Sichern. Einträge lassen sich mit Rückfrage löschen.",
          "Während einer laufenden Sitzung neu eingegangene Einreichungen werden beim Speichern übernommen statt überschrieben.",
          "Der Status lässt sich von Hand umstellen, wird bei einer erneuten Einreichung aber zurückgesetzt — ein bereits erzeugter Vertrag fällt so wieder als veraltet auf.",
          "Die Lizenz wird beim Öffnen aus dem zentralen Trainerprofil vorbelegt, sofern das Feld noch leer ist."
        ]
      },
      {
        title: "Export der Trainerliste",
        items: [
          "CSV-Export, frei zusammenstellbar: Stammdaten, Bankverbindung, Vertrag und Status sowie Dokumente sind einzeln wählbar. Der Export übernimmt Suche und Filter.",
          "Exportfeld „Mannschaft(en)“: die Mannschaft laut Profil in der Tools-Übersicht, mehrere durch Komma getrennt. Gepflegt wird sie allein dort — steht dort nichts, bleibt die Spalte leer.",
          "Exportfeld „Gruppen“: alle Benutzergruppen, in denen die Person Mitglied ist.",
          "Im Export-Bereich lässt sich zusätzlich nach Gruppen einschränken: je Gruppe ein Kästchen, mehrere gleichzeitig möglich. Exportiert wird, wer in mindestens einer angekreuzten Gruppe ist. „Ohne Gruppe“ erfasst Einträge ohne Zuordnung, kein Kästchen bedeutet alle. Die Zeile darunter zeigt immer die tatsächliche Anzahl."
        ]
      },
      {
        title: "Bank-Export",
        items: [
          "Der Knopf „Bank-Export“ über der Trainerliste erzeugt aus den gerade gefilterten Trainern eine fertige Überweisungsliste: Empfänger, IBAN, BIC und die hinterlegte Pauschale als Betrag.",
          "Vier Formate stehen zur Wahl. CSV im Aufbau der Bank-Vorlage, eine Excel-Mappe im Aufbau derselben Vorlage, eine SEPA-XML als fertige Sammelüberweisung und eine XML im Aufbau der Vorlage.",
          "Die Excel-Mappe trägt ein Blatt namens „in“, in der ersten Zeile die zwölf Spalten der Bank-Vorlage, darunter je Trainer eine Zahlung. Der Betrag steht darin als echte Zahl und nicht als Text, damit das Banktool ihn als Betrag erkennt.",
          "Für die SEPA-Datei werden Auftraggeber — Name und IBAN des Vereinskontos — sowie das gewünschte Ausführungsdatum abgefragt; diese Angaben stehen in keinem Trainer-Datensatz. Sie bleiben im Browser gespeichert und müssen nur einmal eingetragen werden.",
          "Umlaute werden für die SEPA-Datei automatisch umgeschrieben, aus Hünermund wird Huenermund. Der Standard erlaubt keine Umlaute, und die Bank würde die Datei sonst vollständig abweisen. In den übrigen drei Formaten bleiben Umlaute erhalten.",
          "Trainer ohne IBAN oder ohne Pauschale lassen sich nicht überweisen. Sie werden nicht stillschweigend weggelassen, sondern namentlich aufgeführt.",
          "„CSV-Datei wählen → SEPA-XML“ wandelt eine bereits vorhandene Liste im Format der Bank-Vorlage in eine Sammelüberweisung um — etwa die zuvor exportierte Datei, nachdem Beträge angepasst oder Zeilen gelöscht wurden. Die Trainerliste spielt dabei keine Rolle.",
          "Die Spalten werden über die Kopfzeile erkannt, verschobene Spalten sind also unkritisch. Fehlt die Kopfzeile, gilt die Reihenfolge der Vorlage. Zeilen ohne Empfänger, ohne gültige IBAN oder ohne lesbaren Betrag landen nicht in der Datei, sondern mit Zeilennummer und Grund in einer Liste.",
          "In Excel bearbeitete Dateien werden ebenfalls gelesen: erkennt die App zerschossene Umlaute, liest sie die Datei automatisch ein zweites Mal in der älteren Windows-Zeichenkodierung.",
          "Welches Format das Banktool wirklich einliest, ist noch nicht bestätigt. Da die Excel-Datei dem gelieferten Muster entspricht, ist sie der aussichtsreichste Kandidat für einen Testimport."
        ]
      },
      {
        title: "Datenimport aus den Personalkosten",
        items: [
          "„Von Personalkosten laden“ holt Lizenz und monatliche Pauschale aller Trainer der laufenden Saison über einen Namensabgleich. Damit bleiben die Personalkosten die einzige Pflegestelle für diese Werte.",
          "Die Vorschau zeigt alle geladenen Zeilen mit ihrer Zuordnung. Jede Zeile hat einen eigenen Knopf, um einzelne Trainer unabhängig vom Sammelimport zu übernehmen.",
          "Ein neuer Eintrag entsteht nur, wenn die Person in der Gruppe „Trainer“ ist oder einzeln als „Vertrag benötigt“ markiert wurde. Namen ohne bestehenden Eintrag werden als unvollständig geführt und ergänzen sich, sobald die Person sich selbst anmeldet.",
          "Der Bereich „Aktueller Stand“ zeigt alle Trainer mit ihrer hinterlegten Lizenz und Pauschale und aktualisiert sich nach jedem Import."
        ]
      },
      {
        title: "Verträge im Stapel erzeugen",
        items: [
          "Ein beiliegendes Skript erzeugt die PDFs für alle Trainer auf einmal im Original-Layout — lokal über Microsoft Word, die IBANs verlassen den Rechner nicht.",
          "Verarbeitet werden nur Trainer mit Status „ausstehend“; unvollständige und bereits erzeugte Verträge werden übersprungen.",
          "Skript und Vertragsvorlage lassen sich im Reiter „Einstellungen“ herunterladen, dazu zwei Doppelklick-Starter — einer nur zum Erzeugen, einer zum Erzeugen und Zuweisen. Sie umgehen die Windows-Sperre für heruntergeladene Skripte."
        ]
      },
      {
        title: "Wer darf was",
        items: [
          "Jeder angemeldete Nutzer pflegt seine eigenen Daten und Dokumente.",
          "Der gesamte Verwaltungsbereich — Trainerliste, Import, Einstellungen und damit die volle Sicht auf die Bankverbindungen — hängt an der Stufe „Administrieren“, nicht an „Bearbeiten“. So lässt sich ein Bearbeiten-Recht vergeben, ohne die Bankdaten aller Trainer zu öffnen.",
          "Vergeben wird das im Sichtbarkeits-Panel der Tools-Übersicht.",
          "Geprüft wird bei jedem Zugriff auf dem Server, nicht nur in der Oberfläche. Ein geteiltes Passwort braucht es dafür nicht.",
          "Der Reiter „Info“ ist für alle sichtbar."
        ]
      },
      {
        title: "Bedienung am Handy",
        items: [
          "Die Reiterleiste bricht am Handy um, statt seitlich aus dem Bild zu laufen — auch die hinteren Reiter sind auf schmalen Bildschirmen erreichbar.",
          "Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt und verschoben stehen bleibt.",
          "Unterschreiben und Dokumente per Kamera hochladen funktionieren am Handy."
        ]
      },
      {
        title: "Daten & Speicherung",
        items: [
          "Die Daten liegen auf dem vereinseigenen Nextcloud-Server. Der Zugriff läuft über einen eigenen Server-Dienst; die Zugangsdaten dazu liegen ausschließlich dort und nie im Browser.",
          "Wegen der Bankverbindungen läuft dieses Werkzeug bewusst nicht über den allgemeinen Datenweg der übrigen Apps."
        ]
      }
    ]
  }
];
