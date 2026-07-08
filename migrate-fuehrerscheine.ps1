# Einmaliges Migrationsskript: Führerschein-Kopien von Fahrtenbuch nach Trainerdaten
# umziehen (Feature-Migration Fahrtenbuch -> Trainerdaten, siehe CLAUDE.md).
#
# WICHTIG — VOR dem Ausführen einmalig in der Nextcloud-Weboberfläche anlegen:
#   05_Nachwuchsbereich/02_Förderung/Tools/Trainerdaten/fuehrerscheine/
# (Invoke-WebRequest kann in PowerShell 5.1 kein WebDAV-MKCOL — der Ordner muss
# darum von Hand existieren, bevor die erste Datei dorthin geschrieben wird.)
#
# Liest NUR von Fahrtenbuch, schreibt NUR nach Trainerdaten (keine Löschung) —
# sicher wiederholbar. Fahrtenbuchs Altdateien/-Einträge bleiben unangetastet
# liegen (eigene, spätere Aufräum-Entscheidung in Nextcloud).
#
# Aufruf: .\migrate-fuehrerscheine.ps1   (fragt einmalig das Nextcloud-App-Passwort ab)

$ErrorActionPreference = 'Stop'

$WebdavUser = 'admin'
$ToolsBase  = 'https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F%C3%B6rderung/Tools'
$FahrtenbuchJsonUrl  = "$ToolsBase/Fahrtenbuch/fahrtenbuch.json"
$TrainerdatenJsonUrl = "$ToolsBase/Trainerdaten/trainerdaten.json"
$FahrtenbuchFsDir    = "$ToolsBase/Fahrtenbuch/fuehrerscheine"
$TrainerdatenFsDir   = "$ToolsBase/Trainerdaten/fuehrerscheine"

# Gleiche Konvention wie _splitNameForStub() in Trainerdatens app.js: letztes Wort
# wird zum Nachnamen, der Rest zum Vornamen — nur als Fallback, falls für einen
# migrierten Führerschein noch gar kein Trainerdaten-Datensatz existiert.
function Split-NameForStub([string]$fullName) {
  $words = ($fullName -split '\s+') | Where-Object { $_ -ne '' }
  if ($words.Count -le 1) { return @{ vorname = ''; nachname = ($words -join ' ') } }
  return @{ vorname = ($words[0..($words.Count - 2)] -join ' '); nachname = $words[-1] }
}

Write-Host 'Führerschein-Migration: Fahrtenbuch -> Trainerdaten' -ForegroundColor Cyan
Write-Host "Voraussetzung: Ordner 'Trainerdaten/fuehrerscheine/' existiert bereits in Nextcloud (siehe Kommentar oben)." -ForegroundColor Yellow
$sec = Read-Host 'Nextcloud App-Passwort' -AsSecureString
$cred = New-Object System.Management.Automation.PSCredential($WebdavUser, $sec)
$headers = @{ 'OCS-APIRequest' = 'true' }

Write-Host 'Lade fahrtenbuch.json …'
$fbResp = Invoke-WebRequest -Uri $FahrtenbuchJsonUrl -Credential $cred -Headers $headers -UseBasicParsing
$fbData = $fbResp.Content | ConvertFrom-Json
$lizenzEintraege = @($fbData.fuehrerschein) | Where-Object { $_ -and $_.username }
if (-not $lizenzEintraege -or $lizenzEintraege.Count -eq 0) {
  Write-Host 'Keine Führerschein-Einträge in Fahrtenbuch gefunden — nichts zu tun.' -ForegroundColor Yellow
  exit 0
}
Write-Host "$($lizenzEintraege.Count) Führerschein-Eintrag/-Einträge in Fahrtenbuch gefunden."

Write-Host 'Lade trainerdaten.json …'
$tdResp = Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Credential $cred -Headers $headers -UseBasicParsing
$tdData = $tdResp.Content | ConvertFrom-Json
$trainerListe = New-Object System.Collections.ArrayList
@($tdData.trainer) | Where-Object { $_ } | ForEach-Object { [void]$trainerListe.Add($_) }

$matched = New-Object System.Collections.ArrayList
$created = New-Object System.Collections.ArrayList
$failed  = New-Object System.Collections.ArrayList
$tempFile = Join-Path $env:TEMP "fs-migration-$([guid]::NewGuid()).tmp"

foreach ($fs in $lizenzEintraege) {
  $wer = if ($fs.fahrerName) { $fs.fahrerName } else { $fs.username }
  try {
    $trainer = $trainerListe | Where-Object { $_.username -eq $fs.username } | Select-Object -First 1
    $istNeu = $false
    if (-not $trainer) {
      $namen = Split-NameForStub $wer
      $trainer = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        username = $fs.username
        vorname = $namen.vorname
        nachname = $namen.nachname
        erstelltAm = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        vertragsGeneriert = $false
      }
      [void]$trainerListe.Add($trainer)
      $istNeu = $true
    }

    # Binärdatei herunterladen (Fahrtenbuch, Schlüssel = username) …
    Invoke-WebRequest -Uri "$FahrtenbuchFsDir/$($fs.username)" -Credential $cred -Headers $headers -OutFile $tempFile -UseBasicParsing

    # … und nach Trainerdaten hochladen (Schlüssel = trainer.id, NICHT username —
    # siehe CLAUDE.md, deckt auch Stub-Trainer ohne Login ab).
    $ctype = if ($fs.contentType) { $fs.contentType } else { 'application/octet-stream' }
    Invoke-WebRequest -Uri "$TrainerdatenFsDir/$($trainer.id)" -Method Put -InFile $tempFile `
      -Credential $cred -Headers ($headers + @{ 'Content-Type' = $ctype }) -UseBasicParsing | Out-Null

    # Ursprüngliches Einreichungsdatum erhalten (nicht "jetzt") — echte Metadaten der
    # Migration, kein neuer Upload-Zeitpunkt.
    $trainer | Add-Member -NotePropertyName fuehrerscheinHochgeladenAm -NotePropertyValue $fs.hochgeladenAm -Force
    $trainer | Add-Member -NotePropertyName fuehrerscheinDateiName    -NotePropertyValue $fs.dateiName -Force
    $trainer | Add-Member -NotePropertyName fuehrerscheinContentType  -NotePropertyValue $ctype -Force

    if ($istNeu) { [void]$created.Add($wer) } else { [void]$matched.Add($wer) }
    Write-Host "  OK: $wer ($(if ($istNeu) { 'neuer Datensatz' } else { 'bestehender Datensatz' }))" -ForegroundColor Green
  } catch {
    [void]$failed.Add("$wer -- $($_.Exception.Message)")
    Write-Host "  FEHLER: $wer -- $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
  }
}

$tdData.trainer = @($trainerListe.ToArray())
Write-Host 'Schreibe trainerdaten.json zurück …'
$json = $tdData | ConvertTo-Json -Depth 20
Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Method Put -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) `
  -Credential $cred -Headers ($headers + @{ 'Content-Type' = 'application/json' }) -UseBasicParsing | Out-Null

Write-Host ''
Write-Host '--- Zusammenfassung ---' -ForegroundColor Cyan
Write-Host "Bestehenden Datensatz ergänzt: $($matched.Count)"
Write-Host "Neuen Datensatz angelegt:     $($created.Count)"
Write-Host "Fehlgeschlagen:               $($failed.Count)"
if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host 'Fehlgeschlagene Einträge (bitte manuell prüfen):' -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host "  - $_" }
}
Write-Host ''
Write-Host 'Bitte im Trainerdaten-Admin-Panel stichprobenartig prüfen, bevor das' -ForegroundColor Yellow
Write-Host 'Führerschein-Register in Fahrtenbuch/Nextcloud endgültig aufgeräumt wird.' -ForegroundColor Yellow
