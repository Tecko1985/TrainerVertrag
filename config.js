const APP_VERSION = "1.0";

// WebDAV-Pfad für Admin-Zugriff (vorausgefüllt, App-Passwort wird nicht gespeichert)
const WEBDAV_DEFAULT_URL =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/" +
  "05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/TrainerVertrag/trainervertrag.json";
const WEBDAV_DEFAULT_USERNAME = "admin";
const CORS_PROXY_DEFAULT_URL = "https://trainervertrag.michel-brunner.workers.dev";

// Trainer-Einreichung ohne Login: POST an diesen Cloudflare-Worker-Endpunkt.
// Der Worker hält die Nextcloud-Zugangsdaten als Worker-Secrets (nie im Code).
const SUBMIT_WORKER_URL = "https://trainervertrag-submit.michel-brunner.workers.dev";

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
          "Direkte Einreichung ohne Login — Daten werden sicher auf dem vereinseigenen Nextcloud-Server gespeichert.",
          "Bestätigungsscreen nach erfolgreicher Einreichung."
        ]
      },
      {
        title: "Admin-Ansicht",
        items: [
          "Übersicht aller eingereichten Trainer-Einträge mit Status (Ausstehend / Vertrag generiert).",
          "Trainer-Daten bearbeiten und speichern (automatisches Speichern).",
          "Eintrag löschen (mit Sicherheitsabfrage)."
        ]
      },
      {
        title: "PDF-Vertragsgenerierung",
        items: [
          "Automatisches Ausfüllen des Vertrags-Templates mit Trainerdaten.",
          "Digitale Unterschrift des Trainers wird ins PDF eingebettet.",
          "PDF-Download mit einem Klick; Status wird auf 'Generiert' gesetzt."
        ]
      }
    ]
  }
];
