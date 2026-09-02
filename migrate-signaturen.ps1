# Einmaliges Migrationsskript: Unterschriften aus trainerdaten.json AUSLAGERN.
#
# Hintergrund: Bis 1.27 lagen alle Canvas-Unterschriften als base64-DataURLs inline im
# Trainer-Datensatz (signatureDataUrl / kodexSignatureDataUrl / jugendschutzSignatureDataUrl).
# Das machte 99 % der ~2,7-MB-Datei aus und wurde bei JEDEM Admin-Speichern komplett
# zweimal (lesen+schreiben) uebertragen -> spuerbar langsam. Ab 1.27 liegen die
# Unterschriften als eigene PNG-Dateien in Geschwister-Unterordnern von trainerdaten.json
# (gleiche Ablage wie die Dokumente), genau eine Datei je Trainer-id und Typ:
#   unterschriften/<id>              (Hauptformular)     -> zusaetzlich Flag signaturVorhanden=true
#   kodex-unterschriften/<id>        (Trainerkodex)
#   jugendschutz-unterschriften/<id> (Jugendschutzkonzept)
#
# Dieses Skript zieht die bestehenden inline-Unterschriften einmalig in diese Dateien um
# und ENTFERNT die drei Inline-Felder aus der JSON. Idempotent/wiederholbar (ein zweiter
# Lauf findet keine inline-Unterschriften mehr und tut nichts). MKCOL der Unterordner
# passiert automatisch (via HttpWebRequest, da Invoke-WebRequest in PS 5.1 kein MKCOL kann).
#
# Aufruf:
#   .\migrate-signaturen.ps1 -DryRun   # zeigt nur, was passieren wuerde (kein Schreiben)
#   .\migrate-signaturen.ps1           # fuehrt die Migration aus (fragt das App-Passwort ab)
#
# Vor jedem echten Schreiben wird der Original-Stand lokal als
# trainerdaten.backup.migration-<zeitstempel>.json gesichert.

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$WebdavUser = 'admin'
$ToolsBase  = 'https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F%C3%B6rderung/Tools'
$TrainerdatenDir     = "$ToolsBase/Trainerdaten"
$TrainerdatenJsonUrl = "$TrainerdatenDir/trainerdaten.json"

# Feld -> Unterordner. Reihenfolge egal; haupt bekommt zusaetzlich das Existenz-Flag.
$SignatureTypes = @(
  @{ Field = 'signatureDataUrl';             Subdir = 'unterschriften';              SetFlag = $true  }
  @{ Field = 'kodexSignatureDataUrl';        Subdir = 'kodex-unterschriften';        SetFlag = $false }
  @{ Field = 'jugendschutzSignatureDataUrl'; Subdir = 'jugendschutz-unterschriften'; SetFlag = $false }
)

Write-Host 'Unterschriften-Auslagerung: inline (JSON) -> eigene PNG-Dateien' -ForegroundColor Cyan
if ($DryRun) { Write-Host '== DRY-RUN: es wird NICHTS geschrieben ==' -ForegroundColor Yellow }

$sec  = Read-Host 'Nextcloud App-Passwort' -AsSecureString
$cred = New-Object System.Management.Automation.PSCredential($WebdavUser, $sec)
$headers = @{ 'OCS-APIRequest' = 'true' }

# Klartext-Passwort nur fuer den MKCOL-HttpWebRequest-Header (Basic-Auth manuell).
$bstr    = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plainPw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$authHeader = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$WebdavUser`:$plainPw"))

# WebDAV-Ordner anlegen (idempotent): 201 = neu, 405/301 = existiert schon.
function Ensure-Collection([string]$url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'MKCOL'
    $req.Headers.Add('Authorization', $authHeader)
    $req.Headers.Add('OCS-APIRequest', 'true')
    $resp = $req.GetResponse()
    $resp.Close()
    Write-Host "  Ordner angelegt: $($url.Substring($url.LastIndexOf('/') + 1))" -ForegroundColor Green
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    $code = if ($r) { [int]$r.StatusCode } else { 0 }
    if ($code -eq 405 -or $code -eq 301) { return }   # existiert bereits -> ok
    throw
  }
}

Write-Host 'Lade trainerdaten.json ...'
$tdResp = Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Credential $cred -Headers $headers -UseBasicParsing
$tdText = $tdResp.Content
$tdData = $tdText | ConvertFrom-Json
$trainer = @($tdData.trainer) | Where-Object { $_ }
$trainerVorher = $trainer.Count
Write-Host "$trainerVorher Trainer-Datensaetze geladen."

# Lokales Backup des Original-Stands (nur beim echten Lauf).
if (-not $DryRun) {
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $backupPath = Join-Path $PSScriptRoot "trainerdaten.backup.migration-$stamp.json"
  [System.IO.File]::WriteAllText($backupPath, $tdText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Backup geschrieben: $backupPath" -ForegroundColor Green
}

$hochgeladen = 0
$uebersprungen = 0
$failed = New-Object System.Collections.ArrayList
$angelegteOrdner = @{}
$tempFile = Join-Path $env:TEMP "sig-migration-$([guid]::NewGuid()).tmp"

foreach ($t in $trainer) {
  $wer = "$($t.vorname) $($t.nachname)".Trim()
  foreach ($sig in $SignatureTypes) {
    $dataUrl = $t.($sig.Field)
    if (-not $dataUrl) { continue }
    if ($dataUrl -notmatch '^data:image/png;base64,') {
      [void]$failed.Add("$wer / $($sig.Field) -- kein PNG-DataURL")
      continue
    }
    if (-not $t.id) {
      [void]$failed.Add("$wer / $($sig.Field) -- Datensatz ohne id")
      continue
    }

    if ($DryRun) {
      Write-Host "  [dry] $wer -> $($sig.Subdir)/$($t.id)" -ForegroundColor DarkGray
      $hochgeladen++
      continue
    }

    try {
      # Unterordner bei Bedarf einmalig anlegen.
      $dir = "$TrainerdatenDir/$($sig.Subdir)"
      if (-not $angelegteOrdner.ContainsKey($sig.Subdir)) {
        Ensure-Collection $dir
        $angelegteOrdner[$sig.Subdir] = $true
      }

      # base64 der DataURL dekodieren und als PNG-Datei hochladen (Schluessel = trainer.id).
      $b64 = $dataUrl.Substring($dataUrl.IndexOf(',') + 1)
      $bytes = [Convert]::FromBase64String($b64)
      [System.IO.File]::WriteAllBytes($tempFile, $bytes)
      Invoke-WebRequest -Uri "$dir/$($t.id)" -Method Put -InFile $tempFile `
        -Credential $cred -Headers ($headers + @{ 'Content-Type' = 'image/png' }) -UseBasicParsing | Out-Null

      # Erst nach erfolgreichem Upload das Inline-Feld entfernen und (fuer haupt) das Flag setzen.
      $t.PSObject.Properties.Remove($sig.Field)
      if ($sig.SetFlag) {
        $t | Add-Member -NotePropertyName signaturVorhanden -NotePropertyValue $true -Force
      }
      $hochgeladen++
      Write-Host "  OK: $wer -> $($sig.Subdir)/$($t.id)" -ForegroundColor Green
    } catch {
      [void]$failed.Add("$wer / $($sig.Field) -- $($_.Exception.Message)")
      Write-Host "  FEHLER: $wer / $($sig.Field) -- $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}
if (Test-Path $tempFile) { Remove-Item $tempFile -Force }

if ($DryRun) {
  Write-Host ''
  Write-Host "== DRY-RUN fertig: $hochgeladen Unterschrift(en) wuerden ausgelagert, $($failed.Count) Problem(e). ==" -ForegroundColor Yellow
  if ($failed.Count -gt 0) { $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow } }
  return
}

# Sicherheits-Check: Trainer-Anzahl darf sich durch die Migration nicht aendern.
$trainerNachher = @($tdData.trainer).Count
if ($trainerNachher -ne $trainerVorher) {
  throw "Abbruch: Trainer-Anzahl weicht ab (vorher $trainerVorher, nachher $trainerNachher) - JSON NICHT zurueckgeschrieben. Backup pruefen."
}

Write-Host 'Schreibe bereinigte trainerdaten.json zurueck ...'
$json = $tdData | ConvertTo-Json -Depth 40
$jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($json)   # UTF-8 OHNE BOM
Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Method Put -Body $jsonBytes `
  -Credential $cred -Headers ($headers + @{ 'Content-Type' = 'application/json' }) -UseBasicParsing | Out-Null

$neueGroesseKB = [math]::Round($jsonBytes.Length / 1024, 1)
Write-Host ''
Write-Host '--- Zusammenfassung ---' -ForegroundColor Cyan
Write-Host "Ausgelagerte Unterschriften: $hochgeladen"
Write-Host "Fehlgeschlagen:              $($failed.Count)"
Write-Host "Neue JSON-Groesse:           $neueGroesseKB KB (vorher ~2600 KB)"
if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host 'Fehlgeschlagene Eintraege (Inline-Feld wurde NICHT entfernt, beim naechsten Lauf erneut versucht):' -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
Write-Host ''
Write-Host 'Bitte im Admin-Panel stichprobenartig die Unterschrift-Vorschau pruefen.' -ForegroundColor Yellow
