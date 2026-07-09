// Wortlaut des Trainerkodex, übernommen aus "Verhaltenskodex für Trainer_Funktionäre.docx"
// (1. SC 1911 Heilbad Heiligenstadt). Ursprünglich in der eigenständigen App
// trainerkodex (siehe [[project-trainerkodex]]), seit 1.6 Teil von Trainerdaten.
// Die Unterschriftszeile des Papierformulars ("Ort und Datum" / "Unterschrift
// Trainer*in / Funktionär*in") ist bewusst nicht übernommen — das übernimmt das
// digitale Formular (Name + Canvas-Unterschrift) in app.js.
//
// KODEX_IS_PLACEHOLDER steuert den Warn-Banner in der App (app.js/index.html).
//
// KODEX_VERSION wird bei jeder Bestätigung mit gespeichert (trainer[].kodexVersion).
// Bei inhaltlichen Änderungen am Kodex sollte diese Nummer erhöht werden — dient
// als Nachweis, welchen Stand jemand tatsächlich bestätigt hat. Muss manuell
// synchron zu KODEX_VERSION in submit-worker.js gehalten werden (kein gemeinsames
// Modul zwischen Worker und Frontend, gleiche Duplizierungs-Konvention wie an
// anderen Stellen dieser App).
const KODEX_IS_PLACEHOLDER = false;
const KODEX_VERSION = "1.0";

const KODEX_HTML = `
  <p class="muted">1. SC 1911 Heilbad Heiligenstadt — Verhaltenskodex für Trainer/Funktionäre</p>

  <h3>Respekt und Würde</h3>
  <p>Ich behandle alle Kinder und Jugendlichen mit Respekt und Wertschätzung. Ich verzichte
  auf jegliche Form von Diskriminierung und fördere ein positives, faires Miteinander.</p>

  <h3>Vertraulichkeit</h3>
  <p>Ich gehe verantwortungsvoll mit persönlichen Informationen der Kinder und Jugendlichen
  um. Sensible Daten werden vertraulich behandelt und nur mit Zustimmung weitergegeben.</p>

  <h3>Prävention von Gewalt und Missbrauch</h3>
  <p>Ich dulde keine Form von Gewalt, Missbrauch oder Diskriminierung. Ich melde
  Verdachtsfälle umgehend an die zuständigen Personen, um Kinder und Jugendliche zu
  schützen.</p>

  <h3>Grenzen wahren</h3>
  <p>Ich respektiere die körperlichen und emotionalen Grenzen von Kindern und
  Jugendlichen. Ich verhalte mich jederzeit angemessen und wahre professionelle
  Distanz.</p>

  <h3>Vorbildfunktion</h3>
  <p>Ich bin mir meiner Vorbildfunktion bewusst. Ich handle stets ehrlich,
  verantwortungsbewusst und integer - sowohl auf als auch neben dem Platz.</p>

  <h3>Kommunikation und Transparenz</h3>
  <p>Ich kommuniziere offen, ehrlich und respektvoll mit Kindern, Jugendlichen und
  Eltern. Ich biete regelmäßige Gespräche an, um das Vertrauen und Verständnis
  untereinander zu fördern.</p>

  <h3>Schutz und Sicherheit</h3>
  <p>Ich setze mich aktiv für ein sicheres Umfeld im Verein ein. Ich trage dazu bei,
  dass alle Kinder und Jugendlichen sich geschützt und respektiert fühlen.</p>
`;
