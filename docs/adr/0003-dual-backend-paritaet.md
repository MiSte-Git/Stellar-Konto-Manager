# 0003: Zwei Backends mit gleichem Verhalten

- **Status:** akzeptiert
- **Datum:** 2026

## Kontext

Das Produktions-Hosting ist Shared Hosting ohne Node. Entwickelt und getestet wird lokal schneller mit Node.

## Entscheidung

Es gibt zwei Backends: Node/Express (`server.js`, `services/`) für die lokale Entwicklung und PHP (`api/`) für die
Produktion. Beide müssen sich gleich verhalten. Jede Änderung an Verhalten oder Sicherheit wird in beiden umgesetzt
und in beiden getestet.

## Begründung

- Produktion ist an PHP gebunden, lokale Entwicklung mit Node ist bequemer.
- Gleiches Verhalten, damit lokale Tests für die Produktion aussagekräftig sind.

## Verworfene Alternativen

- Nur PHP: langsamere Entwicklung, das Frontend-Tooling ist ohnehin Node.
- Anderes Hosting mit Node: vorerst nicht gewünscht.

## Folgen

- Doppelter Aufwand bei jeder Backend-Änderung. Tests liegen als Paare in `test/` (`*.test.js`, `*.test.php`).
- PHP nutzt Dateilocks für alles mit Zustand, Node einen Lock je Job.
- Abweichungen sind Fehler. Bekannte Abweichungen werden im Backlog geführt.
- Befunde, die nur Node betreffen, sind meist weniger dringend, weil Node nicht öffentlich läuft.
