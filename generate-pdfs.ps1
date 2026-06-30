# Trainerverträge als PDF — Stapelverarbeitung über das installierte Microsoft Word.
#
# Füllt für jeden Trainer das echte vertrag-template.docx (gleiche Platzhalter wie die
# Web-App) und lässt Word jedes Dokument als PDF exportieren. Originallayout bleibt 1:1
# erhalten, Dateiname "<Vorname> <Nachname>_Vertrag.pdf", kein manuelles Speichern.
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
    $entry = $zip.GetEntry('word/document.xml')
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $xml = $reader.ReadToEnd(); $reader.Close()
    foreach ($k in $repl.Keys) { $xml = $xml.Replace($k, $repl[$k]) }
    $entry.Delete()
    $newEntry = $zip.CreateEntry('word/document.xml')
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

# ── Word starten und je Trainer ein PDF exportieren ──────────────────────────

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tmpDir = Join-Path $env:TEMP ('tv_pdf_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try { $word.AutomationSecurity = 3 } catch {}  # Makros beim Öffnen deaktivieren

$ok = 0; $fail = 0
try {
  foreach ($t in $trainer) {
    $voll = ("{0} {1}" -f $t.vorname, $t.nachname).Trim()
    $base = Sanitize-FileName ($voll + '_Vertrag')
    $tmpDocx = Join-Path $tmpDir ($base + '.docx')
    $pdfPath = Join-Path $OutDir ($base + '.pdf')
    try {
      Fill-Docx $tmpDocx (Build-Replacements $t)
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
      $doc = $word.Documents.Open($tmpDocx, $false, $true, $false)
      $doc.ExportAsFixedFormat($pdfPath, 17) # 17 = wdExportFormatPDF
      $doc.Close($false)
      Write-Host ("  OK  {0}" -f ($base + '.pdf')) -ForegroundColor Green
      $ok++
    } catch {
      Write-Host ("  FEHLER bei {0}: {1}" -f $voll, $_.Exception.Message) -ForegroundColor Red
      $fail++
    }
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("Fertig: {0} PDF(s) erstellt, {1} Fehler." -f $ok, $fail) -ForegroundColor Cyan
Write-Host ("Ordner: {0}" -f $OutDir)
