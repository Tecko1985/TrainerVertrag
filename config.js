const APP_VERSION = "1.4";

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

// Trainer-Einreichung (Login über das ToolsUebersicht-Konto): POST an diesen
// Cloudflare-Worker-Endpunkt. Der Worker hält die Nextcloud-Zugangsdaten als
// Worker-Secrets (nie im Code) und verifiziert den Login-Token serverseitig.
const SUBMIT_WORKER_URL = "https://trainerdaten1.michel-brunner.workers.dev";

// Führerschein-Kopie: nach der ersten Einreichung alle 6 Monate erneut einzureichen
// (1:1 aus dem migrierten Fahrtenbuch-Feature übernommen, siehe [[project-trainerdaten]]).
const FUEHRERSCHEIN_GUELTIGKEIT_MONATE = 6;

// Gruppe, deren Mitglieder (plus Admin) alle eingereichten Führerschein-Kopien im
// Register einsehen dürfen — dieselbe Gruppe, die vorher im Fahrtenbuch galt.
const FS_VIEW_GROUP_ID = "fuehrerschein-einsicht";

// Größenlimit pro hochgeladener Datei (Führerschein/Führungszeugnis) — muss zum
// Worker-Cap DOC_MAX_FILE_BYTES in submit-worker.js passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

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

const APP_CHANGELOG = [
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
