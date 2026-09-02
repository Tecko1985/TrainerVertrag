@echo off
rem Variante 2: Erzeugt die Trainervertrag-PDFs und WEIST sie den Trainern ZU
rem (Upload nach Nextcloud + Vermerk im Datensatz, Trainer kann unterschreiben).
rem Nur Trainer mit Status "Ausstehend" ohne bereits zugewiesenen Vertrag.
rem Erwartet generate-pdfs.ps1 und vertrag-template.docx im selben Ordner.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-pdfs.ps1" -Zuweisen
pause
