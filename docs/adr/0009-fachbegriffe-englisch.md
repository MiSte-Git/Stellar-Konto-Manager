# 0009: Stellar-Fachbegriffe bleiben englisch

- **Status:** akzeptiert
- **Datum:** 2026-10

## Kontext

Eine Stichprobe über alle Sprachen zeigte: DeepL übersetzte „Trustline“ in 93 Keys als „Kreditlinie“, fachlich
falsch, und Begriffe wie Memo, Signer, Threshold mal übersetzt, mal nicht.

## Entscheidung

Stellar- und Krypto-Fachbegriffe werden in keiner Sprache übersetzt, auch nicht im deutschen Quelltext. Liste:
`TECH_TERMS` im Übersetzungsskript. Begriffe in der UI: „M-Adresse“ (nicht Unteradresse), „Trustline“ (nicht
Token-Freigabe), Muxed Account als offizieller Begriff zur M-Adresse.

## Begründung

- Nutzer finden die Begriffe so in Doku, Explorern und anderen Wallets wieder.
- Einheitlich in allen Sprachen.

## Verworfene Alternativen

- DeepL-Glossar: bräuchte Pflege je Sprachpaar und wirkt nicht für andere Provider. Platzhalter wirken in beiden
  Phasen und für jeden Provider.

## Folgen

- Neue Begriffe in `TECH_TERMS` ergänzen. Für Bindestrich-Wörter wie „M-Adresse“ gibt es eine kleine Denylist.
- Details: `docs/i18n-pipeline.md`.
