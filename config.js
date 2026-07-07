const APP_VERSION = "1.5";

// WebDAV-Pfad für Admin-Zugriff (vorausgefüllt, App-Passwort wird nicht gespeichert)
const WEBDAV_DEFAULT_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/TrainerVertrag/trainervertrag.json";
const WEBDAV_DEFAULT_USERNAME = "admin";
const CORS_PROXY_DEFAULT_URL = "https://trainervertrag.michel-brunner.workers.dev";

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
          "Übersicht aller eingereichten Trainer-Einträge mit Status (Unvollständig / Ausstehend / Vertrag generiert) und Lizenz direkt in der Liste.",
          "Suchfeld (nach Name) sowie Filter nach Status und Lizenz.",
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
          "Vorschau zeigt alle eingefügten Zeilen mit ihren Werten; jede Zeile hat einen eigenen Import-Button, um einzelne Trainer unabhängig vom Sammel-Import zu übernehmen.",
          "Namen ohne bestehenden Trainer werden als neuer, unvollständiger Eintrag angelegt (Lizenz/Pauschale, Stammdaten fehlen noch) statt übersprungen zu werden — als „Unvollständig“ markiert und automatisch vervollständigt, sobald sich die Person selbst über das Trainer-Formular anmeldet.",
          "Bereich „Aktueller Stand“ zeigt alle Trainer mit ihrer aktuell hinterlegten Lizenz und Pauschale (bzw. „fehlt“), aktualisiert sich nach jedem Import.",
          "Ergebnis-Anzeige nach dem Sammel-Import listet die tatsächlich aktualisierten Trainer samt neuer Werte sowie nicht zugeordnete Namen einzeln auf."
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
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Datenimport",
        items: [
          "Import-Tab lädt Lizenz und monatliche Pauschale jetzt direkt aus Personalkosten (Bereich „Trainer“, aktuelle Saison) statt sie manuell einzufügen — Personalkosten ist damit die einzige Pflegestelle für diese Werte.",
          "Namensabgleich, Vorschau mit Einzel-/Sammel-Übernahme und „Aktueller Stand“ funktionieren unverändert wie beim bisherigen Text-Import."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Erklärung Nebentätigkeit (Anlage 1)",
        items: [
          "Trainer-Formular und Admin-Detail fragen jetzt die Erklärung zur Übungsleiterpauschale nach § 3 Nr. 26 EStG ab (keine anderen Einnahmen aus nebenberuflicher Tätigkeit bzw. andere Einnahmen in bestimmter Höhe) — bislang musste dieser Teil des Vertrags (Anlage 1) von Hand angekreuzt werden.",
          "Der generierte Word-Vertrag setzt die passende Ankreuz-Box automatisch und trägt bei „andere Einnahmen“ den angegebenen Betrag ein — sowohl beim Einzel-Download als auch beim lokalen Stapel-Export (generate-pdfs.ps1)."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Admin-Liste",
        items: [
          "Das Datum in der Spalte „Eingereicht“ zeigt jetzt den Zeitpunkt der echten Unterschrift — nicht mehr das Anlage-/Erstellungsdatum eines Datensatzes (z. B. aus dem Personalkosten-Import), das fälschlich wie eine Einreichung aussah.",
          "Status im Admin-Detail ist jetzt manuell umstellbar (Unvollständig / Ausstehend / Vertrag erstellt) statt nur automatisch abgeleitet zu werden."
        ]
      }
    ]
  }
];
