# Trainerverträge als PDF — Stapelverarbeitung über das installierte Microsoft Word.
#
# Füllt für jeden Trainer das echte vertrag-template.docx (gleiche Platzhalter wie die
# Web-App) und lässt Word jedes Dokument als PDF exportieren. Originallayout bleibt 1:1
# erhalten, Dateiname "<Nachname>_<Vorname>_Vertrag.pdf", kein manuelles Speichern.
# Die IBANs verlassen den Rechner nicht (Word-Export ist rein lokal).
#
# Aufruf:
#   .\generate-pdfs.ps1                 -> holt die Trainerdaten per WebDAV (App-Passwort wird abgefragt)
#   .\generate-pdfs.ps1 -JsonPath x.json-> nutzt eine lokal heruntergeladene trainervertrag.json
#   .\generate-pdfs.ps1 -Test           -> erzeugt EIN Muster-PDF mit Dummy-Daten (zum Prüfen)

param(
  [string]$JsonPath,
  [string]$OutDir = (Join-Path $PSScriptRoot 'PDFs'),
  [switch]$Test
)

$ErrorActionPreference = 'Stop'
$Template = Join-Path $PSScriptRoot 'vertrag-template.docx'

# WebDAV-Defaults (öffentlich unkritisch; App-Passwort wird nie gespeichert)
$WebdavUrl  = 'https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F%C3%B6rderung/Tools/TrainerVertrag/trainervertrag.json'
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

function Build-Replacements($t) {
  $heute = Get-Date -Format 'dd.MM.yyyy'
  $jahr  = (Get-Date).Year
  return @{
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

# ── Schritt 1: Für jeden Trainer das DOCX befüllen (reine Datei-Operation) ───
# Kein Word hier — nur Zip-Surgery. Word kommt gebündelt in Schritt 3.

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tmpDir = Join-Path $env:TEMP ('tv_pdf_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$ok = 0; $fail = 0
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
    $tasks += @{ name = $voll; docx = $tmpDocx; pdf = $pdfPath; file = ($base + '.pdf') }
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
      if ($p[0] -eq 'OK')     { Write-Host ("  OK  {0}" -f $p[2]) -ForegroundColor Green; $ok++ }
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

Write-Host ''
Write-Host ("Fertig: {0} PDF(s) erstellt, {1} Fehler." -f $ok, $fail) -ForegroundColor Cyan
Write-Host ("Ordner: {0}" -f $OutDir)
