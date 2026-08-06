# 📝 Trainerdaten

Trainer-Stammdaten erfassen, Trainerverträge automatisch als Word-Dokument erzeugen und digital unterschreiben, dazu Führerschein, Führungszeugnis und Trainerlizenz zentral hochladen und verwalten.

**➡️ [Trainerdaten öffnen](https://sc1911heiligenstadt.github.io/Trainerdaten/)**

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (nur ansehen), **Bearbeiten** (Einträge pflegen) und **Administrieren** (Einstellungen und Verwaltung). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `trainerdaten` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8769/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser. Eigene Cloudflare-Worker in diesem Repo: `cors-proxy-worker.js`, `submit-worker.js`. Die werden **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare veröffentlicht.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
