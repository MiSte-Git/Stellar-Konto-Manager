# 0007: Multisig-Ablauf nur anbieten, wenn ein Signer allein nicht reicht

- **Status:** akzeptiert
- **Datum:** 2026-11

## Kontext

Bei Konten mit mehreren Signern bot SKM die Auswahl Job, lokal signieren oder XDR auch dann an, wenn ein einzelner
Signer die nötige Schwelle allein erreicht. Das verwirrte und führte zu unnötigen Jobs.

## Entscheidung

Die Auswahl Job/lokal/XDR erscheint nur, wenn kein einzelner Signer die Schwelle der Aktion allein erreicht. Sonst
wird direkt signiert. Es gibt keine Ausnahme für schwächere Signer, die trotzdem einen Job anlegen wollen.

## Begründung

- Einfacher Ablauf für den häufigen Fall.
- Weniger offene Jobs, die veralten.

## Folgen

- Gilt beim Senden, bei Liquidity Pools und den anderen Abläufen mit Multisig (Commits `6bdf275`, `b8608fe`).
- Die Schwelle hängt von der Operation ab (low/medium/high). `claimClaimableBalance` zählt als Low-Operation, in
  beiden Backends (`d9f6844`).
