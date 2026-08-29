// Cloudflare Worker: Trainer-Einreichungs-Endpunkt.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Worker "trainerdaten1"
// (URL: trainerdaten1.michel-brunner.workers.dev) -> diesen Code einfügen -> Deploy.
// NICHT zu verwechseln mit dem Worker "trainerdaten" (ohne "1") — das ist der
// separate cors-proxy-worker.js für den Admin-Modus, unbetroffen von diesem Code.
//
// NACH dem Deploy folgende Worker-Secrets in den Cloudflare-Einstellungen setzen
// (Workers -> trainerdaten1 -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL       = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Trainerdaten/trainerdaten.json
//   NEXTCLOUD_USERNAME  = admin
//   NEXTCLOUD_PASSWORD  = <App-Passwort aus Nextcloud>
//
// Der Worker schreibt KEIN Passwort in den Code — Credentials kommen ausschließlich
// aus den Worker-Secrets (verschlüsselt, nicht im Repo sichtbar).
//
// SEIT 1.6: Trainer müssen über das zentrale ToolsUebersicht-Konto angemeldet sein
// (Bearer-Token im Authorization-Header). Der Worker verifiziert das Token NICHT
// selbst, sondern delegiert an den landingpage-Worker (Aktion "me") — dafür ist
// ein SERVICE BINDING nötig (Dashboard -> Worker "trainerdaten1" -> Settings ->
// Bindings -> Add binding -> Service binding -> Ziel-Worker "landingpage",
// Variablenname "LANDINGPAGE"). Ein normaler fetch() an die *.workers.dev-URL der
// Landingpage wird von Cloudflare mit Error 1042 geblockt, weil beide Worker
// dieselbe workers.dev-Subdomain teilen (sieht aus wie eine potenzielle
// Endlosschleife, ist aber keine) — Service Bindings umgehen das komplett.
//
// API (POST-Body: { action, ... }, Authorization: Bearer <tu_session_token>):
//   { action: "submit", vorname, nachname, ... }  -> legt/aktualisiert IMMER genau
//     den Datensatz des eingeloggten Kontos (Nutzername kommt server-verifiziert,
//     nicht vom Client) -> { success:true, id }
//   { action: "my-submission" }                    -> { data: eigenerDatensatzOderNull }
//
// SEIT 1.1 (Dokumente, migriert aus Fahrtenbuch + neu Führungszeugnis):
//   { action: "upload-fuehrerschein", contentType, dataBase64, dateiName?, vorname?, nachname? }
//   { action: "upload-fuehrungszeugnis", contentType, dataBase64, dateiName?, vorname?, nachname? }
//     -> legt/ersetzt die EIGENE Datei ab (Eigentümer = verifizierter Nutzername, wie
//     bei "submit"); vorname/nachname optional fürs Stub-Matching, falls das Haupt-
//     formular noch nie ausgefüllt wurde -> { success:true, id }
//   { action: "my-fuehrerschein-file" }             -> rohe Datei-Bytes | 404
//   { action: "my-fuehrungszeugnis-file" }          -> rohe Datei-Bytes | 404
//     (seit 1.2: Trainer dürfen ihr eigenes Führungszeugnis jetzt auch selbst
//     ansehen — vorher gab es hierfür bewusst keine Aktion, siehe [[project-trainerdaten]])
//   { action: "list-fuehrerscheine" }  (Admin ODER Gruppe fuehrerschein-einsicht)
//     -> { trainer: [{id,vorname,nachname,fuehrerscheinHochgeladenAm}] }
//   { action: "fuehrerschein-file-for-owner", trainerId }  (Admin ODER Gruppe fuehrerschein-einsicht)
//     -> rohe Datei-Bytes | 404
//   { action: "fuehrungszeugnis-file-for-owner", trainerId }  (NUR Admin, siehe Datei-Kopf)
//     -> rohe Datei-Bytes | 404 -- von Personalakte genutzt (direkter "Führungszeugnis öffnen"-Button)
//
// SEIT 1.1 (Trainerlizenz-Dokument, gleiches Muster wie Führerschein/Führungszeugnis):
//   { action: "upload-trainerlizenz", contentType, dataBase64, dateiName?, vorname?, nachname? }
//   { action: "my-trainerlizenz-file" }             -> rohe Datei-Bytes | 404
//   { action: "trainerlizenz-file-for-owner", trainerId }  (NUR Admin, wie Führungszeugnis --
//     keine eigene Sichtgruppe angefragt) -> rohe Datei-Bytes | 404 -- von Personalakte genutzt
//
// SEIT 1.33 (hinterlegtes Dokument eines Trainers löschen, NUR Admin):
//   { action: "delete-fuehrerschein-for-owner", trainerId }
//   { action: "delete-fuehrungszeugnis-for-owner", trainerId }
//   { action: "delete-trainerlizenz-for-owner", trainerId }
//     -> entfernt Datei UND Status-Felder; die Person muss danach selbst neu hochladen
//     -> { success:true, id } | 404 (kein Dokument hinterlegt)
//     Auch beim Führerschein bewusst NUR Admin — die Gruppe fuehrerschein-einsicht darf
//     fremde Führerscheine ansehen (mayViewAllFuehrerscheine), das ist eine Sicht- und
//     keine Verwaltungsberechtigung. Genutzt vom Admin-Detail hier und von Personalakte.
//
// SEIT 1.4 (Trainer-Selbstauskunft: keine Lizenz vorhanden, Lizenzart, Gültig bis):
//   { action: "set-trainerlizenz-details", nichtVorhanden, art?, gueltigBis?, vorname?, nachname? }
//     -> setzt alle drei Felder auf dem EIGENEN Datensatz (immer alle zusammen, kein
//     Teil-Update; gleiches Stub-Matching wie bei den Uploads)
//     -> { success:true, trainerlizenzNichtVorhanden, trainerlizenzArt, trainerlizenzGueltigBis }
//     Ein tatsächlicher upload-trainerlizenz setzt NUR trainerlizenzNichtVorhanden
//     serverseitig automatisch wieder zurück (widersprüchlicher Zustand sonst
//     möglich) — Art/Gültig-bis beschreiben das Dokument selbst und bleiben bei
//     einem Re-Upload (z.B. neuer Scan derselben Lizenz) unangetastet.
//
// SEIT 1.2 (Freigabe für die Kontaktliste des Vereins, App "kontakte"):
//   Bedient wird das seit 1.3 NICHT mehr hier, sondern im Tab „Mein Konto" der
//   ToolsUebersicht — die ruft diese beiden Aktionen direkt auf (gleicher Direktweg
//   wie die Personalakte bei den Dokumenten). Gespeichert bleibt die Freigabe hier,
//   weil sie sich auf DIESE Felder bezieht.
//   { action: "my-kontakt-freigabe" } -> { vorhanden, kontaktFreigabe, werte }
//     schmaler Leseweg: eigene Freigabe + eigene Kontaktwerte (Name, Telefon, E-Mail,
//     Anschrift), NIE iban/bank/geburtsdatum/Dokumente. Bewusst nicht "my-submission",
//     das den ganzen Datensatz liefert. Legt keinen Datensatz an.
//   { action: "kontakt-freigabe-speichern", name, telefon, email, adresse, vorname?, nachname? }
//     -> setzt kontaktFreigabe = {name, telefon, email, adresse, aktualisiertAm} auf dem
//     EIGENEN Datensatz (immer alle vier zusammen, kein Teil-Update; gleiches Stub-
//     Matching wie bei den Uploads)
//     -> { success:true, kontaktFreigabe }
//     `name` ist der Hauptschalter: ohne ihn erscheint die Person überhaupt nicht in der
//     Liste, auch wenn die anderen drei gesetzt sind (ein Eintrag ohne Namen ist kein
//     Kontakt). Gelesen wird das Feld NICHT hier, sondern von der Gateway-Aktion
//     `kontakte-liste` in ToolsUebersichts admin-worker.js, die serverseitig auf die
//     freigegebenen Felder filtert.
//     Bewusst NICHT in NUR_VERTRAGSPFLICHTIG_ACTIONS — Begründung am Handler.
//
// SEIT 1.6 (Trainerkodex, migriert aus dem eigenständigen trainerkodex-Tool, siehe
// [[project-trainerkodex]]): Verhaltenskodex lesen + bestätigen ist jetzt Teil von
// Trainerdaten statt einer eigenen App/Kachel.
//   { action: "submit-kodex", signatureDataUrl, vorname?, nachname? } -> setzt
//     kodexBestaetigtAm (nur bei echter Signatur, gleiche Konvention wie
//     unterschriftAm bei "submit"), kodexSignatureDataUrl, kodexVersion (server-
//     seitig fest, nicht vom Client) auf dem EIGENEN Datensatz; gleiches Stub-
//     Matching wie bei den Dokument-Uploads (resolveOwnTrainerRecord)
//     -> { success:true, kodexBestaetigtAm }
//     Kein neuer Lese-Weg nötig -- "my-submission" liefert den ganzen (jetzt um
//     die drei Kodex-Felder erweiterten) Datensatz bereits mit.
//
// SEIT 1.6 (Import): Der Admin-Text-Import kann für Namen ohne Konto-Treffer einen
// unvollständigen Stub-Datensatz anlegen (nur vorname/nachname/lizenz/pauschale,
// KEIN username-Feld). Meldet sich diese Person später selbst an, findet
// handleSubmit() unten keinen Treffer per username, sucht darum zusätzlich per
// exaktem Namensabgleich unter den username-losen Stubs und ergänzt den
// gefundenen Datensatz (Lizenz/Pauschale bleiben erhalten) statt einen zweiten
// anzulegen. Kein Treffer -> normales Neuanlegen wie zuvor.
//
// SEIT 1.10 (Trainervertrag ansehen + unterschreiben): Das vom lokalen Skript
// generate-pdfs.ps1 erzeugte Vertrags-PDF wird pro Trainer nach vertraege/<Jahr>/
// <Vorname>_<Nachname>/Trainervertrag.pdf hochgeladen (durch das Skript selbst, nicht
// diesen Worker); der relative Pfad steht im Datensatz als vertragPdfPfad, dazu
// vertragPdfBereitgestelltAm.
//   { action: "my-vertrag-file" }            -> eigenes Original-Vertrags-PDF | 404
//   { action: "my-vertrag-signiert-file" }   -> eigenes unterschriebenes PDF | 404
//   { action: "submit-vertrag-unterschrift", dataBase64, signatureDataUrl? }
//     -> legt das fertig unterschriebene PDF (Original + im Browser angehängte
//        Unterschriftenseite) als Trainervertrag_unterschrieben.pdf in DENSELBEN Ordner
//        wie das Original (Pfad -> vertragSigniertPfad) und setzt vertragUnterschriebenAm
//        (+ kleine Signatur-Vorschau fürs Admin-Detail). Setzt einen bereits zugewiesenen
//        Vertrag voraus (sonst 400), legt nie selbst einen (Stub-)Datensatz an.
//        -> { success:true, vertragUnterschriebenAm }
//   Fremde Verträge sieht der Admin direkt per WebDAV (kein "-for-owner"-Endpunkt).

const ALLOWED_ORIGINS = [
  "http://localhost:8769",
  "http://localhost:8783", // Personalakte (Dev-Server) -- ruft fuehrerschein-/fuehrungszeugnis-file-for-owner direkt hier ab
  "http://localhost:8770", // ToolsUebersicht (Dev-Server) -- Karte "Kontaktliste des Vereins" im Tab "Mein Konto"
  "https://sc1911heiligenstadt.github.io",
  "https://tecko1985.github.io" // alte Adresse bis 2026-08: PWAs mit eigenem SW-Cache laufen dort noch
];

// Dokument-Uploads (seit 1.1, Führerschein migriert aus Fahrtenbuch + neu Führungszeugnis):
// je Trainer-id (nicht username, siehe [[project-trainerdaten]] — Stub-Trainer aus dem
// Personalkosten-Import haben keinen username) genau eine Datei je Typ, Re-Upload
// überschreibt. Ablage in Geschwister-Unterordnern von trainerdaten.json.
const DOCUMENT_TYPES = {
  fuehrerschein: {
    subdir: "fuehrerscheine",
    uploadedAtField: "fuehrerscheinHochgeladenAm",
    nameField: "fuehrerscheinDateiName",
    ctypeField: "fuehrerscheinContentType"
  },
  fuehrungszeugnis: {
    subdir: "fuehrungszeugnisse",
    uploadedAtField: "fuehrungszeugnisEingereichtAm",
    nameField: "fuehrungszeugnisDateiName",
    ctypeField: "fuehrungszeugnisContentType"
  },
  trainerlizenz: {
    subdir: "trainerlizenzen",
    uploadedAtField: "trainerlizenzHochgeladenAm",
    nameField: "trainerlizenzDateiName",
    ctypeField: "trainerlizenzContentType"
  }
};
// Muss zum Client-Cap MAX_FILE_BYTES in config.js passen (gleiche Duplizierungs-
// Konvention wie im migrierten Fahrtenbuch-Feature).
const DOC_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Trainervertrag-PDFs (seit 1.10): Das lokale Skript generate-pdfs.ps1 legt pro Vertrag
// einen menschenlesbaren Ordner vertraege/<Jahr>/<Vorname>_<Nachname>/ in Nextcloud an
// (Namen ASCII-normalisiert) und speichert den relativen Pfad im Datensatz als
// vertragPdfPfad. Der Trainer unterschreibt im Browser (pdf-lib haengt eine
// Unterschriftenseite an); das fertige PDF landet als Trainervertrag_unterschrieben.pdf
// im SELBEN Ordner (Pfad in vertragSigniertPfad). Gespeicherte Pfade statt fester Ordner
// -> robust bei Namensgleichheit, und der Worker muss den Pfad nie selbst raten.

// Muss manuell synchron zu KODEX_VERSION in kodex-text.js gehalten werden (kein
// gemeinsames Modul zwischen Worker und Frontend, gleiche Duplizierungs-Konvention
// wie an anderen Stellen dieser App). Server-autoritativ (wie username), damit ein
// veralteter Client keine neuere Version behaupten kann als tatsächlich gezeigt.
// 1.1 (2026-08-21): nur der Vereinsname im Wortlaut korrigiert -- "1. SC 1911 Heiligenstadt
// e.V." statt "1. SC 1911 Heilbad Heiligenstadt". Inhaltlich unveraendert. Alte
// Zusagen bleiben auf 1.0 stehen, niemand muss neu bestaetigen.
const KODEX_VERSION = "1.1";

// ⚠️ NUR NOCH RÜCKFALLEBENE (seit 2026-08-29). Die geltende Fassungsnummer steht
// in der Kinderschutz-App und wird bei jeder Bestaetigung frisch von dort gelesen
// (ksGeltendeKonzeptVersion weiter unten). Diese Konstante greift nur, wenn dort
// noch nichts gespeichert wurde oder die Datei nicht erreichbar ist.
//
// ⚠️ Die frueher hier stehende Regel "muss manuell synchron zu
// jugendschutz-text.js gehalten werden" gilt NICHT mehr — genau diese
// Handarbeit ist mit dem Umzug entfallen. Wer die Fassung aendern will, aendert
// sie in der Kinderschutz-App.
//
// 1.1 (2026-08-21): nur der Vereinsname im Wortlaut korrigiert. Alte Zusagen
// bleiben auf 1.0 stehen.
const JUGENDSCHUTZKONZEPT_VERSION_FALLBACK = "1.1";

// Die Ablage der Kinderschutz-App. Dieser Worker hat dieselben Nextcloud-Zugaenge
// wie das Gateway und liest die Datei direkt — ein Umweg ueber das Service
// Binding waere ein zweiter Weg zum selben Inhalt.
const KINDERSCHUTZ_JSON_URL = "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F\u00f6rderung/Tools/Kinderschutz/kinderschutz.json";

// Die GERADE GELTENDE Fassungsnummer des Konzepts.
//
// ⚠️ Kein stiller Rueckfall bei einem Netzwerkfehler mitten in der Bestaetigung:
// waere die Kinderschutz-App kurz weg, stuende in der Akte "1.1", obwohl der
// Trainer 2.0 gelesen hat. Deshalb gibt diese Funktion null zurueck, und der
// Aufrufer bricht ab. Der Rueckfall gilt nur fuer den Fall, dass dort ueberhaupt
// noch kein Konzept gespeichert ist — dann ist 1.1 auch wirklich die geltende
// Fassung, weil die App genau diese anzeigt.
async function ksGeltendeKonzeptVersion(authHeader) {
  let resp;
  try {
    resp = await fetch(KINDERSCHUTZ_JSON_URL, { headers: { Authorization: authHeader } });
  } catch (_) {
    return null;
  }
  if (resp.status === 404) return JUGENDSCHUTZKONZEPT_VERSION_FALLBACK;
  if (!resp.ok) return null;
  let doc;
  try { doc = await resp.json(); } catch (_) { return null; }
  const v = doc && doc.konzept && doc.konzept.version;
  return v ? String(v) : JUGENDSCHUTZKONZEPT_VERSION_FALLBACK;
}

// Gruppe, deren Mitglieder (plus Admin) alle eingereichten Führerschein-Kopien im
// Register einsehen dürfen — dieselbe Gruppe, die vorher im Fahrtenbuch galt.
const FS_VIEW_GROUP_ID = "fuehrerschein-einsicht";

// Alles rund um Trainervertrag und Trainer-Dokumente: nur für Vertragspflichtige
// (Gruppe "Trainer" ODER vertragBenoetigt-Flag, siehe verifySession). Wer keinen
// Vertrag braucht, hinterlegt hier ausschließlich Kontaktdaten und bekommt die
// zugehörigen Karten gar nicht erst angezeigt — ein Request darauf kann nur aus einem
// veralteten Client-Cache oder von Hand kommen und wird mit 403 abgewiesen.
//
// BEWUSST NICHT in dieser Liste:
//   my-submission/submit  -> jeder reicht seine eigenen Daten ein; handleSubmit
//                            unterscheidet die beiden Umfänge selbst.
//   list-fuehrerscheine, *-file-for-owner -> Fremdeinsicht in die Dokumente ANDERER,
//                            gegated auf Admin bzw. Gruppe fuehrerschein-einsicht. Das
//                            ist eine Sichtberechtigung und hat mit der eigenen
//                            Vertragspflicht nichts zu tun: ein Mitglied der
//                            Einsichtsgruppe darf das Register lesen, auch wenn es
//                            selbst nie einen Trainervertrag bekommt.
//   delete-*-for-owner    -> aus demselben Grund nicht hier: Fremdverwaltung der
//                            Dokumente ANDERER, gegated auf Admin (siehe
//                            handleDeleteDocumentForOwner). Ein Admin ohne eigene
//                            Vertragspflicht muss trotzdem löschen dürfen.
const NUR_VERTRAGSPFLICHTIG_ACTIONS = new Set([
  "upload-fuehrerschein", "upload-fuehrungszeugnis", "upload-trainerlizenz",
  "my-fuehrerschein-file", "my-fuehrungszeugnis-file", "my-trainerlizenz-file",
  "set-trainerlizenz-details", "submit-kodex", "submit-jugendschutzkonzept",
  "my-vertrag-file", "my-vertrag-signiert-file", "submit-vertrag-unterschrift"
]);

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Uint8Array -> base64 (Gegenstück zu base64ToBytes) für das Ausliefern einer
// ausgelagerten Unterschrift als PNG-DataURL an handleMySubmission.
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Nextcloud-Verzeichnis, das trainerdaten.json enthält — Dokument-Unterordner liegen
// als Geschwister direkt daneben.
function trainerdatenDir(env) {
  return env.NEXTCLOUD_URL.slice(0, env.NEXTCLOUD_URL.lastIndexOf("/"));
}

// Unterschriften liegen (seit dem Auslagern aus der JSON) als eigene PNG-Binärobjekte
// in Geschwister-Unterordnern von trainerdaten.json, je Trainer-id genau eine Datei —
// exakt dasselbe Ablagemuster wie die Dokument-Uploads (siehe DOCUMENT_TYPES/
// handleUploadDocument), nur dass die Signatur aus dem Formular statt aus einem Upload
// kommt. Grund: 99 % der alten JSON-Größe waren inline base64-Unterschriften, die bei
// jedem Speichern komplett mitübertragen wurden.
const SIGNATURE_SUBDIRS = {
  haupt:        "unterschriften",
  kodex:        "kodex-unterschriften",
  jugendschutz: "jugendschutz-unterschriften"
};

// Schreibt eine Unterschrift (validierte PNG-DataURL) nach <subdir>/<trainerId>.
// MKCOL-Retry-einmal falls der Unterordner noch fehlt (wie handleUploadDocument).
// Wirft bei Nextcloud-Fehler, damit der Aufrufer VOR dem JSON-PUT abbrechen kann.
async function putSignatureFile(env, authHeader, subdir, trainerId, dataUrl) {
  const bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const dir = trainerdatenDir(env) + "/" + subdir;
  const fileUrl = dir + "/" + trainerId;
  const headers = { Authorization: authHeader, "Content-Type": "image/png" };
  let resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  if (resp.status === 404 || resp.status === 409) {
    await fetch(dir, { method: "MKCOL", headers: { Authorization: authHeader } });
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  }
  if (!resp.ok) throw new Error(`Nextcloud PUT ${resp.status}`);
}

// Liest eine ausgelagerte Unterschrift und gibt sie als PNG-DataURL zurück (oder "").
// Nur für handleMySubmission, damit der eigene Datensatz wie früher inline ausgeliefert
// wird und der Trainer-Client (SigPad-Vorbefüllung, Receipt) unverändert bleibt — es ist
// nur die eine eigene Signatur, kein Größenproblem.
async function getSignatureDataUrl(env, authHeader, subdir, trainerId) {
  const fileUrl = trainerdatenDir(env) + "/" + subdir + "/" + trainerId;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) { return ""; }
  if (!resp.ok) return "";
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length === 0) return "";
  return "data:image/png;base64," + bytesToBase64(buf);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.LANDINGPAGE) {
      return json({ error: "Service Binding 'LANDINGPAGE' fehlt (siehe Datei-Kopf)" }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungültiges JSON" }, 400, corsHeaders);
    }

    const session = await verifySession(env, request.headers.get("Authorization") || "");
    if (!session) {
      return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
    }

    if (NUR_VERTRAGSPFLICHTIG_ACTIONS.has(body.action) && !session.vertragspflichtig) {
      return json({ error: "Nicht berechtigt: für dieses Konto ist kein Trainervertrag vorgesehen" }, 403, corsHeaders);
    }

    if (body.action === "my-submission") {
      return handleMySubmission(session, env, corsHeaders);
    }
    if (body.action === "submit") {
      return handleSubmit(body, session, env, corsHeaders);
    }
    if (body.action === "upload-fuehrerschein") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrerschein);
    }
    if (body.action === "upload-fuehrungszeugnis") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrungszeugnis);
    }
    if (body.action === "my-fuehrerschein-file") {
      return handleMyFuehrerscheinFile(session, env, corsHeaders);
    }
    if (body.action === "my-fuehrungszeugnis-file") {
      return handleMyFuehrungszeugnisFile(session, env, corsHeaders);
    }
    if (body.action === "list-fuehrerscheine") {
      return handleListFuehrerscheine(session, env, corsHeaders);
    }
    if (body.action === "fuehrerschein-file-for-owner") {
      return handleFuehrerscheinFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "fuehrungszeugnis-file-for-owner") {
      return handleFuehrungszeugnisFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "upload-trainerlizenz") {
      return handleUploadDocument(body, session, env, corsHeaders, DOCUMENT_TYPES.trainerlizenz);
    }
    if (body.action === "my-trainerlizenz-file") {
      return handleMyTrainerlizenzFile(session, env, corsHeaders);
    }
    if (body.action === "trainerlizenz-file-for-owner") {
      return handleTrainerlizenzFileForOwner(body, session, env, corsHeaders);
    }
    if (body.action === "set-trainerlizenz-details") {
      return handleSetTrainerlizenzDetails(body, session, env, corsHeaders);
    }
    if (body.action === "kontakt-freigabe-speichern") {
      return handleSetKontaktFreigabe(body, session, env, corsHeaders);
    }
    if (body.action === "my-kontakt-freigabe") {
      return handleMyKontaktFreigabe(session, env, corsHeaders);
    }
    if (body.action === "delete-fuehrerschein-for-owner") {
      return handleDeleteDocumentForOwner(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrerschein);
    }
    if (body.action === "delete-fuehrungszeugnis-for-owner") {
      return handleDeleteDocumentForOwner(body, session, env, corsHeaders, DOCUMENT_TYPES.fuehrungszeugnis);
    }
    if (body.action === "delete-trainerlizenz-for-owner") {
      return handleDeleteDocumentForOwner(body, session, env, corsHeaders, DOCUMENT_TYPES.trainerlizenz);
    }
    if (body.action === "submit-kodex") {
      return handleSubmitKodex(body, session, env, corsHeaders);
    }
    if (body.action === "submit-jugendschutzkonzept") {
      return handleSubmitJugendschutzkonzept(body, session, env, corsHeaders);
    }
    if (body.action === "my-vertrag-file") {
      return handleMyVertragFile(session, env, corsHeaders, false);
    }
    if (body.action === "my-vertrag-signiert-file") {
      return handleMyVertragFile(session, env, corsHeaders, true);
    }
    if (body.action === "submit-vertrag-unterschrift") {
      return handleSubmitVertragUnterschrift(body, session, env, corsHeaders);
    }
    return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
  }
};

// Delegiert die Token-Prüfung an den landingpage-Worker (Aktion "me") statt sie
// hier zu duplizieren — bei Netzfehler oder abgelehntem Token sicher zu (kein Zugriff).
async function verifySession(env, authHeader) {
  if (!authHeader) return null;
  try {
    const resp = await env.LANDINGPAGE.fetch("https://landingpage/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ action: "me" })
    });
    if (!resp.ok) return null;
    const me = await resp.json();
    if (!me || typeof me.username !== "string" || !me.username) return null;
    return {
      username: me.username,
      vorname: me.vorname || null,
      nachname: me.nachname || null,
      isAdmin: !!me.isAdmin,
      groupIds: Array.isArray(me.groupIds) ? me.groupIds : [],
      // Braucht diese Person einen Trainervertrag (Gruppe "Trainer" ODER
      // vertragBenoetigt-Flag)? Entscheidet, ob sie Bankverbindung/Nebentätigkeit/
      // Unterschrift/Dokumente überhaupt einreichen darf -- siehe handleSubmit.
      //
      // Bewusst `!== false` statt `!!`: Ein landingpage-Worker, der das Feld noch
      // nicht kennt, liefert undefined. Mit `!!` wäre dann SCHLAGARTIG JEDER Trainer
      // "nicht vertragspflichtig" und verlöre Bankverbindung und Vertrag. So ist der
      // unbekannte Fall der bisherige Vollzugriff, und nur ein Server, der die Frage
      // wirklich beantwortet hat, schränkt ein -- Deploy-Reihenfolge der beiden
      // Worker damit egal (gleiche Übergangstoleranz wie bei der Signatur-Auslagerung).
      vertragspflichtig: me.vertragspflichtig !== false
    };
  } catch (_) {
    return null;
  }
}

async function loadAppData(env, authHeader) {
  let appData = { version: 1, trainer: [] };
  let getResp;
  try {
    getResp = await fetch(env.NEXTCLOUD_URL, {
      method: "GET",
      headers: { Authorization: authHeader }
    });
  } catch (e) {
    throw new NextcloudError("Nextcloud nicht erreichbar — bitte später erneut versuchen");
  }
  if (getResp.status !== 404) {
    if (!getResp.ok) {
      throw new NextcloudError(`Nextcloud-Lesefehler (HTTP ${getResp.status}) — bitte später erneut versuchen`);
    }
    const text = await getResp.text();
    if (text.trim()) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        throw new NextcloudError("Bestandsdatei ist beschädigt — Einreichung abgebrochen, bitte Admin informieren");
      }
      if (!parsed || !Array.isArray(parsed.trainer)) {
        throw new NextcloudError("Bestandsdatei hat ein unerwartetes Format — Einreichung abgebrochen, bitte Admin informieren");
      }
      appData = parsed;
    }
  }
  return appData;
}

class NextcloudError extends Error {}

async function handleMySubmission(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const mine = appData.trainer.find(t => t.username === session.username) || null;
  // Eigene Unterschrift (jetzt ausgelagert) wieder inline anhängen, damit der Trainer-
  // Client sie wie bisher ins SigPad/den Bestätigungs-Screen laden kann — nur die eine
  // eigene Signatur, kein Größenproblem.
  if (mine && mine.signaturVorhanden) {
    mine.signatureDataUrl = await getSignatureDataUrl(env, authHeader, SIGNATURE_SUBDIRS.haupt, mine.id);
  }
  return json({ data: mine }, 200, corsHeaders);
}

// Zwei Einreichungsarten, unterschieden durch session.vertragspflichtig (server-
// verifiziert aus dem Gateway, siehe verifySession):
//   vertragspflichtig  -> volle Trainerdaten (Bankverbindung, Anlage 1, Unterschrift)
//   nicht pflichtig    -> NUR Kontaktdaten (z.B. Geschäftsführung), damit der Verein
//                         die Person erreichen kann. IBAN/Nebentätigkeit/Unterschrift
//                         sieht sie im Formular gar nicht.
async function handleSubmit(body, session, env, corsHeaders) {
  const vertragspflichtig = session.vertragspflichtig;

  // Pflichtfelder prüfen. Für Nicht-Vertragspflichtige tritt die E-Mail an die Stelle
  // von IBAN/Nebentätigkeit: Kontaktaufnahme ist der einzige Zweck ihres Datensatzes,
  // ein Eintrag ohne E-Mail wäre wertlos. Gleiche Bedingung wie das Ampel-Badge im
  // Dashboard (handleMyTrainerdatenStatus) -- Formular und Ampel dürfen nie
  // auseinanderlaufen.
  const pflichtfelder = vertragspflichtig
    ? ["vorname", "nachname", "iban", "nebentaetigkeit"]
    : ["vorname", "nachname", "email"];
  for (const field of pflichtfelder) {
    if (!body[field] || !String(body[field]).trim()) {
      return json({ error: `Pflichtfeld fehlt: ${field}` }, 400, corsHeaders);
    }
  }
  if (vertragspflichtig && body.nebentaetigkeit === "andere" && !String(body.nebentaetigkeitBetrag || "").trim()) {
    return json({ error: "Pflichtfeld fehlt: nebentaetigkeitBetrag" }, 400, corsHeaders);
  }

  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  // Aktuelle Datei laden. NUR 404 (noch nicht vorhanden) oder leere Datei
  // bedeuten "neue Liste" — jeder andere Fehler bricht ab, sonst würde der
  // PUT unten den kompletten Bestand mit nur dem neuen Eintrag überschreiben.
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const fields = {
    vorname:      String(body.vorname  || "").trim(),
    nachname:     String(body.nachname || "").trim(),
    geburtsdatum: String(body.geburtsdatum || ""),
    strasse:      String(body.strasse  || "").trim(),
    plz:          String(body.plz      || "").trim(),
    ort:          String(body.ort      || "").trim(),
    telefon:      String(body.telefon  || "").trim(),
    email:        String(body.email    || "").trim().toLowerCase(),
    // Vertragsdaten NUR von Vertragspflichtigen übernehmen. Ein Nicht-Trainer sieht
    // diese Felder gar nicht — kämen sie trotzdem an (veralteter Client im Cache, von
    // Hand abgesetzter Request), werden sie hier verworfen statt gespeichert. Ohne
    // diesen Zweig wäre die Trennung reine Frontend-Kosmetik.
    iban:         vertragspflichtig ? String(body.iban     || "").replace(/\s+/g, "").toUpperCase() : "",
    bankname:     vertragspflichtig ? String(body.bankname || "").trim() : "",
    bic:          vertragspflichtig ? String(body.bic      || "").trim().toUpperCase() : "",
    // Anlage 1 (§3 Nr.26 EStG): nur die beiden erlaubten Werte durchlassen
    nebentaetigkeit: (vertragspflichtig && (body.nebentaetigkeit === "keine" || body.nebentaetigkeit === "andere"))
      ? body.nebentaetigkeit : "",
    nebentaetigkeitBetrag: vertragspflichtig ? String(body.nebentaetigkeitBetrag || "").trim() : "",
    // Server-verifizierter Schnappschuss der Vertragspflicht zum Einreichzeitpunkt.
    // Steht im Datensatz, weil Admin-Liste und generate-pdfs.ps1 nur die JSON sehen und
    // sonst nicht wissen könnten, dass dieser Eintrag nie einen Vertrag bekommen soll.
    // Beide Leser prüfen bewusst `!== false` — die Bestandsdatensätze von vor diesem
    // Feld haben undefined und müssen weiter Verträge bekommen.
    vertragspflichtig
  };

  // Unterschrift wird NICHT mehr inline in der JSON gespeichert, sondern als eigenes
  // PNG-Binärobjekt (siehe putSignatureFile) — nur ein Existenz-Flag bleibt im Datensatz.
  // Von Nicht-Vertragspflichtigen wird sie verworfen: kein Vertrag, keine Unterschrift.
  const sig = (vertragspflichtig &&
               typeof body.signatureDataUrl === "string" &&
               /^data:image\/png;base64,/.test(body.signatureDataUrl))
    ? body.signatureDataUrl : "";

  // Upsert per verifiziertem Nutzernamen (nicht per client-gemeldeter id) — pro
  // Konto gibt es damit immer genau einen Datensatz, ein erneutes Absenden
  // aktualisiert ihn statt einen zweiten anzulegen.
  let existingIdx = appData.trainer.findIndex(t => t.username === session.username);

  // Kein Konto-Treffer? Dann nach einem unvollständigen Stub-Datensatz aus dem
  // Admin-Text-Import suchen (kein username gesetzt) — exakter Namensabgleich,
  // bewusst ohne den fuzzy Nachname-Fallback aus dem Client-Import, um nicht
  // versehentlich in den Datensatz einer anderen Person zu schreiben. Treffer
  // wird ergänzt (behält Lizenz/Pauschale aus dem Import) statt dupliziert.
  if (existingIdx === -1) {
    const nl = (fields.vorname + " " + fields.nachname).toLowerCase();
    existingIdx = appData.trainer.findIndex(t =>
      !t.username && `${t.vorname || ""} ${t.nachname || ""}`.toLowerCase() === nl
    );
  }

  // "Eingereicht" (admin-seitig angezeigtes Datum) heißt: es liegt eine echte
  // Unterschrift vor — nicht bloß "Datensatz existiert" oder "wurde bearbeitet".
  // Ein Import-Stub oder ein Submit ohne Signatur bekommt daher kein Datum;
  // eine bereits vorhandene Signaturzeit wird bei leerer Signatur nicht gelöscht.
  const nowIso = new Date().toISOString();
  const unterschriftPatch = sig ? { unterschriftAm: nowIso, signaturVorhanden: true } : {};

  let resultId;
  if (existingIdx !== -1) {
    appData.trainer[existingIdx] = {
      ...appData.trainer[existingIdx],
      ...fields,
      username: session.username,
      // Daten haben sich möglicherweise geändert — ein bereits erzeugter Vertrag ist damit veraltet.
      vertragsGeneriert: false,
      // Ein evtl. manuell gesetzter/eingefrorener Status-Override (Admin-Detail bzw.
      // "Vertrag generieren") wird bei einer neuen Einreichung zurückgesetzt, sonst
      // bliebe z.B. "generiert" stehen und der veraltete Vertrag fiele nie auf —
      // leer = automatische Ableitung greift wieder (Badge "Ausstehend").
      status: "",
      // Der zugewiesene/unterschriebene Trainervertrag (vertragPdfBereitgestelltAm/
      // vertragUnterschriebenAm/vertragSigniertPfad) wird hier BEWUSST NICHT
      // angetastet: ein Vertrag gilt fuers Jahr, geaenderte Stammdaten machen ihn nicht
      // ungueltig. Geaenderte Daten sind erst fuer einen spaeter bewusst neu
      // ausgestellten Vertrag relevant (generate-pdfs.ps1 -Zuweisen -Alle).
      ...unterschriftPatch
    };
    resultId = appData.trainer[existingIdx].id;
  } else {
    const newEntry = {
      id: crypto.randomUUID(),
      username: session.username,
      ...fields,
      erstelltAm: nowIso,
      vertragsGeneriert: false,
      ...unterschriftPatch
    };
    appData.trainer.push(newEntry);
    resultId = newEntry.id;
  }

  // Unterschrift zuerst als eigene Datei ablegen — schlägt das fehl, wird die JSON
  // (unten) bewusst NICHT geschrieben, damit signaturVorhanden nie ohne die Datei
  // dasteht. Bei leerer Signatur bleibt eine evtl. vorhandene Datei unangetastet.
  if (sig) {
    try {
      await putSignatureFile(env, authHeader, SIGNATURE_SUBDIRS.haupt, resultId, sig);
    } catch (e) {
      return json({ error: "Speicherfehler (Unterschrift): " + e.message }, 502, corsHeaders);
    }
  }

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, id: resultId }, 201, corsHeaders);
}

// Eigenen Trainer-Datensatz per verifiziertem Nutzernamen finden. Ohne Treffer (und
// falls vorname/nachname mitgeschickt werden) zusätzlich ein unvollständiger Stub aus
// dem Personalkosten-Import per exaktem Namensabgleich versucht (gleiche Konvention
// wie handleSubmit oben) — verhindert einen doppelten Datensatz, falls ein Trainer ein
// Dokument hochlädt, bevor er das Hauptformular ausgefüllt hat. Ohne Treffer wird ein
// neuer Minimal-Datensatz angelegt. Gibt { idx } zurück, idx zeigt in appData.trainer.
function resolveOwnTrainerRecord(appData, session, vorname, nachname) {
  let idx = appData.trainer.findIndex(t => t.username === session.username);
  if (idx === -1 && vorname && nachname) {
    const nl = (vorname + " " + nachname).toLowerCase();
    idx = appData.trainer.findIndex(t =>
      !t.username && `${t.vorname || ""} ${t.nachname || ""}`.toLowerCase() === nl
    );
    // Stub aus dem Personalkosten-Import übernommen -> mit dem verifizierten
    // Nutzernamen verknüpfen (wie handleSubmit), sonst finden my-fuehrerschein-file/
    // my-fuehrungszeugnis-file und my-submission (Suche per username) die gerade
    // hochgeladene Datei nie wieder, und beim nächsten Besuch fehlt der Doku-Status.
    if (idx !== -1) appData.trainer[idx].username = session.username;
  }
  if (idx !== -1) return { idx };
  const newEntry = {
    id: crypto.randomUUID(),
    username: session.username,
    vorname: vorname || "",
    nachname: nachname || "",
    erstelltAm: new Date().toISOString(),
    vertragsGeneriert: false
  };
  appData.trainer.push(newEntry);
  return { idx: appData.trainer.length - 1 };
}

// Lädt Führerschein ODER Führungszeugnis hoch (docType bestimmt Unterordner/Feldnamen).
// Eigentümer ist IMMER der verifizierte Nutzername (wie bei "submit") — nie aus dem
// Body vertraut. Datei wird als separates Binärobjekt neben trainerdaten.json abgelegt
// (nicht wie die Signatur inline in der JSON, da hier deutlich größere Scans/Fotos
// erwartet werden), nur die Metadaten landen in appData.trainer.
async function handleUploadDocument(body, session, env, corsHeaders, docType) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > DOC_MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const trainerId = appData.trainer[idx].id;

  const dir = trainerdatenDir(env) + "/" + docType.subdir;
  const fileUrl = dir + "/" + trainerId;
  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    // 404/409 = der Unterordner (fuehrerscheine/fuehrungszeugnisse) fehlt noch -> anlegen und EINMAL wiederholen.
    if (resp.status === 404 || resp.status === 409) {
      await fetch(dir, { method: "MKCOL", headers: { Authorization: authHeader } });
      resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    }
  } catch (e) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);

  const nowIso = new Date().toISOString();
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    [docType.uploadedAtField]: nowIso,
    [docType.nameField]: String(body.dateiName || "").trim().slice(0, 200),
    [docType.ctypeField]: ctype
  };
  // Ein tatsächlich hochgeladenes Dokument widerlegt ein zuvor gesetztes "Keine
  // Trainerlizenz vorhanden" — sonst blieben beide Zustände widersprüchlich gespeichert
  // (gleiche Logik wie im Admin-Detail, siehe [[project-trainerdaten]]).
  if (docType.uploadedAtField === "trainerlizenzHochgeladenAm") {
    appData.trainer[idx].trainerlizenzNichtVorhanden = false;
  }

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Datei gespeichert, aber Metadaten-Update fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, id: trainerId, [docType.uploadedAtField]: nowIso }, 200, corsHeaders);
}

// Löscht das hinterlegte Dokument eines BELIEBIGEN Trainers — Gegenstück zu
// handleUploadDocument, für den Fall "das Hinterlegte taugt nicht, die Person soll ein
// neues hochladen". Anders als beim Upload ist der Eigentümer hier nicht der
// eingeloggte Nutzer, sondern kommt als trainerId aus dem Body (wie bei den
// *-file-for-owner-Aktionen), deshalb NUR Admin: die Gruppe fuehrerschein-einsicht darf
// fremde Führerscheine ansehen, aber nicht verwalten.
//
// Reihenfolge ist handleUploadDocument gespiegelt (erst Datei, dann Metadaten): bricht
// der zweite Schritt ab, ist das Dokument weg und der Status behauptet noch
// "vorhanden" — ein erneuter Löschversuch heilt das (der DELETE toleriert 404).
// Andersherum bliebe die Datei ohne jeden Verweis darauf liegen, was gerade beim
// Führungszeugnis niemand will.
async function handleDeleteDocumentForOwner(body, session, env, corsHeaders, docType) {
  if (!session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const trainerId = String(body.trainerId || "");
  const idx = appData.trainer.findIndex(t => t.id === trainerId);
  if (idx === -1) return json({ error: "Trainer nicht gefunden" }, 404, corsHeaders);
  if (!appData.trainer[idx][docType.uploadedAtField]) {
    return json({ error: "Kein Dokument hinterlegt" }, 404, corsHeaders);
  }

  const fileUrl = trainerdatenDir(env) + "/" + docType.subdir + "/" + trainerId;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "DELETE", headers: { Authorization: authHeader } });
  } catch (e) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (!resp.ok && resp.status !== 404) return json({ error: `Nextcloud DELETE ${resp.status}` }, 502, corsHeaders);

  // trainerlizenzNichtVorhanden/-Art/-GueltigBis bleiben stehen: das sind Aussagen über
  // die Lizenz der Person, nicht über die gelöschte Scan-Datei — gleiche Trennung wie
  // beim Re-Upload, der Art/Gültig-bis ebenfalls unangetastet lässt.
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    [docType.uploadedAtField]: "",
    [docType.nameField]: "",
    [docType.ctypeField]: ""
  };

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Datei gelöscht, aber Metadaten-Update fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, id: trainerId }, 200, corsHeaders);
}

// Trainer setzt/aktualisiert seine Trainerlizenz-Metadaten (keine Lizenz vorhanden,
// Lizenzart, Gültig bis) — immer alle drei zusammen, kein Datei-Upload. Gleiches
// Stub-Matching wie handleUploadDocument (resolveOwnTrainerRecord), damit auch
// jemand ohne je ausgefülltes Hauptformular diese Felder setzen kann.
async function handleSetTrainerlizenzDetails(body, session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const nichtVorhanden = !!body.nichtVorhanden;
  const art = String(body.art || "").trim().slice(0, 100);
  const gueltigBis = /^\d{4}-\d{2}-\d{2}$/.test(body.gueltigBis || "") ? body.gueltigBis : "";
  appData.trainer[idx].trainerlizenzNichtVorhanden = nichtVorhanden;
  appData.trainer[idx].trainerlizenzArt = art;
  appData.trainer[idx].trainerlizenzGueltigBis = gueltigBis;

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, trainerlizenzNichtVorhanden: nichtVorhanden, trainerlizenzArt: art, trainerlizenzGueltigBis: gueltigBis }, 200, corsHeaders);
}

// Schmaler Leseweg für die Karte „Kontaktliste des Vereins" im Tab „Mein Konto"
// der ToolsUebersicht (seit 1.3): die eigene Freigabe plus GENAU die Werte, um die
// es dabei geht — damit dort nicht blind angekreuzt wird, sondern neben jedem
// Häkchen steht, was freigegeben würde.
//
// ⚠️ Bewusst NICHT `my-submission` wiederverwendet, obwohl es dieselbe Person
// betrifft: das liefert den GANZEN eigenen Datensatz inklusive IBAN, Bankverbindung
// und Unterschrift. Für vier Häkchen und drei Anzeigewerte ist das zu viel — und die
// Übersichtsseite ist die eine Seite der Flotte, die jeder ständig offen hat.
// Minimal-Disclosure wie bei `raumnutzung-kontakt-lookup` im Gateway.
//
// ⚠️ Legt KEINEN Datensatz an (kein `resolveOwnTrainerRecord`): ein reiner Lesevorgang
// beim Öffnen eines Tabs darf keine Zeile in `trainerdaten.json` erzeugen. Wer keinen
// Datensatz hat, bekommt `vorhanden:false` und die Karte sagt das.
async function handleMyKontaktFreigabe(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const mine = appData.trainer.find(t => t.username === session.username) || null;
  if (!mine) {
    return json({ vorhanden: false, kontaktFreigabe: null, werte: null }, 200, corsHeaders);
  }
  const f = mine.kontaktFreigabe || {};
  return json({
    vorhanden: true,
    kontaktFreigabe: {
      name:    f.name === true,
      telefon: f.telefon === true,
      email:   f.email === true,
      adresse: f.adresse === true,
      aktualisiertAm: typeof f.aktualisiertAm === "string" ? f.aktualisiertAm : ""
    },
    // Nur diese fünf Felder verlassen den Worker — nie iban/bankname/bic/
    // geburtsdatum/Dokumentstatus/Vertragsfelder.
    werte: {
      vorname:  String(mine.vorname || "").trim(),
      nachname: String(mine.nachname || "").trim(),
      telefon:  String(mine.telefon || "").trim(),
      email:    String(mine.email || "").trim(),
      adresse: {
        strasse: String(mine.strasse || "").trim(),
        plz:     String(mine.plz || "").trim(),
        ort:     String(mine.ort || "").trim()
      }
    }
  }, 200, corsHeaders);
}

// Trainer gibt frei, welche seiner Kontaktdaten in der Kontaktliste des Vereins
// (App "kontakte", gelesen über die Gateway-Aktion kontakte-liste) erscheinen dürfen.
// Immer alle vier Schalter zusammen, kein Teil-Update — gleiche Bauform wie
// handleSetTrainerlizenzDetails, gleiches Stub-Matching (resolveOwnTrainerRecord).
//
// ⚠️ Bewusst NICHT über handleSubmit: das Hauptformular ist ein Alles-oder-nichts-
// Absenden mit Pflichtfeldern (IBAN bzw. E-Mail). Ein Widerruf der Freigabe darf
// nicht daran hängen, dass gerade alle Pflichtfelder ausgefüllt sind.
//
// ⚠️ Bewusst NICHT in NUR_VERTRAGSPFLICHTIG_ACTIONS: gerade die Nicht-Vertrags-
// pflichtigen (Geschäftsstelle/Geschäftsführung) sind die, die erreichbar sein
// müssen — ein 403 hier nähme der Kontaktliste die halbe Belegschaft.
//
// ⚠️ Gespeichert wird IMMER ein echter Boolean (`=== true`), nie der Rohwert aus
// dem Body. Die lesende Seite prüft ebenfalls strikt auf `=== true`, damit ein
// Bestandsdatensatz ohne das Feld und ein String wie "ja" beide als "nicht
// freigegeben" gelten — das Fehlen muss hier in die geschlossene Richtung fallen.
async function handleSetKontaktFreigabe(body, session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const freigabe = {
    name:    body.name === true,
    telefon: body.telefon === true,
    email:   body.email === true,
    adresse: body.adresse === true,
    aktualisiertAm: new Date().toISOString()
  };
  appData.trainer[idx].kontaktFreigabe = freigabe;

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, kontaktFreigabe: freigabe }, 200, corsHeaders);
}

// Kodex-Bestätigung (Name+Signatur, migriert aus dem eigenständigen trainerkodex-
// Tool). Gleiches Stub-Matching wie handleSetTrainerlizenzDetails/handleUploadDocument
// (resolveOwnTrainerRecord). kodexBestaetigtAm nur bei echter, gültiger Signatur
// gesetzt -- gleiche Konvention wie unterschriftAm bei handleSubmit, ein leerer/
// ungültiger Wert wird abgelehnt statt stillschweigend als "bestätigt ohne
// Unterschrift" gespeichert. kodexVersion kommt server-seitig aus KODEX_VERSION,
// nicht vom Client (wie username nie vom Client vertraut).
async function handleSubmitKodex(body, session, env, corsHeaders) {
  const signatureDataUrl = (typeof body.signatureDataUrl === "string" &&
                             /^data:image\/png;base64,/.test(body.signatureDataUrl))
    ? body.signatureDataUrl : "";
  if (!signatureDataUrl) {
    return json({ error: "Unterschrift fehlt" }, 400, corsHeaders);
  }
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const nowIso = new Date().toISOString();
  // Unterschrift als eigene Datei ablegen (nicht mehr inline) — bei Fehler abbrechen,
  // bevor kodexBestaetigtAm ohne die zugehörige Datei gespeichert wird.
  try {
    await putSignatureFile(env, authHeader, SIGNATURE_SUBDIRS.kodex, appData.trainer[idx].id, signatureDataUrl);
  } catch (e) {
    return json({ error: "Speicherfehler (Unterschrift): " + e.message }, 502, corsHeaders);
  }
  appData.trainer[idx].kodexBestaetigtAm = nowIso;
  appData.trainer[idx].kodexVersion = KODEX_VERSION;

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, kodexBestaetigtAm: nowIso, kodexVersion: KODEX_VERSION }, 200, corsHeaders);
}

// Jugendschutzkonzept-Bestätigung -- 1:1 gleiches Muster wie handleSubmitKodex()
// (eigenständiges Dokument, eigenes Feld-Trio, gleiches Stub-Matching, gleiche
// Server-Autorität für die Version).
async function handleSubmitJugendschutzkonzept(body, session, env, corsHeaders) {
  const signatureDataUrl = (typeof body.signatureDataUrl === "string" &&
                             /^data:image\/png;base64,/.test(body.signatureDataUrl))
    ? body.signatureDataUrl : "";
  if (!signatureDataUrl) {
    return json({ error: "Unterschrift fehlt" }, 400, corsHeaders);
  }
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }

  const { idx } = resolveOwnTrainerRecord(appData, session, String(body.vorname || "").trim(), String(body.nachname || "").trim());
  const nowIso = new Date().toISOString();
  // Unterschrift als eigene Datei ablegen (nicht mehr inline), siehe handleSubmitKodex.
  try {
    await putSignatureFile(env, authHeader, SIGNATURE_SUBDIRS.jugendschutz, appData.trainer[idx].id, signatureDataUrl);
  } catch (e) {
    return json({ error: "Speicherfehler (Unterschrift): " + e.message }, 502, corsHeaders);
  }
  // ⚠️ Was hier gespeichert wird, MUSS die Fassung sein, die der Trainer eben
  // auf dem Schirm hatte. Sonst belegt die Akte etwas, das nie stattgefunden hat.
  const geltendeVersion = await ksGeltendeKonzeptVersion(authHeader);
  if (!geltendeVersion) {
    return json({ error: "Die geltende Fassung des Konzepts ist gerade nicht abrufbar. Bitte in ein paar Minuten erneut bestaetigen — es wurde nichts gespeichert." }, 503, corsHeaders);
  }
  const angezeigt = String(body.angezeigteVersion || "");
  if (angezeigt && angezeigt !== geltendeVersion) {
    return json({ error: "Das Konzept wurde gerade geaendert (Fassung " + geltendeVersion + "). Bitte lade die Seite neu, lies den Text noch einmal und bestaetige erneut." }, 409, corsHeaders);
  }

  appData.trainer[idx].jugendschutzBestaetigtAm = nowIso;
  appData.trainer[idx].jugendschutzVersion = geltendeVersion;

  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ success: true, jugendschutzBestaetigtAm: nowIso, jugendschutzVersion: geltendeVersion }, 200, corsHeaders);
}

// Eigene Führerschein-Datei abrufen (Trainer sieht immer nur seine eigene).
async function handleMyFuehrerscheinFile(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.fuehrerscheinHochgeladenAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrerscheine/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.fuehrerscheinContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Eigene Führungszeugnis-Datei abrufen (Trainer sieht immer nur seine eigene),
// seit 1.2 -- vorher gab es hierfür bewusst keine Aktion (siehe CLAUDE.md).
async function handleMyFuehrungszeugnisFile(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.fuehrungszeugnisEingereichtAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrungszeugnisse/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.fuehrungszeugnisContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Eigene Trainerlizenz-Datei abrufen (Trainer sieht immer nur seine eigene), analog
// zu handleMyFuehrerscheinFile.
async function handleMyTrainerlizenzFile(session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const mine = appData.trainer.find(t => t.username === session.username);
  if (!mine || !mine.trainerlizenzHochgeladenAm) return json({ error: "Keine Datei hinterlegt" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/trainerlizenzen/" + mine.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = mine.trainerlizenzContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Delegierte Sichtgruppe (natives Äquivalent zur früheren Fahrtenbuch-Gruppe): Admin
// ODER Mitglied von FS_VIEW_GROUP_ID dürfen alle Führerschein-Kopien einsehen — NICHT
// für Führungszeugnis (siehe Datei-Kopf, bewusste Sicherheitsentscheidung).
function mayViewAllFuehrerscheine(session) {
  return !!session.isAdmin || (session.groupIds || []).includes(FS_VIEW_GROUP_ID);
}

async function handleListFuehrerscheine(session, env, corsHeaders) {
  if (!mayViewAllFuehrerscheine(session)) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  // Schmale Projektion — bewusst ohne IBAN/Adresse, gleiche Sichtbarkeit wie die
  // frühere Fahrtenbuch-Gruppe (nur Name + Führerschein-Status).
  const trainer = appData.trainer
    .filter(t => t.fuehrerscheinHochgeladenAm)
    .map(t => ({
      id: t.id, vorname: t.vorname || "", nachname: t.nachname || "",
      fuehrerscheinHochgeladenAm: t.fuehrerscheinHochgeladenAm,
      fuehrerscheinContentType: t.fuehrerscheinContentType || ""
    }));
  return json({ trainer }, 200, corsHeaders);
}

async function handleFuehrerscheinFileForOwner(body, session, env, corsHeaders) {
  if (!mayViewAllFuehrerscheine(session)) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.fuehrerscheinHochgeladenAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrerscheine/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.fuehrerscheinContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Führungszeugnis fuer einen beliebigen Trainer -- bewusst NUR Admin (keine
// Gruppe wie bei Führerschein, siehe Datei-Kopf/mayViewAllFuehrerscheine).
async function handleFuehrungszeugnisFileForOwner(body, session, env, corsHeaders) {
  if (!session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.fuehrungszeugnisEingereichtAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/fuehrungszeugnisse/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.fuehrungszeugnisContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Trainerlizenz fuer einen beliebigen Trainer -- bewusst NUR Admin (analog zu
// Führungszeugnis, keine eigene Sichtgruppe angefragt).
async function handleTrainerlizenzFileForOwner(body, session, env, corsHeaders) {
  if (!session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const trainerId = String(body.trainerId || "");
  const t = appData.trainer.find(x => x.id === trainerId);
  if (!t || !t.trainerlizenzHochgeladenAm) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);

  const fileUrl = trainerdatenDir(env) + "/trainerlizenzen/" + t.id;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = t.trainerlizenzContentType || resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Generischer Datei-Ausliefer-Helfer (Trainervertrag): streamt die Bytes aus dem
// Nextcloud-Unterordner mit erzwungenem Content-Type. Die Dateien liegen ohne Endung
// unter der Trainer-id, Nextcloud liefert sonst application/octet-stream -> der Browser
// bietet Download an statt anzuzeigen (gleiches Prinzip wie bei den Dokument-Handlern).
// Legt eine WebDAV-Ordnerkette relativ zu baseUrl an (MKCOL ist nicht rekursiv).
// Idempotent (405/301/409 = existiert schon werden von Nextcloud toleriert, Fehler
// werden hier ohnehin geschluckt -- der anschliessende PUT ist der eigentliche Test).
async function mkcolRecursive(baseUrl, relDir, authHeader) {
  let url = baseUrl;
  for (const seg of relDir.split("/").filter(Boolean)) {
    url += "/" + seg;
    try { await fetch(url, { method: "MKCOL", headers: { Authorization: authHeader } }); } catch (_) {}
  }
}

async function serveTrainerFile(env, authHeader, corsHeaders, relPath, ctype) {
  const fileUrl = trainerdatenDir(env) + "/" + relPath;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype || "application/pdf", "Cache-Control": "private, no-store" }
  });
}

// Eigenes Trainervertrags-PDF ansehen -- Original (signed=false, vom Skript bereit-
// gestellt) oder das selbst unterschriebene (signed=true). Trainer sieht immer nur
// den eigenen Vertrag (Suche per verifiziertem username).
async function handleMyVertragFile(session, env, corsHeaders, signed) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const mine = appData.trainer.find(t => t.username === session.username);
  const relPath = signed ? (mine && mine.vertragSigniertPfad) : (mine && mine.vertragPdfPfad);
  const gate = signed ? (mine && mine.vertragUnterschriebenAm) : (mine && mine.vertragPdfBereitgestelltAm);
  if (!gate || !relPath) return json({ error: "Kein Vertrag hinterlegt" }, 404, corsHeaders);
  return serveTrainerFile(env, authHeader, corsHeaders, relPath, "application/pdf");
}

// Trainer lädt sein fertig unterschriebenes Vertrags-PDF hoch (Original + im Browser
// per pdf-lib angehängte Unterschriftenseite). Anders als die Dokument-Uploads legt
// das bewusst KEINEN neuen/Stub-Datensatz an (kein resolveOwnTrainerRecord):
// Unterschreiben setzt zwingend voraus, dass dem eigenen Konto bereits ein Vertrag
// zugewiesen wurde (vertragPdfBereitgestelltAm) -- sonst 400.
async function handleSubmitVertragUnterschrift(body, session, env, corsHeaders) {
  if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD) {
    return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
  }
  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leeres PDF" }, 400, corsHeaders);
  if (bytes.length > DOC_MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);
  // body.signatureDataUrl wird seit 1.34 bewusst ignoriert (ältere Clients schicken es
  // evtl. noch): die Unterschrift steckt bereits im signierten PDF. Das frühere Feld
  // vertragSignatureDataUrl hat sie zusätzlich inline im Datensatz abgelegt -- nie
  // gelesen, aber ~50 KB je Unterschrift und damit 99 % der JSON-Größe.

  const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);
  let appData;
  try {
    appData = await loadAppData(env, authHeader);
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  const idx = appData.trainer.findIndex(t => t.username === session.username);
  const origPath = idx !== -1 ? (appData.trainer[idx].vertragPdfPfad || "") : "";
  if (idx === -1 || !appData.trainer[idx].vertragPdfBereitgestelltAm || !origPath) {
    return json({ error: "Kein Vertrag zum Unterschreiben hinterlegt" }, 400, corsHeaders);
  }
  // Signiertes PDF in DENSELBEN Ordner wie das Original legen (der Ordner existiert
  // schon, das Skript hat ihn angelegt) -- nur der Dateiname wird ersetzt.
  const signedPath = origPath.slice(0, origPath.lastIndexOf("/")) + "/Trainervertrag_unterschrieben.pdf";
  const fileUrl = trainerdatenDir(env) + "/" + signedPath;
  const headers = { Authorization: authHeader, "Content-Type": "application/pdf" };
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    // 404/409 = Ordner fehlt wider Erwarten -> Ordnerkette anlegen und EINMAL wiederholen.
    if (resp.status === 404 || resp.status === 409) {
      await mkcolRecursive(trainerdatenDir(env), signedPath.slice(0, signedPath.lastIndexOf("/")), authHeader);
      resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
    }
  } catch (e) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);

  const nowIso = new Date().toISOString();
  appData.trainer[idx] = {
    ...appData.trainer[idx],
    vertragUnterschriebenAm: nowIso,
    vertragSigniertPfad: signedPath
  };
  try {
    const putResp = await fetch(env.NEXTCLOUD_URL, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(appData, null, 2)
    });
    if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
  } catch (e) {
    return json({ error: "PDF gespeichert, aber Metadaten-Update fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }
  return json({ success: true, vertragUnterschriebenAm: nowIso }, 200, corsHeaders);
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
