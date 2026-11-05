# 0002: Tokens nie bewerten (Token-Vertrauensprinzip)

- **Status:** akzeptiert
- **Datum:** 2026

## Kontext

Auf Stellar kann jeder Tokens ausgeben, auch unter bekannten Namen. Nutzer möchten wissen, ob ein Token echt ist.
Eine Wallet, die „sicher“ oder „verifiziert“ anzeigt, übernimmt eine Verantwortung, die sie nicht tragen kann, und
wird selbst zum Angriffsziel (gefälschte Einträge, falsches Vertrauen).

## Entscheidung

SKM bestätigt, empfiehlt oder verneint nie, ob ein Token echt, sicher oder richtig ist. SKM zeigt nur Fakten mit
Kontext: Status des Master Keys des Issuers, Daten aus der stellar.toml, Tags von StellarExpert, Flags. Die
Einschätzung trifft der Nutzer.

## Begründung

- Fakten lassen sich prüfen, Urteile nicht.
- Keine falsche Sicherheit und keine falsche Warnung durch SKM.
- Kein Haftungs- und Vertrauensproblem für ein Ein-Personen-Projekt.

## Folgen

- Gilt für jeden Text, jede Farbe, jedes Symbol und jede Sortierung, in beide Richtungen.
- Das Prinzip wird in der UI sichtbar erklärt, nicht nur intern eingehalten.
- Jede neue Funktion auf den Token- und Trading-Seiten wird beim Entwurf daran geprüft.
- Warnhinweise auf der Empfangsseite (Kleinstbetrag, ähnliche Adresse, URL im Memo, Fake-XLM) beschreiben Muster,
  keine Urteile über ein Token.
