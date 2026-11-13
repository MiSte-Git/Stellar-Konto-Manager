# Architecture Decision Records (ADR)

Hier stehen die grundlegenden Entscheidungen zu SKM, jeweils mit Kontext, Begründung und verworfenen Alternativen.
Sie erklären, **warum** etwas so ist. Wer eine dieser Entscheidungen ändern will, schreibt einen neuen ADR, der den
alten ersetzt, statt den alten still umzuschreiben.

| Nr. | Titel | Status |
|---|---|---|
| [0001](0001-secret-key-erst-beim-signieren.md) | Secret Key erst beim Signieren abfragen | akzeptiert |
| [0002](0002-tokens-nie-bewerten.md) | Tokens nie bewerten (Token-Vertrauensprinzip) | akzeptiert |
| [0003](0003-dual-backend-paritaet.md) | Zwei Backends mit gleichem Verhalten | akzeptiert |
| [0004](0004-zweckbindung-challenges.md) | Challenge-Signaturen mit Zweck-Präfix | akzeptiert |
| [0005](0005-sperre-eigenes-konto-als-op-source.md) | Harte Sperre bei eigenem Konto als op.source | akzeptiert |
| [0006](0006-kein-cap-21-fuer-multisig-jobs.md) | Kein CAP-21 für Multisig-Jobs | akzeptiert |
| [0007](0007-multisig-nur-bei-bedarf.md) | Multisig-Ablauf nur anbieten, wenn ein Signer allein nicht reicht | akzeptiert |
| [0008](0008-zwei-stufen-uebersetzung.md) | Übersetzung in zwei Stufen über Englisch | akzeptiert |
| [0009](0009-fachbegriffe-englisch.md) | Stellar-Fachbegriffe bleiben englisch | akzeptiert |
| [0010](0010-on-off-ramp-architektur.md) | Architektur für On-/Off-Ramp | akzeptiert, nicht umgesetzt |
| [0011](0011-kein-swap-als-multisig-job.md) | Kein Swap als Multisig-Job | akzeptiert |
| [0012](0012-signer-typen-zentral-quantensicher-vorbereiten.md) | Signer-Typen zentral behandeln, quantensichere Signer vorbereiten | akzeptiert |

Neue Einträge nach [template.md](template.md), fortlaufend nummeriert.
