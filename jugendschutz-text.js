// Wortlaut des Kinder- und Jugendschutzkonzepts, Auszug aus "Konzeptpapier –
// Nachwuchsförderung" (1. SC 1911 Heilbad Heiligenstadt, erstellt C. Preiß, 03.2026).
// Gleiche Behandlung wie kodex-text.js (siehe dort) — eigenständige Bestätigung mit
// Unterschrift, aber inhaltlich ein anderes Dokument (Schutzkonzept statt Verhaltenskodex).
//
// JUGENDSCHUTZKONZEPT_IS_PLACEHOLDER steuert den Warn-Banner in der App (app.js/index.html).
//
// JUGENDSCHUTZKONZEPT_VERSION wird bei jeder Bestätigung mit gespeichert
// (trainer[].jugendschutzVersion). Bei inhaltlichen Änderungen am Konzept sollte diese
// Nummer erhöht werden — dient als Nachweis, welchen Stand jemand tatsächlich bestätigt
// hat. Muss manuell synchron zu JUGENDSCHUTZKONZEPT_VERSION in submit-worker.js gehalten
// werden (kein gemeinsames Modul zwischen Worker und Frontend, gleiche Duplizierungs-
// Konvention wie bei KODEX_VERSION).
const JUGENDSCHUTZKONZEPT_IS_PLACEHOLDER = false;
const JUGENDSCHUTZKONZEPT_VERSION = "1.0";

const JUGENDSCHUTZKONZEPT_HTML = `
  <p class="muted">1. SC 1911 Heilbad Heiligenstadt — Kinder- und Jugendschutzkonzept (Auszug aus dem Konzeptpapier Nachwuchsförderung)</p>

  <h3>1. Kinder- und Jugendschutzkonzept</h3>
  <p>Der 1. SC 1911 Heilbad Heiligenstadt bekennt sich klar zum Schutz von Kindern, Jugendlichen
  und jungen Erwachsenen vor jeder Form von Gewalt, Missbrauch, Diskriminierung und
  Vernachlässigung. Ziel ist es, ein sicheres, respektvolles und vertrauensvolles Umfeld zu
  schaffen, in dem sich alle Spieler*innen frei entwickeln können.</p>
  <p>In Zusammenarbeit mit unserer Partnerorganisation, der Villa Lampe, stellen wir sicher,
  dass Prävention, Aufklärung und Intervention verbindlich im Vereinsalltag verankert sind.</p>

  <h3>1.2 Zuständigkeit</h3>
  <p>Die Villa Lampe übernimmt die Funktion der unabhängigen Kinder- und
  Jugendschutzbeauftragten. Sie steht als externe und neutrale Anlaufstelle allen Beteiligten
  – Spieler*innen, Eltern, Trainer*innen und Funktionär*innen – bei Fragen, Unsicherheiten
  oder Verdachtsfällen zur Verfügung.</p>

  <h3>1.3 Aufgaben der Kinder- und Jugendschutzbeauftragten</h3>
  <p><strong>Schulungen:</strong> Regelmäßige Schulungen für Trainer*innen, Funktionär*innen
  und Ehrenamtliche zur Sensibilisierung und Prävention.</p>
  <p><strong>Informationsarbeit:</strong> Aufbau und Bereitstellung von Informationsangeboten
  für Eltern (z. B. Elternabende, Informationsmaterialien).</p>
  <p><strong>Meldewege:</strong> Sicherstellung klarer, transparenter und vertraulicher
  Meldewege bei Verdachtsfällen oder Grenzüberschreitungen.</p>
  <p><strong>Beratung:</strong> Unterstützung und Beratung von Trainer*innen, Eltern und
  Spieler*innen im Umgang mit sensiblen Situationen.</p>

  <h3>1.4 Präventionsmaßnahmen im Verein</h3>
  <p>Einführung eines verbindlichen Verhaltenskodex, der von allen Trainer*innen und
  Funktionär*innen unterzeichnet wird. Ein erweitertes Führungszeugnis liegt von unseren
  Trainer*innen dem Verein vor. Regelmäßige Sensibilisierung aller Beteiligten für das Thema
  Kinderschutz. Klare Kommunikation von Zuständigkeiten und Ansprechpartnern. Enge
  Zusammenarbeit mit der Villa Lampe zur kontinuierlichen Weiterentwicklung der
  Schutzmaßnahmen.</p>

  <h3>1.5 Evaluation und Weiterentwicklung</h3>
  <p>Das Kinder- und Jugendschutzkonzept wird regelmäßig überprüft und weiterentwickelt.
  Erfahrungen und Rückmeldungen von Trainer*innen, Eltern und Spieler*innen werden dabei
  aktiv berücksichtigt.</p>

  <h3>1.6 Vorgehen bei Verdachtsfällen (Meldeablauf)</h3>
  <p>Um in sensiblen Situationen sicher und verantwortungsvoll handeln zu können, gilt im
  Verein folgender verbindlicher Ablauf:</p>
  <p><strong>Schritt 1 – Wahrnehmen und ernst nehmen:</strong> Auffälligkeiten, Aussagen oder
  Verhaltensveränderungen werden ernst genommen. Keine vorschnellen Bewertungen oder
  eigenständigen Ermittlungen.</p>
  <p><strong>Schritt 2 – Dokumentation:</strong> Beobachtungen werden sachlich und neutral
  dokumentiert (Datum, Situation, Verhalten). Es werden keine Interpretationen oder
  Vermutungen festgehalten.</p>
  <p><strong>Schritt 3 – Weitergabe:</strong> Informationen werden zeitnah an die Villa Lampe
  (Kinder- und Jugendschutzbeauftragte) weitergegeben, alternativ an den Nachwuchsleiter.</p>
  <p><strong>Schritt 4 – Fachliche Bewertung:</strong> Die Villa Lampe übernimmt die fachliche
  Einschätzung des Falls und entscheidet über weitere Maßnahmen (z. B. Beratung, Einbindung
  externer Stellen wie Jugendamt).</p>
  <p><strong>Schritt 5 – Schutz des Kindes:</strong> Das Wohl des Kindes hat oberste Priorität,
  Vertraulichkeit und ein sensibler Umgang sind zwingend einzuhalten.</p>
  <p><strong>Wichtiger Hinweis:</strong> Trainer*innen und Funktionär*innen übernehmen keine
  eigenständige Aufklärung, sondern handeln ausschließlich im Rahmen dieses festgelegten
  Meldewegs.</p>
`;
