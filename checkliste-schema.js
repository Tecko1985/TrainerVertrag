// Read-only-Kopie von E:\TrainerCheckliste\checklist-schema.js (Labels für die
// Positionen der Checkliste "Trainerzu-/-abgang"), NUR für die Anzeige im
// Trainer-Selbstbedienungsbereich (Trainerdaten liest die eigenen Rohdaten der
// TrainerCheckliste per Gateway-Aktion "my-trainercheckliste-status" und braucht
// dafür die Klartext-Labels der items-Checkbox-IDs). Kein gemeinsames JS-Modul
// zwischen den beiden Apps -- bei Änderungen an der Papier-Vorlage muss diese
// Kopie von Hand nachgezogen werden (gleiche Duplizierungs-Konvention wie z.B.
// die Personalkosten-AE-Formel in pdf-utils.js).
const ZUGANG_SCHEMA = [
  { id: "zugang-1", label: "Checkliste aushändigen", subItems: null },
  { id: "zugang-2", label: "Einführung: Termin mit der Geschäftsstelle am Dienstag oder Donnerstag zu den Geschäftszeiten 17:00–19:00 Uhr ausmachen und aufsuchen", subItems: null },
  { id: "zugang-3", label: "Vertrag: aushändigen und unterschreiben lassen", subItems: null },
  { id: "zugang-4", label: "Mitgliedsantrag: ausfüllen und abgeben", subItems: null },
  {
    id: "zugang-5", label: "Schlüsselübergabe",
    subItems: [
      { id: "zugang-5-1", label: "Z-Schlüssel", textInput: true },
      { id: "zugang-5-2", label: "Schrankschlüssel Trainingsmaterialien", textInput: true },
      { id: "zugang-5-3", label: "Schlüssel zum Tablet Stadion Schiedsrichterkabine ____" },
      { id: "zugang-5-4", label: "Schlüssel zum Tablet Stelzenberg in Schiedsrichterkabine" },
      { id: "zugang-5-5", label: "100 EUR Pfand hinterlegen" }
    ]
  },
  {
    id: "zugang-6", label: "Mannschaftsfahrten",
    subItems: [
      { id: "zugang-6-1", label: "Fahrten mit den Kleinbussen der Sponsoren und den SCH Bussen inkl. Abwicklungen und Pflichten aufklären" },
      { id: "zugang-6-2", label: "Fahrtkostenabwicklung/-regelung" }
    ]
  },
  { id: "zugang-7", label: "Erweitertes Führungszeugnis: aushändigen", subItems: null },
  {
    id: "zugang-8", label: "Konzeptpapier Nachwuchsförderung",
    subItems: [
      { id: "zugang-8-1", label: "erläutern und aushändigen" },
      { id: "zugang-8-2", label: "den Verhaltenskodex für Trainer/Funktionäre unterschreiben" }
    ]
  },
  {
    id: "zugang-9", label: "Weitere Informationen über",
    subItems: [
      { id: "zugang-9-1", label: "Platz- und Hallenbelegungsplan" },
      { id: "zugang-9-2", label: "Trainingsgelände, Kabinen und Materialcontainer zeigen/erläutern (alle Trainingsstätten)" }
    ]
  },
  {
    id: "zugang-10", label: "",
    subItems: [
      { id: "zugang-10-1", label: "Trainergruppe/-chat einladen" },
      { id: "zugang-10-2", label: "Trainerversammlungen" },
      { id: "zugang-10-3", label: "Trainerschulungen" },
      { id: "zugang-10-4", label: "Trainingsphilosophie Deutschland" }
    ]
  },
  {
    id: "zugang-11", label: "Vorstellung",
    subItems: [
      { id: "zugang-11-1", label: "Nachwuchskoordinatoren" },
      { id: "zugang-11-2", label: "Zeugwart" },
      { id: "zugang-11-3", label: "Torwarttrainer" },
      { id: "zugang-11-4", label: "Athletiktrainer" },
      { id: "zugang-11-5", label: "Platzwart" }
    ]
  },
  { id: "zugang-12", label: "Zugangsdaten DFBnet: Zugang einrichten und erläutern", subItems: null },
  {
    id: "zugang-13", label: "SpielerPlus App",
    subItems: [
      { id: "zugang-13-1", label: "Rolle einrichten und erläutern" },
      { id: "zugang-13-2", label: "in den jeweiligen Bereich einladen" }
    ]
  },
  { id: "zugang-14", label: "Cloud: erläutern/zeigen/Zugang einrichten", subItems: null },
  { id: "zugang-15", label: "Social Media: Abläufe Spieltagsberichte/-fotos", subItems: null },
  {
    id: "zugang-16", label: "Zentralen Schrank für Trainingsmaterialien",
    subItems: [
      { id: "zugang-16-1", label: "Materialien zeigen" },
      { id: "zugang-16-2", label: "Umgang mit dem Schrank" }
    ]
  },
  {
    id: "zugang-17", label: "Materialliste für Trainingsmaterialien und Trikots",
    subItems: [
      { id: "zugang-17-1", label: "gemeinsam ausfüllen" },
      { id: "zugang-17-2", label: "Original für den Zeugwart" },
      { id: "zugang-17-3", label: "Kopie für den Trainer" }
    ]
  }
];

const ABGANG_SCHEMA = [
  { id: "abgang-1", label: "Geschäftsstelle informieren", subItems: null },
  { id: "abgang-2", label: "Checkliste aushändigen", subItems: null },
  { id: "abgang-3", label: "Letzter Tag: Termin mit der Geschäftsstelle am Dienstag oder Donnerstag zu den Geschäftszeiten 17:00–19:00 Uhr ausmachen und aufsuchen", subItems: null },
  {
    id: "abgang-4", label: "Schlüsselabgabe",
    subItems: [
      { id: "abgang-4-1", label: "Z-Schlüssel", textInput: true },
      { id: "abgang-4-2", label: "Schrankschlüssel Trainingsmaterialien", textInput: true },
      { id: "abgang-4-3", label: "Schlüssel zum Tablet Stadion Schiedsrichterkabine ____" },
      { id: "abgang-4-4", label: "Schlüssel zum Tablet Stelzenberg in Schiedsrichterkabine" },
      { id: "abgang-4-5", label: "100 EUR Pfand zurückgeben" }
    ]
  },
  {
    id: "abgang-5", label: "Abmeldung",
    subItems: [
      { id: "abgang-5-1", label: "Leitung Nachwuchsförderung" },
      { id: "abgang-5-2", label: "Nachwuchskoordinatoren" },
      { id: "abgang-5-3", label: "Nachwuchsförderung" },
      { id: "abgang-5-4", label: "Zeugwart" },
      { id: "abgang-5-5", label: "Torwarttrainer" },
      { id: "abgang-5-6", label: "Athletiktrainer" }
    ],
    infoText: "Platzwart wird informiert durch die Geschäftsstelle"
  },
  { id: "abgang-6", label: "Zugangsdaten DFBnet: Zugang sperren", subItems: null },
  { id: "abgang-7", label: "SpielerPlus: aus dem Bereich löschen", subItems: null },
  {
    id: "abgang-8", label: "",
    subItems: [
      { id: "abgang-8-1", label: "Information in Trainergruppe/-chat" },
      { id: "abgang-8-2", label: "Trainer/Betreuer entfernen" }
    ]
  },
  { id: "abgang-9", label: "Cloud: Zugang sperren/löschen", subItems: null },
  {
    id: "abgang-10", label: "Abgabe von Trainingsmaterialien und Trikots",
    subItems: [
      { id: "abgang-10-1", label: "Materialien/Trikots auf Vollständigkeit prüfen" },
      { id: "abgang-10-2", label: "Materialien/Trikots auf Schäden prüfen" },
      { id: "abgang-10-3", label: "Materialliste ausfüllen" },
      { id: "abgang-10-4", label: "Original für den Zeugwart" },
      { id: "abgang-10-5", label: "Kopie für den Trainer" }
    ]
  }
];
