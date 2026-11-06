# 0011: Kein Swap als Multisig-Job

- **Status:** akzeptiert
- **Datum:** 2026-11

## Kontext

Seit Prompt B (Nov. 2026) bietet das Trading bei Konten, bei denen kein einzelner Signer die Schwelle erreicht, die
Wege Job, lokal alle Signaturen und XDR an ([ADR 0007](0007-multisig-nur-bei-bedarf.md)). Bei einem Swap
(`pathPaymentStrictSend`, auch kombiniert mit `changeTrust`) steht im XDR ein Mindestbetrag (`destMin`), der aus dem
Kurs beim Anlegen und der Slippage berechnet wird. Bis alle Signer eines Jobs signiert haben, vergehen oft Stunden;
die Transaktion bleibt so lange gültig wie in den Einstellungen festgelegt (Standard 24 h).

## Entscheidung

Swap und Trustline plus Swap werden nicht als Multisig-Job angeboten. Lokal mit allen Signaturen und XDR-Export
bleiben möglich. Trustline und Limit-Orders gehen als Job.

Kein Schalter in den Einstellungen.

## Begründung

- Mit normaler Slippage scheitert ein Swap-Job nach Stunden meist an `op_under_dest_min` und muss neu angelegt
  werden. Nutzen für den Nutzer: gering.
- Grosszügige Slippage nur für Jobs hiesse, absichtlich einen schlechteren Kurs zuzulassen. Bei Konten mit mehreren
  Signern ist das unerwünscht.
- Ein Schalter für eine bewusst gesperrte, riskante Funktion wird leicht ohne Kenntnis der Folgen eingeschaltet und
  verdoppelt den Testaufwand.

## Verworfene Alternativen

- Swap als Job mit Hinweis und grosszügiger Slippage wie bei Liquidity Pools.
- Schalter in den Einstellungen.

## Folgen

- Die Sperre gilt in der Auswahl (UI), in `proceed` und in `runUnsigned` (`components/trading/hooks/useTradingMultisig.js`,
  `components/trading/AssetSearch.jsx`). Code-Kommentare verweisen auf diesen ADR.
- Sie ist keine Sicherheitsgrenze: Ein exportiertes XDR lässt sich ausserhalb von SKM oder über „Job aus XDR“ als Job
  anlegen. Das ist in Ordnung, wer das tut, hat den Kurs selbst im Blick.
- Wird Swap als Job später gebraucht: neuen ADR schreiben, der diesen ersetzt, und dabei Slippage, Gültigkeit und
  Anzeige des aktuellen Kurses im Job-Detail festlegen.
