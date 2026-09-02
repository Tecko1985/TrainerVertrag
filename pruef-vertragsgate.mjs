// Prüfstand für _applyDetailVertragsGate() (Admin-Detail, Trainerdaten).
//
// Fährt die ECHTE Funktion aus app.js gegen ein Papp-DOM, dessen Id-Bestand aus dem
// ECHTEN index.html kommt — ein Tippfehler in einer Id fällt damit hier auf, statt
// erst im Browser als TypeError. Mit --mutation läuft die Gegenprobe: absichtlich
// kaputte Fassungen der Funktion MÜSSEN durchfallen, sonst prüft der Stand nichts.
//
// Aufruf:  node pruef-vertragsgate.mjs --mutation
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("./index.html", import.meta.url), "utf8");
// app.js hat gemischte Zeilenenden (CRLF/LF) — vor dem Schneiden vereinheitlichen,
// sonst findet der Anker das Funktionsende nicht.
const APP = readFileSync(new URL("./app.js", import.meta.url), "utf8").split("\r\n").join("\n");

const IDS = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

// Funktionsquelltext aus app.js schneiden (bis zur schließenden Klammer in Spalte 0).
function holeFunktion(name) {
  const start = APP.indexOf(`function ${name}() {`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);
  const ende = APP.indexOf("\n}\n", start);
  if (ende === -1) throw new Error(`Ende von ${name} nicht gefunden`);
  return APP.slice(start, ende + 3);
}

function papierDom(statusWert) {
  const fehlend = [];
  const elemente = new Map();
  const mach = (id) => ({ id, value: id === "d-status" ? statusWert : "", style: {} });
  return {
    fehlend, elemente,
    document: {
      getElementById(id) {
        if (!IDS.has(id)) { fehlend.push(id); return null; }   // wie im Browser: null
        if (!elemente.has(id)) elemente.set(id, mach(id));
        return elemente.get(id);
      }
    }
  };
}

function lauf(quelltext, statusWert) {
  const dom = papierDom(statusWert);
  const fn = new Function("document", quelltext + "\nreturn _applyDetailVertragsGate();");
  fn(dom.document);
  return dom;
}

// ─── Zusagen ──────────────────────────────────────────────────────────────────
const GEGATED = ["d-vertragsblock", "d-doc-row-vertrag", "btn-pdf-generieren", "btn-pdf-einzeln"];

function pruefe(quelltext) {
  const fehler = [];
  const sag = (ok, text) => { if (!ok) fehler.push(text); };

  // A) "Nur Kontaktdaten": alles Vertragliche weg, Hinweis da
  {
    const dom = lauf(quelltext, "kontaktdaten");
    sag(dom.fehlend.length === 0, "A0 Id existiert nicht in index.html: " + dom.fehlend.join(", "));
    for (const id of GEGATED) {
      const el = dom.elemente.get(id);
      sag(!!el, `A1 ${id} wurde gar nicht angefasst`);
      sag(el && el.style.display === "none", `A2 ${id} ist nicht ausgeblendet (display=${el && el.style.display})`);
    }
    const hinweis = dom.elemente.get("d-kontaktdaten-notice");
    sag(hinweis && hinweis.style.display === "", "A3 Hinweistext bleibt versteckt");
  }

  // B) Vertragslauf (jeder andere Status): alles wieder da, Hinweis weg
  for (const status of ["ausstehend", "generiert", "unvollstaendig"]) {
    const dom = lauf(quelltext, status);
    for (const id of GEGATED) {
      const el = dom.elemente.get(id);
      sag(el && el.style.display === "", `B1 ${id} bleibt bei Status "${status}" ausgeblendet (display=${el && el.style.display})`);
    }
    const hinweis = dom.elemente.get("d-kontaktdaten-notice");
    sag(hinweis && hinweis.style.display === "none", `B2 Hinweistext steht bei Status "${status}" fälschlich da`);
  }

  // C) Verdrahtung: die Funktion muss beim Öffnen UND bei jeder Statusänderung laufen
  const detail = APP.slice(APP.indexOf("async function _openAdminDetail"), APP.indexOf("function _applyDetailVertragsGate"));
  sag((detail.match(/_applyDetailVertragsGate\(\)/g) || []).length >= 2,
      "C1 _applyDetailVertragsGate wird nicht sowohl beim Öffnen als auch im Status-Listener gerufen");
  sag(/addEventListener\("change",[\s\S]{0,400}_applyDetailVertragsGate\(\)/.test(detail),
      "C2 Aufruf fehlt im change-Listener des Status-Selects");

  // D) Der Ausweg darf nicht mitgegated sein (siehe f-gate-kappt-weg)
  sag(!quelltext.includes('"d-status").style'),
      "D1 der Status-Select wird selbst versteckt — dann kommt niemand mehr in den Vertragslauf zurück");

  return fehler;
}

// ─── Ausführen ────────────────────────────────────────────────────────────────
const echt = holeFunktion("_applyDetailVertragsGate");
const fehler = pruefe(echt);
console.log(fehler.length === 0
  ? "OK  echte Fassung: alle Zusagen erfüllt"
  : "FEHLER  echte Fassung:\n  " + fehler.join("\n  "));

if (process.argv.includes("--mutation")) {
  const mutationen = [
    ["Gate immer offen",         s => s.replace(/!== "kontaktdaten"/, '!== "gibtsnicht"')],
    ["Gate immer zu",            s => s.replace(/!== "kontaktdaten"/, '=== "kontaktdaten"')],
    ["Bankblock vergessen",      s => s.replace(/document\.getElementById\("d-vertragsblock"\)[^\n]*\n/, "")],
    ["Vertrags-Knopf vergessen", s => s.replace(/document\.getElementById\("btn-pdf-generieren"\)[^\n]*\n/, "")],
    ["Id vertippt",              s => s.replace('"d-vertragsblock"', '"d-vertragsblok"')],
    ["Hinweis andersherum",      s => s.replace('vertragslauf ? "none" : ""', 'vertragslauf ? "" : "none"')],
    ["nur eine Richtung",        s => s.replace(/const anzeige = vertragslauf \? "" : "none";/, 'const anzeige = "none";')]
  ];
  let gefangen = 0;
  for (const [name, mut] of mutationen) {
    const kaputt = mut(echt);
    if (kaputt === echt) { console.log(`  !! ${name}: Mutation hat nichts geändert (Probe stumpf!)`); continue; }
    let f;
    try { f = pruefe(kaputt); } catch (e) { f = ["Absturz: " + e.message]; }
    if (f.length) { gefangen++; console.log(`  OK  gefangen: ${name}`); }
    else          { console.log(`  !!  DURCHGERUTSCHT: ${name}`); }
  }
  console.log(`Mutationen: ${gefangen}/${mutationen.length} gefangen`);
  if (gefangen !== mutationen.length || fehler.length) process.exitCode = 1;
}
