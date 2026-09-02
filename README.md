# 📋 Trainerdaten

Die Stammdaten der Trainerinnen und Trainer — einmal von der Person selbst
eingetragen, danach Grundlage für Verträge, Dokumente und die anderen
Werkzeuge des Vereins. Wer hier seine Daten pflegt, muss sie nirgends sonst
noch einmal angeben.

**➡️ [Trainerdaten öffnen](https://sc1911heiligenstadt.github.io/Trainerdaten/)**

Das Werkzeug besteht aus einer einzigen Seite
([`index.html`](https://sc1911heiligenstadt.github.io/Trainerdaten/)) — es gibt
keine öffentlichen Formularseiten ohne Anmeldung.

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Meine Daten** | Die eigenen Angaben eintragen und ansehen — jede Person sieht hier nur sich selbst. Dazu die Karten für Vertrag, Checkliste, Trainerlizenz, Führerschein, Führungszeugnis, Trainerkodex und Jugendschutzkonzept, jede mit eigener Ampel |
| **Trainer** | Die Gesamtliste mit Suche und Filtern, der Trainer-Eintrag im Detail, **CSV-Export**, **Bank-Export** samt Kontoauszug-Abgleich sowie das **Führerschein-Register** |
| **Import** | Lizenz und monatliche Pauschale aus den **Personalkosten** übernehmen |
| **Einstellungen** | Verbindung sowie Skript und Vorlage für die Vertrags-PDFs im Stapel |
| **Info** | Was die App tut, die Änderungen und der Datenschutzhinweis — für alle sichtbar |

Pflichtangaben sind Vorname, Nachname, Geburtsdatum, Straße und Hausnummer, PLZ,
Ort, Telefon und E-Mail; wer einen Trainervertrag bekommt, liefert zusätzlich
IBAN, Bankname und die Erklärung zur Nebentätigkeit. Der BIC bleibt absichtlich
freiwillig. Wer noch Lücken hat, landet beim Anmelden direkt im vorausgefüllten
Formular, und oben steht, was fehlt.

## Verträge und Kodex

Aus den Stammdaten erzeugt die App **Vertrags-PDFs** — die Erzeugung läuft
lokal im Browser, die fertigen Dokumente verlassen den Rechner nicht ungefragt.
Für den Stapel gibt es zusätzlich ein PowerShell-Skript, das die PDFs über das
lokal installierte Microsoft Word erzeugt; die IBANs verlassen den Rechner dabei
nicht. Zum Vertragspaket gehört der **Verhaltenskodex**, der hier gelesen und
mit Unterschrift bestätigt wird — alle sechs Monate erneut.

⚠️ **Das Kinder- und Jugendschutzkonzept wird nicht mehr hier unterschrieben.**
Wortlaut, Schulung und Bestätigung stehen zusammen in der
[Kinderschutz-App](https://sc1911heiligenstadt.github.io/kinderschutz/#schulung).
Die Karte hier zeigt nur noch Stand und Gültigkeit und führt mit einem Knopf
dorthin; die Bestätigung landet danach in der Akte hier.

Ebenfalls umgezogen: die **Freigabe für die Kontaktliste** wird im Tab *Mein
Konto* der Tools-Übersicht gesetzt — es ist eine Einstellung am Konto, kein
Vertragsdatum. Gespeichert wird sie weiterhin hier.

## Bank-Export

Aus den gerade gefilterten Trainern entsteht eine fertige Überweisungsliste in
vier Formaten: CSV und Excel im Aufbau der Bank-Vorlage, eine **SEPA-XML**
(pain.001) als Sammelüberweisung und eine XML im Aufbau der Vorlage. IBAN und
BIC werden vorher geprüft; Umlaute werden für die SEPA-Datei umgeschrieben, weil
der Standard keine erlaubt. Trainer ohne IBAN oder ohne Pauschale werden
namentlich aufgeführt statt stillschweigend weggelassen.

Den Rückweg gibt es auch: **„Kontoauszug prüfen“** liest den Auszug aus dem
Online-Banking (CAMT.053, ebenso .052 und .054) ein und hält ihn gegen die
Überweisungsliste. Gespeichert wird dabei nichts — die Datei bleibt im Browser.

## Wer sieht was

Die Trennung ist hier strenger als in den anderen Werkzeugen: **Meine Daten**
und **Info** stehen jedem Angemeldeten offen, *Meine Daten* zeigt ausschließlich
die eigenen Angaben.

Die Reiter **Trainer**, **Import** und **Einstellungen** hängen an der Stufe
**Administrieren** — nicht an *Bearbeiten*. An ihnen hängt die volle Sicht auf
die Bankverbindungen, deshalb lässt sich ein Bearbeiten-Recht vergeben, ohne die
IBANs aller Trainer zu öffnen. Geprüft wird bei jedem Zugriff **serverseitig**,
nicht nur im Browser versteckt.

Eine Ausnahme: das **Führerschein-Register** samt Sammel-PDF sehen zusätzlich
die Mitglieder der Gruppe *Führerschein Einsicht* — ansehen, nicht verwalten.
Fremde Führungszeugnisse bleiben den Administratoren vorbehalten.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

## Lokal starten

Über den Eintrag `trainerdaten` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8769/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

Anders als die meisten Werkzeuge der Familie bringt diese App **zwei eigene
Worker** mit: `submit-worker.js` nimmt die von den Trainern übermittelten Daten
entgegen, `cors-proxy-worker.js` vermittelt die dafür nötigen Aufrufe. Beide
werden **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare
veröffentlicht.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
