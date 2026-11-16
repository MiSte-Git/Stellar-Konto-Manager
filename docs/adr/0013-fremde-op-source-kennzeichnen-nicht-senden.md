# 0013: Fremde op.source kennzeichnen, nicht automatisch senden

- **Status:** akzeptiert
- **Datum:** 2026-11

## Kontext

Das Backend sendet einen Multisig-Job automatisch, sobald das gesammelte Gewicht das nötige Gewicht erreicht
(`requiredWeightForOperations`, beim Anlegen und beim Merge). Das nötige Gewicht kommt nur aus den Thresholds des
Job-Kontos. Hat eine Operation eine andere Quelle (`op.source`, Basiskonto, M-Adresse aufgelöst), prüft das Netz diese
Operation gegen Signer und Thresholds des fremden Kontos. Der Job galt deshalb zu früh als `ready_to_submit`, wurde
gesendet und endete mit `tx_bad_auth` als `submitted_failed`. Für Signer, die selbst Quelle einer Operation sind, gilt
schon [ADR 0005](0005-sperre-eigenes-konto-als-op-source.md) (harte Sperre im Job-Detail).

## Entscheidung

Beide Backends erkennen fremde `op.source`-Konten (`foreignOpSourcesOf`, bei einem Fee-Bump die innere Transaktion;
eine Quelle ohne bestimmbares Basiskonto zählt mit ihrem Rohwert als fremd, wie im Frontend) und vermerken sie am Job (`foreignOpSources`, auch beim Lesen aus dem XDR).
Ist die Tx-Quelle selbst nicht das Job-Konto (Altjobs von vor K1), steht ihr Basiskonto zuerst in der Liste: Unter ihr
laufen alle Operationen ohne `op.source`, und sie zahlt Gebühr und Sequence. Anlegen und Merge lassen solche Jobs
seit K1 nicht mehr zu, betroffen ist nur das Lesen. Das Frontend vergleicht in `findOperationWarnings` mit der
Tx-Quelle statt mit `accountId` und sperrt eine abweichende Tx-Quelle über `account_mismatch`. Ein Job mit fremden Quellen wird nie
automatisch gesendet: Erreicht er das Gewicht des Job-Kontos, bleibt er `ready_to_submit`. Das Frontend sagt, dass
Gewicht und Signer dieser Konten nicht geprüft sind, und verweist auf den XDR-Export.

## Begründung

- Ohne Prüfung der fremden Konten ist jedes automatische Senden geraten; gesendet wird höchstens einmal (R-3), ein
  Fehlschlag verbraucht diesen einen Versuch.
- SKM baut solche Jobs selbst nie. Sie kommen von außen, wer sie anlegt, kennt die fremden Konten und kann sie
  außerhalb von SKM fertig signieren und senden.
- Kein neuer Status: `ready_to_submit` mit `foreignOpSources` reicht für Anzeige und Logik und zieht keine
  Statuslisten, Endzustände und Texte in neun Sprachen nach.

## Verworfene Alternativen

- **Beim Anlegen ablehnen:** nimmt legitime Jobs (ein Konto zahlt Gebühren oder Reserve für ein anderes) aus SKM heraus.
- **Gewicht je Konto voll rechnen** (Signer und Thresholds aller fremden Konten live laden, Signaturen je Konto
  zuordnen): deutlich mehr Horizon-Abfragen und Logik in beiden Backends, für einen Fall, den SKM selbst nicht erzeugt.
- **Signaturen fremder Signer behalten:** ohne Prüfung gegen deren Konto käme `tx_bad_auth_extra` (F-5). Der Merge
  verwirft weiter alles, was nicht zu einem Signer des Job-Kontos passt.

## Folgen

- Code: `foreignOpSourcesOf` in `services/txSignatures.js` und `api/txSignatures.php`; Anlegen und Merge in `server.js`
  und `api/multisig.php` (`shouldSubmit`/`willSubmit`, Merge-Zweig), Lesen in `recomputeJobState`/`summarizeJob`.
  Frontend: `pages/MultisigJobDetail.jsx` (Hinweis `job-foreign-not-auto-submitted`, Satz in `job-foreign-sources`,
  Hinweis beim Ablehnen), `pages/MultisigJobList.jsx`. Fixture `test/assets/foreign-op-sources.json` für beide
  Backends und das Frontend (`cases`); `txSourceCases` (Tx-Quelle ungleich Job-Konto) nur für die Backends.
- Fee-Bump-Altjobs (von vor #15) liest Node wie PHP (`parseJobTx` über `TransactionBuilder.fromXDR`): fremde Quellen
  der inneren Transaktion, nötiges Gewicht ohne Operationen (`max(low, med, 1)`, `jobTxOperations`), kein
  Lebenszyklus-Status und keine Klärung aus Sequence oder Zeitfenster. Anlegen und Merge lehnen Fee-Bumps weiter ab
  (`fee_bump_not_supported`), es gibt keinen Sendeweg für sie.
- Signaturen von Signern fremder Konten speichert SKM nur, wenn sie auch Signer des Job-Kontos sind. Fertig signieren
  und senden geht dann nur außerhalb von SKM (XDR kopieren).
- Ablehnen bleibt beim Gewicht des Job-Kontos: Erreicht es sein Gewicht nicht mehr, kann die Transaktion ohnehin nicht
  gelingen (`rejected` stimmt). Ablehnen können nur Signer des Job-Kontos.
- Ein solcher Job ist bis zum Ablauf oder Widerruf offen und lässt sich vorher nicht löschen.
- Extern gesendete Jobs klärt das Lesen über `txHash`, siehe [ADR 0014](0014-extern-gesendete-jobs-ueber-txhash-klaeren.md).
