# 0004: Challenge-Signaturen mit Zweck-Präfix

- **Status:** akzeptiert
- **Datum:** 2026-11

## Kontext

Für Job-Token und Ablehnen beweist ein Signer den Besitz seines Keys, indem er eine Nonce des Servers signiert.
Eine Stellar-Transaktionssignatur ist eine Ed25519-Signatur über genau 32 Bytes (Hash der Transaktion). Die Nonce
hatte ebenfalls 32 Bytes und wurde roh signiert. Ein bösartiges oder fremd konfiguriertes Backend hätte als „Nonce“
einen Transaktions-Hash schicken können und dafür eine gültige Transaktionssignatur bekommen, ohne dass der Nutzer
etwas sieht. Mit gemerktem Key wäre das beim bloßen Öffnen eines Jobs passiert (Review Runde 2, Befund B1).

## Entscheidung

Signiert wird nie die rohe Nonce, sondern `skm:<zweck>:` plus Nonce. Zwecke: `token`, `decline`. Der Zweck ist
Pflicht, leere Zwecke werden abgelehnt. Beide Backends prüfen mit demselben Zweck.

## Begründung

- Keine signierte Nachricht ist mehr 32 Bytes lang, also nie mit einem Transaktions-Hash verwechselbar.
- Eine Signatur für einen Zweck gilt nicht für einen anderen.
- Verteidigung in der Tiefe: Auch wenn Frontend und Backend meist auf demselben Host liegen, soll ein Backend
  keine Signaturen erschleichen können.

## Folgen

- Code: `services/challengeStore.js`, `api/challengeStore.php`, `frontend/src/utils/multisigApi.js`.
- Ältere offene Tabs bekommen nach dem Update 403, bis sie neu geladen werden. Gewollt.
- Neue Aktionen mit Challenge bekommen einen eigenen Zweck (z. B. `delete`).
