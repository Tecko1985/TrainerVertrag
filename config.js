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
    version: "1.14",
    groups: [
      {
        title: "Trainervertrag: Unterschrift direkt im Dokument",
        items: [
          "Die digitale Unterschrift wird jetzt zusätzlich zur angehängten Bestätigungsseite direkt auf die beiden echten Unterschriftslinien im Vertrag gestempelt (Hauptvertrag Seite 2 und Anlage 1 Seite 4) – der Vertrag sieht damit auch an den gewohnten Stellen unterschrieben aus."
        ]
      }
    ]
  },
  {
    version: "1.13",
    groups: [
      {
        title: "Trainervertrag: Statusanzeige repariert",
        items: [
          "Der Bereich „Trainervertrag“ zeigte bei bereits registrierten Trainern (Bestätigungs-Screen „Bereits eingereicht“) immer den leeren Ausgangszustand, auch wenn längst ein Vertrag bereitgestellt oder unterschrieben wurde – betraf praktisch jeden Trainer nach der ersten Einreichung. Behoben: Status und Ansehen-Button aktualisieren sich jetzt auch auf diesem Screen korrekt."
        ]
      }
    ]
  },
  {
    version: "1.12",
    groups: [
      {
        title: "Admin-Übersicht",
        items: [
          "Die Liste „Eingereichte Trainerdaten“ zeigt jetzt zusätzlich die hinterlegte Pauschale je Trainer an – zum schnellen Abgleich, ohne jeden Eintrag einzeln zu öffnen."
        ]
      }
    ]
  },
  {
    version: "1.11",
    groups: [
      {
        title: "Trainervertrag: übersichtliche Ablage",
        items: [
          "Unterschriebene und bereitgestellte Trainerverträge werden in der Cloud jetzt nach Jahr und Trainername abgelegt (z. B. vertraege/2026/Vorname_Nachname/) statt unter technischen IDs — dadurch im Nextcloud leicht wiederzufinden und automatisch nach Jahren archiviert."
        ]
      }
    ]
  },
  {
    version: "1.10",
    groups: [
      {
        title: "Trainervertrag ansehen & unterschreiben",
        items: [
          "Neuer Bereich „Trainervertrag\" im Trainerbereich: sobald dein Vertrag bereitgestellt wurde, kannst du ihn direkt ansehen und digital unterschreiben.",
          "Beim Unterschreiben wird ein fertiges PDF erzeugt (dein Vertrag plus eine Unterschriftenseite mit Name, Datum und Signatur) und sicher auf dem Vereinsserver gespeichert.",
          "Dein unterschriebener Vertrag ist jederzeit wieder einsehbar — du hast damit selbst im Blick, was du wann unterschrieben hast.",
          "Admin-Detail: Original- und unterschriebenen Vertrag ansehen sowie den Unterschrift-Status je Trainer.",
          "Die Verträge werden mit generate-pdfs.ps1 -Zuweisen erzeugt und den Trainern zugewiesen."
        ]
      }
    ]
  },
  {
    version: "1.9",
    groups: [
      {
        title: "Admin-Dokumente",
        items: [
          "\"Ansehen\" bei Führerschein/Führungszeugnis/Trainerlizenz im Admin-Detail zeigt die Datei jetzt im Browser an, statt sie herunterzuladen."
        ]
      }
    ]
  },
  {
    version: "1.8",
    groups: [
      {
        title: "TrainerCheckliste-Status im Trainerbereich",
        items: [
          "Neue Karte „Checkliste Trainerzu-/-abgang\" direkt hier im Trainerdaten-Tab, zwischen der Unterschrift des Hauptformulars und der Trainerlizenz.",
          "Zeigt an, ob der eigene Zugang (Onboarding) laut Geschäftsstelle abgeschlossen ist.",
          "„Öffnen\" zeigt die komplette Checkliste zum Nachlesen: alle abgehakten Punkte, Bemerkungen sowie die Unterschriften von Trainer/Betreuer und Geschäftsstelle — rein informativ, keine eigene Bestätigung nötig."
        ]
      }
    ]
  },
  {
    version: "1.7",
    groups: [
      {
        title: "Kinder- und Jugendschutzkonzept",
        items: [
          "Neuer Bereich „Jugendschutzkonzept\" — Text lesen und mit Unterschrift bestätigen, gleiches Prinzip wie beim Trainerkodex, direkt hier im Trainerdaten-Tab.",
          "Die Bestätigung ist ebenfalls alle 6 Monate erneut fällig; ist sie abgelaufen, zählt das mit zum Gesamtstatus (rotes Kreuz auf der Dashboard-Kachel, Eingabe erforderlich).",
          "Admin-Detail zeigt Bestätigungsdatum, Gültigkeit und Unterschrift, mit der Möglichkeit, eine Bestätigung zurückzusetzen."
        ]
      },
      {
        title: "Trainerkodex: Darstellung zusammengelegt",
        items: [
          "Text und Bestätigung (Unterschrift) stehen jetzt in einer gemeinsamen Karte statt in zwei getrennten — rein optische Vereinfachung, keine Funktionsänderung."
        ]
      }
    ]
  },
  {
    version: "1.6",
    groups: [
      {
        title: "Trainerkodex",
        items: [
          "Der Verhaltenskodex ist keine eigene App mehr: Kodex lesen und mit Unterschrift bestätigen läuft jetzt direkt hier, über denselben Gateway-Login wie das Hauptformular.",
          "Die Bestätigung ist alle 6 Monate erneut fällig (wie die Führerschein-Kopie) — abgelaufene Bestätigungen werden entsprechend markiert.",
          "Bestehende Bestätigungen aus der bisherigen Trainerkodex-App wurden übernommen.",
          "Admin-Detail zeigt Bestätigungsdatum, Gültigkeit und Unterschrift der jeweiligen Person, mit der Möglichkeit, eine Bestätigung zurückzusetzen."
        ]
      },
      {
        title: "TrainerCheckliste-Status im Admin-Detail",
        items: [
          "Zeigt zusätzlich an, ob für den Trainer in TrainerCheckliste Zugang bzw. Abgang abgeschlossen sind (rein informativ, ohne Auswirkung auf den Ampel-Status der Trainerdaten-Kachel)."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Trainerlizenz: Art + Gültigkeit",
        items: [
          "Neues Dropdown „Lizenzart\" (C-/B-/A-Lizenz, DFB-Basis-/Elite-Jugend-/Fußball-Lehrer-Lizenz u.a.) bei der Trainerlizenz, sowohl bei dir selbst als auch im Admin-Detail.",
          "Neues Datumsfeld „Lizenz gültig bis\" mit automatischer Gültig/Abgelaufen-Anzeige, sobald eine Datei hochgeladen ist."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Trainerlizenz: Selbstauskunft für alle",
        items: [
          "Neue Checkbox „Ich habe keine Trainerlizenz\" jetzt auch in der Trainer-Selbstbedienung, nicht nur im Admin-Detail — jeder kann selbst bestätigen, dass keine Lizenz vorhanden ist."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Layout-Fix",
        items: [
          "Checkbox „Keine Trainerlizenz vorhanden\" stand fälschlich in derselben Zeile wie die Buttons ganz am rechten Rand — steht jetzt sichtbar auf einer eigenen Zeile darunter."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Dokumente: Admin-Detail nachgebessert",
        items: [
          "Admin kann Trainerlizenz, Führerschein und Führungszeugnis jetzt auch im Detailbereich direkt per Kamera fotografieren, nicht nur per Datei-/Galerie-Auswahl.",
          "Neue Checkbox „Keine Trainerlizenz vorhanden\" bei Trainerlizenz, damit der Status nicht dauerhaft als ausstehend erscheint, wenn jemand schlicht keine besitzt."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Dokumente: Trainerlizenz",
        items: [
          "Kopie der Trainerlizenz direkt hochladen (Kamera oder Datei/PDF), an derselben Stelle wie Führerschein und Führungszeugnis — die eigene Datei ist jederzeit selbst einsehbar.",
          "Admin kann die Trainerlizenz im Detailbereich auch für Trainer ohne eigenen Login hochladen/ansehen und direkt aus der Personalakte öffnen."
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
        title: "Dokumente: Führerschein & Führungszeugnis",
        items: [
          "Führerschein-Kopie direkt hochladen (Kamera oder Datei/PDF); „Gültig bis …“ mit Erinnerung, alle 6 Monate erneut einzureichen. Register für Admin und die Gruppe „Führerschein Einsicht“ inklusive Sammel-PDF-Export aller eingereichten Kopien.",
          "Erweitertes Führungszeugnis hochladen; die eigene Datei ist selbst einsehbar, fremde Führungszeugnisse aus Datenschutzgründen nur für Admins (u. a. direkt aus der Personalakte).",
          "Admin kann beide Dokumente im Detailbereich auch für Trainer ohne eigenen Login hochladen/ansehen (Personalkosten-Import-Stubs)."
        ]
      },
      {
        title: "Admin-Ansicht",
        items: [
          "Übersicht aller eingereichten Trainer-Einträge mit Status (Unvollständig / Ausstehend / Vertrag generiert) und Lizenz direkt in der Liste.",
          "Suchfeld (nach Name) sowie Filter nach Status und Lizenz.",
          "Trainer-Daten bearbeiten und speichern (automatisches Speichern); Eintrag löschen mit Sicherheitsabfrage.",
          "Während einer Admin-Sitzung neu eingegangene Einreichungen werden beim Speichern übernommen statt überschrieben.",
          "Status im Detail ist manuell umstellbar, wird bei einer erneuten Einreichung des Trainers aber automatisch zurückgesetzt (ein bereits generierter Vertrag fällt so wieder als veraltet auf).",
          "Lizenz wird beim Öffnen eines Trainer-Details automatisch aus dem zentralen Trainerprofil vorbelegt, sofern das Feld noch leer ist."
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
        title: "Datenimport",
        items: [
          "„Von Personalkosten laden“ holt Lizenz und monatliche Pauschale aller Trainer der aktuellen Saison direkt aus der Personalkosten-App (Namensabgleich) — Personalkosten ist damit die einzige Pflegestelle für diese Werte.",
          "Vorschau zeigt alle geladenen Zeilen mit automatischer Trainer-Zuordnung; jede Zeile hat einen eigenen Import-Button, um einzelne Trainer unabhängig vom Sammel-Import zu übernehmen.",
          "Namen ohne bestehenden Trainer werden als neuer, unvollständiger Eintrag angelegt (Lizenz/Pauschale, Stammdaten fehlen noch) — als „Unvollständig“ markiert und automatisch vervollständigt, sobald sich die Person selbst über das Trainer-Formular anmeldet.",
          "Bereich „Aktueller Stand“ zeigt alle Trainer mit ihrer aktuell hinterlegten Lizenz und Pauschale (bzw. „fehlt“), aktualisiert sich nach jedem Import."
        ]
      },
      {
        title: "Lokaler Stapel-Export",
        items: [
          "generate-pdfs.ps1 erzeugt PDFs für alle Trainer auf einmal im Original-Vertragslayout (lokal über Microsoft Word, IBANs verlassen den Rechner nicht).",
          "Verarbeitet dabei nur Trainer mit Status „Ausstehend“ — unvollständige (Stub ohne Anmeldung) und bereits generierte Verträge werden automatisch übersprungen."
        ]
      }
    ]
  }
];
