# 0012: Signer-Typen zentral behandeln, quantensichere Signer vorbereiten

- **Status:** vorgeschlagen
- **Datum:** 2026-11

## Kontext

Stellar-Konten werden heute mit Ed25519 signiert, und jede G-Adresse enthält den Ed25519-Public-Key. Die Stellar
Development Foundation plant im Quantum Preparedness Plan (09.06.2026) für 2027 einen quantensicheren Signer-Typ für
klassische Konten, der per `set_options` neben dem Ed25519-Signer hinzugefügt werden kann. Adresse und Guthaben
bleiben dabei gleich. Der Signer-Typ, sein Schlüssel- und Signaturformat und der zugehörige CAP existieren noch nicht.

In SKM ist Ed25519 an vielen Stellen einzeln verdrahtet: 14 Aufrufe von `tx.sign` in 11 Dateien, 15 Aufrufe von
`Keypair.fromSecret` in 9 Dateien, sechs getrennte Kopien des Filters „nur `ed25519_public_key` darf interaktiv
signieren“ und im Backend (Node und PHP) die Signaturprüfung, die Challenge-Prüfung (ADR 0004) und die Gewichtsrechnung.
Analyse und Quellen: Projektdokument `claude/quantensicherheit-analyse.md`.

## Entscheidung

SKM bündelt die Ed25519-spezifische Logik an wenigen Stellen, ohne ein Format für den kommenden Signer-Typ zu
raten: eine Regel, welche Signer-Typen interaktiv signieren dürfen, und eine Stelle, die aus Schlüsselmaterial eine
Signatur an die Transaktion hängt. Der Signer-Typ wird im Datenmodell der Multisig-Jobs mitgeführt. Ein
quantensicherer Signer wird erst eingebaut, wenn der CAP, Horizon und beide SDKs (JS und PHP) ihn unterstützen.

## Begründung

- Der Umbau bleibt klein, wenn der neue Typ an wenigen Stellen eingehängt wird statt an rund 30.
- Das Format ist unbekannt. ML-DSA-Signaturen sind mit 2420 bis 3309 Bytes weit größer als die 64 Bytes, die
  `DecoratedSignature` heute zulässt. Eine heute entworfene Schnittstelle wie `signer.sign(txHash)` könnte falsch sitzen.
- Die Bündelung hat eigenen Nutzen: weniger Duplikate, eine Stelle für die Regel, leichtere Reviews.

## Verworfene Alternativen

- Abwarten bis zum CAP: Der Umbau träfe rund 30 Stellen in Frontend und zwei Backends unter Zeitdruck (Ziel der SDF:
  Ende 2027).
- Contract-Konto (C-Adresse) mit ML-DSA ab 2026: faktisch ein zweites Produkt (Fee-Sponsoring, Wiederherstellung,
  Tokens per SAC statt klassischer Trustlines), SKM bedient klassische Konten.
- Eigene Post-Quantum-Bibliothek im Browser vor Vorliegen des Formats: nicht prüfbar, würde auf Raten beruhen.

## Folgen

- Eigene Runde mit Review, Start nach dem Mainnet-Test (24.11.). Beide Backends gleich (ADR 0003), Tests mit
  Gegenproben (Hash- und Pre-Auth-Signer bleiben ausgeschlossen).
- Das Konto-Upgrade (PQ-Signer hinzufügen, Ed25519-Signer entfernen oder unter die Schwelle setzen) gehört später in
  „Multisig verwalten“ samt Sicherheitsprüfung. Der Schutz entsteht erst, wenn Ed25519 allein nicht mehr signieren kann.
- Offen: Format des Signer-Typs, Signaturgröße im XDR, Signaturobergrenze, Verhalten ruhender Konten (Entscheidung liegt
  bei SDF und Community).
- Beobachtet werden: CAP, SDK-Unterstützung, Horizon, Testnet-Aktivierung, Aktivierungsdatum von Stage 3.
