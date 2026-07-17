@echo off
rem Variante 1: Erzeugt die Trainervertrag-PDFs NUR LOKAL (Unterordner PDFs\).
rem Es wird nichts hochgeladen, kein Trainer sieht etwas.
rem Erwartet generate-pdfs.ps1 und vertrag-template.docx im selben Ordner.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-pdfs.ps1"
pause
