# Trainerverträge als PDF — Stapelverarbeitung über das installierte Microsoft Word.
#
# Füllt für jeden Trainer das echte vertrag-template.docx (gleiche Platzhalter wie die
# Web-App) und lässt Word jedes Dokument als PDF exportieren. Originallayout bleibt 1:1
# erhalten, Dateiname "<Nachname>_<Vorname>_Vertrag.pdf", kein manuelles Speichern.
# Die IBANs verlassen den Rechner nicht (Word-Export ist rein lokal).
#
# Aufruf:
#   .\generate-pdfs.ps1                 -> holt die Trainerdaten per WebDAV (App-Passwort wird abgefragt)
#   .\generate-pdfs.ps1 -JsonPath x.json-> nutzt eine lokal heruntergeladene trainerdaten.json
#   .\generate-pdfs.ps1 -Test           -> erzeugt EIN Muster-PDF mit Dummy-Daten (zum Prüfen)
#   .\generate-pdfs.ps1 -Zuweisen       -> erzeugt die PDFs UND laedt sie den Trainern zu
#                                          (Upload nach Nextcloud vertraege/<id> + Vermerk
#                                          im Datensatz). Ohne -Zuweisen bleibt das Skript
#                                          rein lesend (PDFs liegen nur lokal in PDFs/).
#                                          Standardmaessig nur Trainer OHNE bereits
#                                          ausgestellten Vertrag -- bestehende (evtl.
#                                          unterschriebene) Vertraege bleiben unangetastet,
#                                          der Lauf ist damit gefahrlos wiederholbar.
#   .\generate-pdfs.ps1 -Zuweisen -Alle -> Neuausstellung fuer ALLE angemeldeten Trainer
#                                          (bewusster Jahres-Neuauslauf: ersetzt vorhandene
#                                          Vertraege und setzt deren Unterschrift zurueck).

param(
  [string]$JsonPath,
  [string]$OutDir = (Join-Path $PSScriptRoot 'PDFs'),
  [switch]$Test,
  [switch]$Zuweisen,
  [switch]$Alle
)

$ErrorActionPreference = 'Stop'
$Template = Join-Path $PSScriptRoot 'vertrag-template.docx'

# WebDAV-Defaults (öffentlich unkritisch; App-Passwort wird nie gespeichert)
$WebdavUrl  = 'https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/Trainerdaten/trainerdaten.json'
$WebdavUser = 'admin'

# ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function Escape-Xml([string]$s) {
  if ($null -eq $s) { return '' }
  $s = $s -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;'
  return $s
}

function Format-Iban([string]$iban) {
  if ([string]::IsNullOrWhiteSpace($iban)) { return '' }
  $raw = ($iban -replace '\s','').ToUpper()
  return ($raw -replace '(.{4})','$1 ').Trim()
}

function Sanitize-FileName([string]$name) {
  $invalid = [System.IO.Path]::GetInvalidFileNameChars() -join ''
  $re = '[{0}]' -f [Regex]::Escape($invalid)
  return ($name -replace $re,'_').Trim()
}

# Kopiert das Template, ersetzt {{PLATZHALTER}} in word/document.xml, speichert nach $dest.
function Fill-Docx([string]$dest, [hashtable]$repl) {
  Copy-Item $Template $dest -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::Open($dest, 'Update')
  try {
    $entry = $zip.Entries | Where-Object { ($_.FullName -replace '\\','/') -eq 'word/document.xml' } | Select-Object -First 1
    if ($null -eq $entry) { throw 'word/document.xml nicht im Template-ZIP gefunden' }
    $entryName = $entry.FullName
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $xml = $reader.ReadToEnd(); $reader.Close()
    foreach ($k in $repl.Keys) { $xml = $xml.Replace($k, $repl[$k]) }
    $entry.Delete()
    $newEntry = $zip.CreateEntry($entryName)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)  # ohne BOM, sonst korruptes DOCX
    $writer = New-Object System.IO.StreamWriter($newEntry.Open(), $utf8NoBom)
    $writer.Write($xml); $writer.Close()
  } finally {
    $zip.Dispose()
  }
}

# Anlage 1 (§3 Nr.26 EStG): welche Ankreuz-Box markiert wird + Betrags-Blank bei
# "andere Einnahmen". Manuell dieselbe Logik wie _nebentaetigkeitPlatzhalter() in
# pdf-utils.js (kein gemeinsames Modul zwischen Browser-App und diesem Skript) —
# bei künftigen Änderungen an einer Stelle die andere von Hand nachziehen.
function Build-NebentaetigkeitReplacements($t) {
  $gewaehlt = $t.nebentaetigkeit
  $checkKeine  = if ($gewaehlt -eq 'keine')  { '  X  ' } else { '     ' }
  $checkAndere = if ($gewaehlt -eq 'andere') { '  X  ' } else { '     ' }
  $betrag = if ($gewaehlt -eq 'andere' -and $t.nebentaetigkeitBetrag) { "$($t.nebentaetigkeitBetrag) EUR" } else { '' }
  return @{
    '{{CHECK_KEINE}}'  = $checkKeine
    '{{CHECK_ANDERE}}' = $checkAndere
    '{{NEBENTAETIGKEIT_BETRAG}}' = Escape-Xml $betrag
  }
}

function Build-Replacements($t) {
  $heute = Get-Date -Format 'dd.MM.yyyy'
  $jahr  = (Get-Date).Year
  $repl = @{
    '{{VORNAME}}'   = Escape-Xml $t.vorname
    '{{NACHNAME}}'  = Escape-Xml $t.nachname
    '{{LIZENZ}}'    = Escape-Xml $t.lizenz
    '{{PAUSCHALE}}' = Escape-Xml $t.pauschale
    '{{IBAN}}'      = Escape-Xml (Format-Iban $t.iban)
    '{{BANKNAME}}'  = Escape-Xml $t.bankname
    '{{BIC}}'       = Escape-Xml ($t.bic)
    '{{DATUM}}'     = Escape-Xml $heute
    '{{JAHR}}'      = Escape-Xml ([string]$jahr)
  }
  (Build-NebentaetigkeitReplacements $t).GetEnumerator() | ForEach-Object { $repl[$_.Key] = $_.Value }
  return $repl
}

# ── WebDAV-Helfer fuer -Zuweisen (Upload der PDFs + Vermerk im Datensatz) ─────

# Basic-Auth-Header aus der PSCredential (explizit, damit kein 401-Challenge-Roundtrip
# noetig ist -- Nextcloud akzeptiert praeemptive Basic-Auth).
function Get-BasicAuthHeader([System.Management.Automation.PSCredential]$cred) {
  $pair = $cred.UserName + ':' + $cred.GetNetworkCredential().Password
  return 'Basic ' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($pair))
}

# WebDAV-Collection (Ordner) anlegen. Invoke-WebRequest -Method akzeptiert in PS 5.1
# nur die Standard-Verben, MKCOL braucht daher ein rohes HttpWebRequest. Idempotent:
# 201 = neu angelegt; 405/301/409 = existiert bereits -> ok.
function Ensure-WebdavCollection([string]$url, [System.Management.Automation.PSCredential]$cred) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = 'MKCOL'
  $req.Headers.Add('Authorization', (Get-BasicAuthHeader $cred))
  $req.Headers.Add('OCS-APIRequest', 'true')
  try {
    $resp = $req.GetResponse(); $resp.Close()
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if ($r) {
      $code = [int]$r.StatusCode; $r.Close()
      if ($code -eq 405 -or $code -eq 301 -or $code -eq 409) { return }  # existiert schon
    }
    throw
  }
}

# Setzt eine Eigenschaft auf einem PSCustomObject; legt sie an, falls noch nicht vorhanden
# (ConvertFrom-Json-Objekte haben neue Felder anfangs nicht).
function Set-Prop($obj, [string]$name, $value) {
  if ($obj.PSObject.Properties.Name -contains $name) { $obj.$name = $value }
  else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

# Normalisiert Vor-/Nachnamen zu reinem ASCII fuer Nextcloud-Ordnernamen (deutsche
# Umlaute -> ae/oe/ue/ss, Leerzeichen -> _, restliche Nicht-ASCII-Zeichen entfernt).
# Reine ASCII-Pfade vermeiden jeden URL-Encoding-Fallstrick bei WebDAV/Worker/Proxy.
function To-AsciiName([string]$s) {
  if ($null -eq $s) { return '' }
  $s = $s -replace 'ä','ae' -replace 'ö','oe' -replace 'ü','ue' -replace 'Ä','Ae' -replace 'Ö','Oe' -replace 'Ü','Ue' -replace 'ß','ss'
  $s = $s -replace '\s+','_'
  $s = $s -replace '[^A-Za-z0-9_\-]',''
  return $s
}

# Vermerkt die zugewiesenen Vertraege in trainerdaten.json. Liest die Datei FRISCH
# (kleines Race-Fenster gegen gleichzeitige Trainer-Einreichungen), setzt pro id die
# vertragPdf*-Felder + status/vertragsGeneriert und nullt eine evtl. veraltete
# Unterschrift (neuer Original-Vertrag), schreibt dann VALIDIERT zurueck. Vor dem
# Ueberschreiben wird eine lokale Sicherungskopie abgelegt.
function Patch-TrainerdatenJson([string]$url, [System.Management.Automation.PSCredential]$cred, [hashtable]$patchPaths) {
  $resp = Invoke-WebRequest -Uri $url -Credential $cred -Headers @{ 'OCS-APIRequest'='true' } -UseBasicParsing
  $data = $resp.Content | ConvertFrom-Json
  if (-not $data.trainer) { throw 'trainerdaten.json enthaelt kein trainer-Array -- Zuweisung abgebrochen.' }
  $vorher = @($data.trainer).Count

  $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $treffer = 0
  foreach ($tr in @($data.trainer)) {
    if ($tr.id -and $patchPaths.ContainsKey([string]$tr.id)) {
      Set-Prop $tr 'vertragPdfPfad' $patchPaths[[string]$tr.id]
      Set-Prop $tr 'vertragPdfBereitgestelltAm' $nowIso
      # Neu ausgestellter Original-Vertrag -> evtl. alte Unterschrift/Signaturpfad verwerfen.
      Set-Prop $tr 'vertragSigniertPfad' ''
      Set-Prop $tr 'vertragUnterschriebenAm' ''
      Set-Prop $tr 'vertragSignatureDataUrl' ''
      # Status wie der App-Button "Word-Vertrag generieren".
      Set-Prop $tr 'vertragsGeneriert' $true
      Set-Prop $tr 'status' 'generiert'
      $treffer++
    }
  }

  $json = $data | ConvertTo-Json -Depth 40
  # Validierung: Rund-Trip + Trainer-Anzahl unveraendert, sonst NICHT schreiben.
  $check = $json | ConvertFrom-Json
  if (@($check.trainer).Count -ne $vorher) {
    throw ("Validierung fehlgeschlagen (Trainer-Anzahl {0} != {1}) -- NICHT gespeichert." -f @($check.trainer).Count, $vorher)
  }

  # Lokale Sicherungskopie des UNveraenderten Stands vor dem Ueberschreiben.
  $backup = Join-Path $PSScriptRoot ("trainerdaten.backup.{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  [System.IO.File]::WriteAllText($backup, $resp.Content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ("  Sicherung angelegt: {0}" -f $backup) -ForegroundColor DarkGray

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Invoke-WebRequest -Uri $url -Method Put -Body $bytes -ContentType 'application/json; charset=utf-8' -Credential $cred -Headers @{ 'OCS-APIRequest'='true' } -UseBasicParsing | Out-Null
  Write-Host ("  {0} Datensatz/Datensaetze aktualisiert." -f $treffer) -ForegroundColor Green
}

# ── Trainerdaten beschaffen ──────────────────────────────────────────────────

$trainer = $null

if ($Test) {
  Write-Host 'TEST-Modus: ein Muster-PDF mit Dummy-Daten.' -ForegroundColor Yellow
  $trainer = @(
    [pscustomobject]@{
      vorname='Max'; nachname='Mustermann'; lizenz='C'; pauschale='100'
      iban='DE89370400440532013000'; bankname='Musterbank'; bic='COBADEFFXXX'
    }
  )
}
elseif ($JsonPath) {
  if (-not (Test-Path $JsonPath)) { throw "Datei nicht gefunden: $JsonPath" }
  $data = Get-Content $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $trainer = $data.trainer
}
else {
  Write-Host "Trainerdaten werden von Nextcloud geladen ($WebdavUser)." -ForegroundColor Cyan
  $sec = Read-Host 'App-Passwort' -AsSecureString
  $cred = New-Object System.Management.Automation.PSCredential($WebdavUser, $sec)
  $resp = Invoke-WebRequest -Uri $WebdavUrl -Credential $cred -Headers @{ 'OCS-APIRequest'='true' } -UseBasicParsing
  $data = $resp.Content | ConvertFrom-Json
  $trainer = $data.trainer
}

if (-not $trainer -or $trainer.Count -eq 0) { throw 'Keine Trainerdaten gefunden.' }
Write-Host ("{0} Trainer geladen." -f $trainer.Count) -ForegroundColor Green

# ── Zu bearbeitende Trainer auswaehlen ───────────────────────────────────────
# Standard: Person hat sich selbst ueber das Trainer-Formular angemeldet (username
# gesetzt) UND hat noch keinen zugewiesenen Vertrag (vertragPdfBereitgestelltAm leer).
# Ein bereits ausgestellter Vertrag gilt fuers Jahr und wird NICHT angeruehrt --
# geaenderte Stammdaten aendern daran nichts. -Alle erzwingt die Neuausstellung fuer
# ALLE angemeldeten Trainer (bewusster Jahres-Neuauslauf: ersetzt vorhandene Vertraege
# und setzt deren Unterschrift zurueck). Stubs ohne username werden immer uebersprungen.
if (-not $Test) {
  $gesamt = $trainer.Count
  if ($Alle) {
    $trainer = @($trainer | Where-Object { $_.username })
  } else {
    $trainer = @($trainer | Where-Object { $_.username -and -not $_.vertragPdfBereitgestelltAm })
  }
  $uebersprungen = $gesamt - $trainer.Count
  if ($uebersprungen -gt 0) {
    Write-Host ("{0} von {1} uebersprungen (kein Login oder Vertrag bereits ausgestellt; -Alle erzwingt Neuausstellung)." -f $uebersprungen, $gesamt) -ForegroundColor DarkGray
  }
  if ($trainer.Count -eq 0) { throw 'Kein passender Trainer gefunden (alle haben schon einen Vertrag?). Fuer eine Neuausstellung -Alle verwenden.' }
  Write-Host ("{0} Trainer werden bearbeitet." -f $trainer.Count) -ForegroundColor Green
}

# ── Schritt 1: Für jeden Trainer das DOCX befüllen (reine Datei-Operation) ───
# Kein Word hier — nur Zip-Surgery. Word kommt gebündelt in Schritt 3.

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tmpDir = Join-Path $env:TEMP ('tv_pdf_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$ok = 0; $fail = 0
$exportedOk = New-Object 'System.Collections.Generic.HashSet[string]'  # Dateinamen der frisch exportierten PDFs (fuer -Zuweisen)
$tasks = @()
foreach ($t in $trainer) {
  $voll = ("{0} {1}" -f $t.vorname, $t.nachname).Trim()
  $base = Sanitize-FileName ("{0}_{1}_Vertrag" -f $t.nachname, $t.vorname)
  $tmpDocx = Join-Path $tmpDir ($base + '.docx')
  $pdfPath = Join-Path $OutDir ($base + '.pdf')
  try {
    Write-Host ("  [{0}] Fülle DOCX ..." -f $voll) -NoNewline
    Fill-Docx $tmpDocx (Build-Replacements $t)
    Unblock-File $tmpDocx -ErrorAction SilentlyContinue  # Zone-Markierung entfernen → kein Protected View
    Write-Host " OK" -ForegroundColor Green
    $tasks += @{ name = $voll; docx = $tmpDocx; pdf = $pdfPath; file = ($base + '.pdf'); id = $t.id; vorname = $t.vorname; nachname = $t.nachname }
  } catch {
    Write-Host (" FEHLER: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $fail++
  }
}
if ($tasks.Count -eq 0) { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue; throw 'Kein DOCX konnte befüllt werden.' }

# ── Schritt 2: Acrobat PDFMaker temporär deaktivieren ────────────────────────
# PDFMaker.OfficeAddin (LoadBehavior=3) klinkt sich beim Word-Start in die Export-Pipeline
# und kann ExportAsFixedFormat blockieren. Vor dem Word-Start auf 0; im finally zurück.
$pdfMakerKey   = 'HKCU:\Software\Microsoft\Office\Word\Addins\PDFMaker.OfficeAddin'
$pdfMakerSaved = $null
if (Test-Path $pdfMakerKey) {
  $pdfMakerSaved = (Get-ItemProperty $pdfMakerKey -Name LoadBehavior -ErrorAction SilentlyContinue).LoadBehavior
  Set-ItemProperty $pdfMakerKey -Name LoadBehavior -Value 0 -ErrorAction SilentlyContinue
  Write-Host "Acrobat PDFMaker temporaer deaktiviert (LoadBehavior 0)." -ForegroundColor DarkGray
}

# ── Schritt 3: Word-Export in einem abgespaltenen Child-Job ──────────────────
# WICHTIG: Auf dieser Maschine HÄNGT $doc.ExportAsFixedFormat, wenn es direkt im
# Haupt-PowerShell-Prozess läuft (Word rechnet sich in einer Render-Schleife tot,
# CPU steigt unbegrenzt, kein Fehler, kein PDF). Genau derselbe Aufruf läuft in
# einem per Start-Job abgespaltenen Child-Prozess zuverlässig in <1s pro Dokument
# durch. Darum die KOMPLETTE Word-Schleife im Job; der Hauptprozess wacht nur per
# Watchdog darüber und beendet WINWORD hart, falls doch etwas klemmt.
try {
  $exportJob = Start-Job -ScriptBlock {
    param($tasks)
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    try { $word.AutomationSecurity = 3 } catch {}            # Makros beim Öffnen aus
    try { $word.Options.UpdateFieldsAtPrint = $false } catch {}
    try { $word.Options.UpdateLinksAtPrint  = $false } catch {}
    foreach ($t in $tasks) {
      try {
        # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
        $doc = $word.Documents.Open($t.docx, $false, $true, $false)
        if ($word.ProtectedViewWindows.Count -gt 0) { $doc = $word.ProtectedViewWindows.Item(1).Edit() }
        # ExportAsFixedFormat(OutputFileName, 17=wdExportFormatPDF, OpenAfterExport=$false)
        $doc.ExportAsFixedFormat($t.pdf, 17, $false)
        $doc.Close($false)
        Write-Output ("OK|{0}|{1}" -f $t.name, $t.file)
      } catch {
        Write-Output ("FEHLER|{0}|{1}" -f $t.name, $_.Exception.Message)
      }
    }
    try { $word.Quit() } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  } -ArgumentList (,$tasks)

  $timeoutSec = 60 + 30 * $tasks.Count    # großzügiges Zeitbudget je Dokument
  Write-Host ("  Exportiere {0} PDF(s) in Word (Timeout {1}s) ..." -f $tasks.Count, $timeoutSec)
  $done = Wait-Job $exportJob -Timeout $timeoutSec
  if ($null -eq $done) {
    Write-Host "  TIMEOUT: Word-Export hängt — beende WINWORD." -ForegroundColor Red
    Stop-Job $exportJob -ErrorAction SilentlyContinue
    Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $fail += $tasks.Count
  } else {
    Receive-Job $exportJob | ForEach-Object {
      $p = $_ -split '\|'
      if ($p[0] -eq 'OK')     { Write-Host ("  OK  {0}" -f $p[2]) -ForegroundColor Green; $ok++; [void]$exportedOk.Add($p[2]) }
      elseif ($p[0] -eq 'FEHLER') { Write-Host ("  FEHLER bei {0}: {1}" -f $p[1], $p[2]) -ForegroundColor Red; $fail++ }
    }
  }
  Remove-Job $exportJob -Force -ErrorAction SilentlyContinue
} finally {
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  # Acrobat PDFMaker wieder auf den Originalwert setzen
  if ($null -ne $pdfMakerSaved) {
    Set-ItemProperty $pdfMakerKey -Name LoadBehavior -Value $pdfMakerSaved -ErrorAction SilentlyContinue
    Write-Host ("Acrobat PDFMaker wiederhergestellt (LoadBehavior {0})." -f $pdfMakerSaved) -ForegroundColor DarkGray
  }
}

# ── Schritt 4: Vertraege zuweisen (nur mit -Zuweisen) ────────────────────────
# Laedt die erzeugten PDFs nach Nextcloud vertraege/<Jahr>/<Vorname>_<Nachname>/
# Trainervertrag.pdf hoch und vermerkt den Pfad im jeweiligen Trainer-Datensatz.
# Braucht Schreibzugriff -- im -JsonPath-Modus wird das App-Passwort hier nachgefragt
# (die WebDAV-Ladung oben entfaellt dort).
if ($Zuweisen -and -not $Test) {
  Write-Host ''
  if ($exportedOk.Count -eq 0) {
    Write-Host "Zuweisung uebersprungen: kein frisch erzeugtes PDF vorhanden." -ForegroundColor DarkYellow
  } else {
    if ($null -eq $cred) {
      Write-Host "Fuer die Zuweisung wird das Nextcloud-App-Passwort benoetigt ($WebdavUser)." -ForegroundColor Cyan
      $sec = Read-Host 'App-Passwort' -AsSecureString
      $cred = New-Object System.Management.Automation.PSCredential($WebdavUser, $sec)
    }
    $baseDir = $WebdavUrl.Substring(0, $WebdavUrl.LastIndexOf('/'))
    $jahr = (Get-Date).Year

    # Ordner-Belegung vorbereiten: relativer Ordnerpfad -> id, aus BESTEHENDEN Zuweisungen
    # (damit ein neuer, namensgleicher Trainer nicht den Ordner eines anderen ueberschreibt).
    $folderOwner = @{}
    foreach ($tr in @($data.trainer)) {
      if ($tr.vertragPdfPfad -and $tr.id) {
        $segs = @($tr.vertragPdfPfad -split '/')
        if ($segs.Count -ge 2) { $folderOwner[($segs[0..($segs.Count-2)] -join '/')] = [string]$tr.id }
      }
    }

    Write-Host "Lege Ordner 'vertraege' und Jahresordner '$jahr' an (falls noetig) ..." -ForegroundColor DarkGray
    Ensure-WebdavCollection "$baseDir/vertraege" $cred
    Ensure-WebdavCollection "$baseDir/vertraege/$jahr" $cred

    $zugewiesen = 0; $zufehler = 0
    $patchPaths = @{}
    foreach ($t in $tasks) {
      if (-not $exportedOk.Contains($t.file)) { continue }
      if (-not $t.id) { Write-Host ("  uebersprungen (keine id): {0}" -f $t.name) -ForegroundColor DarkYellow; continue }

      # Menschenlesbarer Ordner vertraege/<Jahr>/<Vorname>_<Nachname> (ASCII); bei
      # Namensgleichheit mit _2/_3 entschaerft. Der eigene bestehende Ordner zaehlt NICHT
      # als Kollision (eine Neuausstellung ueberschreibt den eigenen Ordner bewusst).
      $nameTeil = (To-AsciiName $t.vorname) + '_' + (To-AsciiName $t.nachname)
      if (-not $nameTeil -or $nameTeil -eq '_') { $nameTeil = 'Trainer_' + ([string]$t.id).Substring(0, 8) }
      $folderRel = "vertraege/$jahr/$nameTeil"
      $n = 2
      while ($folderOwner.ContainsKey($folderRel) -and $folderOwner[$folderRel] -ne [string]$t.id) {
        $folderRel = "vertraege/$jahr/${nameTeil}_$n"; $n++
      }
      $folderOwner[$folderRel] = [string]$t.id
      $pdfRel = "$folderRel/Trainervertrag.pdf"

      try {
        Ensure-WebdavCollection "$baseDir/$folderRel" $cred
        Invoke-WebRequest -Uri "$baseDir/$pdfRel" -Method Put -InFile $t.pdf -ContentType 'application/pdf' -Credential $cred -Headers @{ 'OCS-APIRequest'='true' } -UseBasicParsing | Out-Null
        $patchPaths[[string]$t.id] = $pdfRel
        $zugewiesen++
        Write-Host ("  hochgeladen: {0}" -f $pdfRel) -ForegroundColor Green
      } catch {
        $zufehler++
        Write-Host ("  FEHLER Upload {0}: {1}" -f $t.name, $_.Exception.Message) -ForegroundColor Red
      }
    }

    if ($patchPaths.Count -gt 0) {
      try {
        Patch-TrainerdatenJson $WebdavUrl $cred $patchPaths
      } catch {
        Write-Host ("  FEHLER beim Aktualisieren von trainerdaten.json: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-Host "  Die PDFs wurden hochgeladen, aber der Vermerk im Datensatz fehlt -- bitte erneut mit -Zuweisen laufen lassen." -ForegroundColor Red
      }
    }
    Write-Host ("Zuweisung: {0} hochgeladen, {1} Fehler." -f $zugewiesen, $zufehler) -ForegroundColor Cyan
  }
}

Write-Host ''
Write-Host ("Fertig: {0} PDF(s) erstellt, {1} Fehler." -f $ok, $fail) -ForegroundColor Cyan
Write-Host ("Ordner: {0}" -f $OutDir)
