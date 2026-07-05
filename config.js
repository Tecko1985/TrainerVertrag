const APP_VERSION = "1.2";

// WebDAV-Pfad für Admin-Zugriff (vorausgefüllt, App-Passwort wird nicht gespeichert)
const WEBDAV_DEFAULT_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/TrainerVertrag/trainervertrag.json";
const WEBDAV_DEFAULT_USERNAME = "admin";
const CORS_PROXY_DEFAULT_URL = "https://trainervertrag.michel-brunner.workers.dev";

// Trainer-Einreichung (Login über das ToolsUebersicht-Konto): POST an diesen
// Cloudflare-Worker-Endpunkt. Der Worker hält die Nextcloud-Zugangsdaten als
// Worker-Secrets (nie im Code) und verifiziert den Login-Token serverseitig.
const SUBMIT_WORKER_URL = "https://trainervertrag1.michel-brunner.workers.dev";

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
    version: "1.2",
    groups: [
      {
        title: "Bugfix",
        items: [
          "Unterschriften-Feld: Zeichnen konnte je nach Fensterbreite versetzt oder abgeschnitten wirken, weil die Zeichenfläche beim ersten Anzeigen des Formulars noch auf ihrer Standardgröße hing. Jetzt wird sie beim Sichtbarwerden korrekt an ihre tatsächliche Größe angepasst."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Navigation",
        items: [
          "Link „Zurück zum Dashboard“ oben auf der Seite: Kacheln in der Tools-Übersicht öffnen die Tools jetzt im gleichen Tab statt in einem neuen."
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
          "Anmeldung über das Tools-Übersicht-Konto: die eigene Einreichung wird auf jedem Gerät wiedererkannt; pro Konto gibt es genau eine Einreichung, erneutes Absenden aktualisiert sie.",
          "Bestätigungs-Screen zeigt die übermittelten Daten samt Unterschrift zur Selbstkontrolle — mit „Bearbeiten“-Button und Link zurück zur Tools-Übersicht.",
          "Daten werden sicher auf dem vereinseigenen Nextcloud-Server gespeichert; die Zugangsdaten liegen ausschließlich auf dem Server, nie im Browser."
        ]
      },
      {
        title: "Admin-Ansicht",
        items: [
          "Übersicht aller eingereichten Trainer-Einträge mit Status (Ausstehend / Vertrag generiert).",
          "Trainer-Daten bearbeiten und speichern (automatisches Speichern); Eintrag löschen mit Sicherheitsabfrage.",
          "Während einer Admin-Sitzung neu eingegangene Einreichungen werden beim Speichern übernommen statt überschrieben."
        ]
      },
      {
        title: "Vertragsgenerierung",
        items: [
          "Word-Vertrag generieren — befüllt das Original-Vertragstemplate mit den Trainerdaten, originalgetreues Layout.",
          "PDF-Datenblatt herunterladen — einzeln oder als ZIP für alle Trainer auf einmal (namensgleiche Trainer werden automatisch nummeriert).",
          "Digitale Unterschrift des Trainers wird eingebettet; Status wird beim Word-Vertrag auf „Generiert“ gesetzt."
        ]
      },
      {
        title: "Datenimport",
        items: [
          "Pauschalen und Lizenzen per Text-Import aktualisieren (Format: Name, Lizenz, Pauschale, Tab-getrennt).",
          "Vorschau mit automatischer Trainer-Zuordnung vor dem Import."
        ]
      },
      {
        title: "Lokaler Stapel-Export",
        items: [
          "generate-pdfs.ps1 erzeugt PDFs für alle Trainer auf einmal im Original-Vertragslayout (lokal über Microsoft Word, IBANs verlassen den Rechner nicht)."
        ]
      }
    ]
  }
];
