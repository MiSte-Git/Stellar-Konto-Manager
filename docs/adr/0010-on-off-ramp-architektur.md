# 0010: Architektur für On-/Off-Ramp

- **Status:** akzeptiert, nicht umgesetzt
- **Datum:** 2026

## Kontext

Geplante Funktion nach 1.0: Kauf und Verkauf von XLM bzw. Tokens gegen Fiat über externe Anbieter.

## Entscheidung

- Eine Abstraktionsschicht für Anbieter, damit mehrere angebunden werden können.
- Weiterleitung zum Anbieter (Redirect), kein eingebettetes Widget.
- Ergebnis per Abfrage beim Anbieter und Prüfung auf Horizon, Webhooks wird nicht vertraut.
- Cashback-Angaben nur auf der Seite des Anbieters.

## Begründung

- Redirect hält fremden Code aus der SKM-Seite heraus und vereinbart sich mit der strikten CSP.
- Ob Geld angekommen ist, entscheidet das Netz, nicht eine Nachricht des Anbieters.
- Keine Werbeaussagen von SKM über Konditionen Dritter.

## Offen

- Anbieter für den Anfang (MoonPay vorgeschlagen).
- Cashback anzeigen ja oder nein.
- Umfang des ersten Schritts: vollständiger Adapter oder nur Vergleich von Angeboten.
