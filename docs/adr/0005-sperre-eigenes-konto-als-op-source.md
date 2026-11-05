# 0005: Harte Sperre bei eigenem Konto als op.source

- **Status:** akzeptiert
- **Datum:** 2026-10

## Kontext

Eine Transaktion kann Operationen enthalten, deren Quelle (`op.source`) ein anderes Konto ist als die
Transaktionsquelle. Signiert ein Nutzer einen fremden Multisig-Job und ist sein eigenes Konto Quelle einer solchen
Operation, autorisiert seine Signatur diese Operation für sein eigenes Konto, etwa eine Zahlung von seinem Konto.

## Entscheidung

Ist das aktuelle Konto (auch als M-Adresse) Quelle einer Operation in einem Job, sperrt das Job-Detail das Signieren
hart, ohne Bestätigungs-Checkbox. Das gilt auch, wenn ein eingegebener Key zu einer fremden `op.source` gehört.
Fremde `op.source`-Konten, die nicht dem Nutzer gehören, verlangen eine ausdrückliche Bestätigung.

## Begründung

- Der Schaden wäre direkt und unumkehrbar, eine Checkbox wird schnell weggeklickt.
- SKM baut solche Jobs selbst nie. Ein Job mit dem eigenen Konto als `op.source` ist also entweder ein Fehler oder
  ein Angriff.

## Folgen

- Code: `frontend/src/utils/multisig/describeOperations.js` (`findOperationWarnings`), `pages/MultisigJobDetail.jsx`.
- Wer so etwas absichtlich signieren will, muss ein anderes Werkzeug nehmen.
