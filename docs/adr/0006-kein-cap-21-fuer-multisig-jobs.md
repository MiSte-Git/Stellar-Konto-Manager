# 0006: Kein CAP-21 für Multisig-Jobs

- **Status:** akzeptiert
- **Datum:** 2026

## Kontext

Multisig-Jobs veralten, wenn sich die Sequence des Kontos ändert, bevor alle Signaturen da sind. CAP-21
(Preconditions wie `minSeqNum`, `minSeqAge`) könnte Jobs länger gültig halten. Vorher wurden Stufe 1 (Erkennen von
Sequence und Zeitfenster) und Stufe 2 (Transparenz im Job-Detail, serverseitige Obergrenze von 7 Tagen für das
Gültigkeitsfenster) umgesetzt.

## Entscheidung

SKM setzt keine CAP-21-Preconditions für eigene Jobs. Sind sie in einem fremden Job gesetzt, zeigt das Job-Detail sie
an und verlangt eine eigene Bestätigung.

## Begründung

- Nach Stufe 1 und 2 wäre der Gewinn nur noch Komfort.
- CAP-21 würde lang gültige signierte Transaktionen ermöglichen und damit die Obergrenze aus Stufe 2 aushebeln.
- Der einzige Weg, einen signierten Job sicher abzubrechen, ist heute der Verbrauch der Sequence. CAP-21 würde ihn
  ohne Ersatz entfernen.

## Folgen

- Grundsatz daraus: Eine Änderung, die Komfort bringt, aber eine bestehende Schutzmaßnahme schwächt, wird abgelehnt,
  auch wenn sie für sich technisch sauber ist.
- Veraltete oder abgelaufene Jobs werden neu angelegt. Ein Neuaufbau mit gleichen Operationen ist als spätere
  Erleichterung denkbar.
