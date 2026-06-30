# Trainervertrag

Web-App zur Erfassung von Trainer-Stammdaten und zur automatischen Befüllung von Trainerverträgen als Word- und PDF-Dokument.

**Live:** https://tecko1985.github.io/TrainerVertrag/

---

## Funktionen

### Trainer-Modus (öffentlich, kein Login)
- Formular für Stammdaten: Name, Adresse, Geburtsdatum, Telefon, E-Mail
- Bankverbindung (IBAN, BIC, Bankname) mit automatischer IBAN-Formatierung
- Digitale Unterschrift per Canvas (Maus oder Finger)
- Daten werden verschlüsselt an den Vereinsserver übertragen (Cloudflare Worker → Nextcloud)

### Admin-Modus (Passwort-geschützt via Nextcloud App-Passwort)
- Übersicht aller eingereichten Trainer-Einträge
- Trainer-Daten bearbeiten (automatisches Speichern)
- **Word-Vertrag generieren** – befüllt `vertrag-template.docx` mit den Trainerdaten und lädt die `.docx` direkt herunter
- **PDF herunterladen** – erzeugt ein PDF-Datenblatt für einzelne Trainer
- **Alle als PDF-ZIP** – erzeugt PDFs für alle Trainer und packt sie in eine ZIP-Datei
- Einträge löschen

### Import
Pauschalen und Lizenzen per Text-Import aktualisieren:
1. Daten im Format `Name[Tab]Lizenz[Tab]Pauschale` einfügen (z. B. direkt aus Excel kopiert)
2. Vorschau mit automatischer Trainer-Zuordnung prüfen
3. Import starten — schreibt `lizenz` und `pauschale` in die Trainer-Datensätze

### Stapel-PDF-Export (lokal, Windows)
Für echte Vertrags-PDFs im Originallayout (alle Trainer auf einmal):

```powershell
# Daten von Nextcloud laden (App-Passwort wird abgefragt):
powershell -ExecutionPolicy Bypass -File .\generate-pdfs.ps1

# Oder mit lokal gespeicherter JSON-Datei:
powershell -ExecutionPolicy Bypass -File .\generate-pdfs.ps1 -JsonPath .\trainervertrag.json

# Test mit Dummy-Daten:
powershell -ExecutionPolicy Bypass -File .\generate-pdfs.ps1 -Test
```

PDFs landen im Ordner `PDFs\` als `Nachname_Vorname_Vertrag.pdf`.  
Voraussetzung: Microsoft Word muss installiert sein.

---

## Technischer Stack

| Komponente | Technik |
|---|---|
| Frontend | Vanilla JS, kein Build-Step |
| Persistenz | Nextcloud via WebDAV |
| CORS-Proxy | Cloudflare Worker (`cors-proxy-worker.js`) |
| Trainer-Einreichung | Cloudflare Worker (`submit-worker.js`) |
| DOCX-Generierung | JSZip (CDN) — Platzhalter-Ersetzung in `word/document.xml` |
| PDF-Export (Stapel) | Microsoft Word COM-Automation (`generate-pdfs.ps1`) |
| Deployment | GitHub Pages (auto-rebuild bei Push auf `master`) |

---

## Platzhalter im Vertrag-Template

`vertrag-template.docx` enthält folgende Platzhalter:

| Platzhalter | Bedeutung |
|---|---|
| `{{VORNAME}}` | Vorname des Trainers |
| `{{NACHNAME}}` | Nachname des Trainers |
| `{{LIZENZ}}` | Trainerlizenz (z. B. C, B, ohne Lizenz) |
| `{{PAUSCHALE}}` | Monatliche Pauschale in EUR |
| `{{IBAN}}` | IBAN (formatiert mit Leerzeichen) |
| `{{BANKNAME}}` | Name der Bank |
| `{{BIC}}` | BIC |
| `{{DATUM}}` | Aktuelles Datum (TT.MM.JJJJ) |
| `{{JAHR}}` | Aktuelles Jahr (JJJJ) |

---

## Cloudflare Worker

Zwei Worker sind deployed:

- `trainervertrag.michel-brunner.workers.dev` — CORS-Proxy für Admin-WebDAV-Zugriff
- `trainervertrag1.michel-brunner.workers.dev` — Nimmt Trainer-Einreichungen entgegen (ohne Login); benötigt Worker-Secrets: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`

---

## Datenschutz

- IBANs und persönliche Daten werden ausschließlich über HTTPS übertragen
- Daten landen nur auf dem vereinseigenen Nextcloud-Server
- App-Passwort wird nie im Code gespeichert (nur in IndexedDB für die laufende Session)
- Beim lokalen Stapel-Export (`generate-pdfs.ps1`) verlassen IBANs den Rechner nicht
