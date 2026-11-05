# 0008: Übersetzung in zwei Stufen über Englisch

- **Status:** akzeptiert
- **Datum:** 2026

## Kontext

SKM wird auf Deutsch geschrieben und automatisch per DeepL in acht Sprachen übersetzt.

## Entscheidung

Übersetzt wird DE → EN und danach EN → alle anderen Sprachen, nie DE → andere direkt.

## Begründung

- Im Projekt beobachtet: EN → X war deutlich besser als DE → X. Sprachpaare mit Englisch haben bei maschineller
  Übersetzung meist die meisten Trainingsdaten.
- EN ist ein lesbarer Zwischenstand. Ein Fehler wird dort einmal korrigiert und wirkt in allen Sprachen.

## Folgen

- Ein Fehler in EN geht in alle Sprachen über, deshalb EN nach jedem Lauf stichprobenartig prüfen.
- Was es im Englischen nicht gibt, geht verloren, vor allem Du/Sie. Ein `formality`-Parameter ist noch nicht gesetzt.
- Die Entscheidung beruht auf Beobachtung, nicht auf einer Messung. Prüfbar mit einer Stichprobe.
- Details: `docs/i18n-pipeline.md`.
