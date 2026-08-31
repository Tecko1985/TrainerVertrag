# 📋 Trainerdaten

Die Stammdaten der Trainerinnen und Trainer — einmal von der Person selbst
eingetragen, danach Grundlage für Verträge, Dokumente und die anderen
Werkzeuge des Vereins. Wer hier seine Daten pflegt, muss sie nirgends sonst
noch einmal angeben.

**➡️ [Trainerdaten öffnen](https://sc1911heiligenstadt.github.io/Trainerdaten/)**

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Meine Daten** | Die eigenen Angaben eintragen und ansehen — jede Person sieht hier nur sich selbst |
| **Trainer** | Die Gesamtliste, inklusive **Führerschein-Register** sowie **Pauschalen & Lizenzen** aus den Personalkosten |
| **Import** | Bestandsdaten einspielen |
| **Einstellungen** | Verbindung und Admin-Zugang |

## Verträge und Kodex

Aus den Stammdaten erzeugt die App **Vertrags-PDFs** — die Erzeugung läuft
lokal im Browser, die fertigen Dokumente verlassen den Rechner nicht ungefragt.
Zum Vertragspaket gehören der **Verhaltenskodex** und der **Jugendschutz-Text**,
die beim Ausfüllen mit unterschrieben werden.

## Wer sieht was

Die Trennung ist hier strenger als in den anderen Werkzeugen: **Meine Daten**
steht jedem Angemeldeten offen und zeigt ausschließlich die eigenen Angaben.
Die Reiter **Trainer**, **Import** und **Einstellungen** sind
administrationspflichtig und werden erst nach einer **serverseitigen**
Rechteprüfung eingeblendet — nicht nur im Browser versteckt.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

## Lokal starten

Über den Eintrag `trainerdaten` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8769/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

Anders als die meisten Werkzeuge der Familie bringt diese App **zwei eigene
Worker** mit: `submit-worker.js` nimmt die von den Trainern übermittelten Daten
entgegen, `cors-proxy-worker.js` vermittelt die dafür nötigen Aufrufe.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
