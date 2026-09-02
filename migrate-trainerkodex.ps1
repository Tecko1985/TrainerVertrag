# Einmaliges Migrationsskript: Trainerkodex-Bestätigungen von der eigenständigen
# App trainerkodex nach Trainerdaten umziehen (Feature-Migration, siehe CLAUDE.md
# und [[project-trainerkodex]] in der Memory — Trainerkodex hat ab jetzt keine
# eigene Kachel mehr, Kodex lesen+bestätigen läuft direkt in Trainerdaten).
#
# Anders als migrate-fuehrerscheine.ps1 gibt es hier KEIN separates Binärobjekt --
# die Signatur liegt als DataURL-String inline in trainerkodex.json und wandert
# 1:1 mit in dasselbe Feld in trainerdaten.json. Kein Nextcloud-Ordner muss vorher
# angelegt werden.
#
# Liest NUR von trainerkodex.json, schreibt NUR nach trainerdaten.json (keine
# Löschung) — sicher wiederholbar. trainerkodex.json bleibt unangetastet liegen
# (eigene, spätere Aufräum-Entscheidung in Nextcloud).
#
# Idempotenz: ein Trainerdaten-Datensatz, der bereits ein kodexBestaetigtAm trägt
# (z.B. weil die Person die neue Kodex-Bestätigung in Trainerdaten schon genutzt
# hat, bevor dieses Skript lief), wird NICHT überschrieben — die migrierte, evtl.
# ältere Bestätigung würde sonst eine bereits frischere echte Bestätigung ersetzen.
#
# Matching: exakt per username (gleiche Konvention wie der bisherige Lesepfad in
# admin-worker.js::buildTrainerRecord, kein Namensfallback) — Trainerkodex
# verlangte immer ein ToolsUebersicht-Login, jeder bestaetigungen-Eintrag hat also
# einen echten username.
#
# Aufruf: .\migrate-trainerkodex.ps1   (fragt einmalig das Nextcloud-App-Passwort ab)

$ErrorActionPreference = 'Stop'

$WebdavUser = 'admin'
$ToolsBase  = 'https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_F%C3%B6rderung/Tools'
$TrainerkodexJsonUrl = "$ToolsBase/Trainerkodex/trainerkodex.json"
$TrainerdatenJsonUrl = "$ToolsBase/Trainerdaten/trainerdaten.json"

Write-Host 'Trainerkodex-Migration: trainerkodex -> Trainerdaten' -ForegroundColor Cyan
$sec = Read-Host 'Nextcloud App-Passwort' -AsSecureString
$cred = New-Object System.Management.Automation.PSCredential($WebdavUser, $sec)
$headers = @{ 'OCS-APIRequest' = 'true' }

Write-Host 'Lade trainerkodex.json …'
$tkResp = Invoke-WebRequest -Uri $TrainerkodexJsonUrl -Credential $cred -Headers $headers -UseBasicParsing
$tkData = $tkResp.Content | ConvertFrom-Json

# bestaetigungen ist ein JSON-OBJEKT (keyed by username), kein Array -- ConvertFrom-Json
# macht daraus ein PSCustomObject, dessen Keys nur über .PSObject.Properties erreichbar sind.
$alleEintraege = @()
if ($tkData.bestaetigungen) {
  $alleEintraege = @($tkData.bestaetigungen.PSObject.Properties) | ForEach-Object {
    [pscustomobject]@{ username = $_.Name; entry = $_.Value }
  }
}
# Platzhalter (soll:true, kein datum) sind keine echten Bestätigungen -- überspringen.
$bestaetigt = @($alleEintraege) | Where-Object { $_.entry -and $_.entry.datum }
if (-not $bestaetigt -or $bestaetigt.Count -eq 0) {
  Write-Host 'Keine echten Kodex-Bestätigungen gefunden — nichts zu tun.' -ForegroundColor Yellow
  exit 0
}
Write-Host "$($bestaetigt.Count) echte Kodex-Bestätigung(en) gefunden ($($alleEintraege.Count - $bestaetigt.Count) Platzhalter übersprungen)."

Write-Host 'Lade trainerdaten.json …'
$tdResp = Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Credential $cred -Headers $headers -UseBasicParsing
$tdData = $tdResp.Content | ConvertFrom-Json
$trainerListe = New-Object System.Collections.ArrayList
@($tdData.trainer) | Where-Object { $_ } | ForEach-Object { [void]$trainerListe.Add($_) }

$matched = New-Object System.Collections.ArrayList
$created = New-Object System.Collections.ArrayList
$skippedIdempotent = New-Object System.Collections.ArrayList
$failed  = New-Object System.Collections.ArrayList

foreach ($b in $bestaetigt) {
  $wer = "$($b.entry.vorname) $($b.entry.nachname)".Trim()
  if (-not $wer) { $wer = $b.username }
  try {
    $trainer = $trainerListe | Where-Object { $_.username -eq $b.username } | Select-Object -First 1
    $istNeu = $false
    if (-not $trainer) {
      $trainer = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        username = $b.username
        vorname = $b.entry.vorname
        nachname = $b.entry.nachname
        erstelltAm = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        vertragsGeneriert = $false
      }
      [void]$trainerListe.Add($trainer)
      $istNeu = $true
    }

    if ($trainer.kodexBestaetigtAm) {
      [void]$skippedIdempotent.Add($wer)
      Write-Host "  ÜBERSPRUNGEN (schon bestätigt in Trainerdaten): $wer" -ForegroundColor DarkYellow
      continue
    }

    # Ursprüngliches Bestätigungsdatum + Version erhalten (nicht "jetzt") — echte
    # Metadaten der Migration, kein neuer Bestätigungs-Zeitpunkt.
    $trainer | Add-Member -NotePropertyName kodexBestaetigtAm      -NotePropertyValue $b.entry.datum -Force
    $trainer | Add-Member -NotePropertyName kodexSignatureDataUrl -NotePropertyValue $b.entry.unterschrift -Force
    $trainer | Add-Member -NotePropertyName kodexVersion          -NotePropertyValue $b.entry.kodexVersion -Force

    if ($istNeu) { [void]$created.Add($wer) } else { [void]$matched.Add($wer) }
    Write-Host "  OK: $wer ($(if ($istNeu) { 'neuer Datensatz' } else { 'bestehender Datensatz' }))" -ForegroundColor Green
  } catch {
    [void]$failed.Add("$wer -- $($_.Exception.Message)")
    Write-Host "  FEHLER: $wer -- $($_.Exception.Message)" -ForegroundColor Red
  }
}

$tdData.trainer = @($trainerListe.ToArray())
Write-Host 'Schreibe trainerdaten.json zurück …'
$json = $tdData | ConvertTo-Json -Depth 20
Invoke-WebRequest -Uri $TrainerdatenJsonUrl -Method Put -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) `
  -Credential $cred -Headers ($headers + @{ 'Content-Type' = 'application/json' }) -UseBasicParsing | Out-Null

Write-Host ''
Write-Host '--- Zusammenfassung ---' -ForegroundColor Cyan
Write-Host "Bestehenden Datensatz ergänzt:        $($matched.Count)"
Write-Host "Neuen Datensatz angelegt:             $($created.Count)"
Write-Host "Übersprungen (schon bestätigt):       $($skippedIdempotent.Count)"
Write-Host "Fehlgeschlagen:                       $($failed.Count)"
if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host 'Fehlgeschlagene Einträge (bitte manuell prüfen):' -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host "  - $_" }
}
Write-Host ''
Write-Host 'Bitte im Trainerdaten-Admin-Panel stichprobenartig prüfen (Kodex-Bereich im' -ForegroundColor Yellow
Write-Host 'Detail eines migrierten Trainers), bevor trainerkodex.json/die alte App' -ForegroundColor Yellow
Write-Host 'endgültig aufgeräumt wird.' -ForegroundColor Yellow
