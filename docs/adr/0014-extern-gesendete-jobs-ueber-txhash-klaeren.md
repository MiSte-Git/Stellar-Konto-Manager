# 0014: Extern gesendete Jobs über txHash klären

- **Status:** akzeptiert
- **Datum:** 2026-11

## Kontext

Ein Multisig-Job kann außerhalb von SKM gesendet werden: XDR kopiert und anderswo fertig signiert (der vorgesehene Weg
bei fremder `op.source`, [ADR 0013](0013-fremde-op-source-kennzeichnen-nicht-senden.md)) oder schlicht von einem
Signer selbst eingereicht. SKM sah danach nur die verbrauchte Sequence und zeigte `obsolete_seq`. Schlimmer: Ohne
Blick ins Ledger speichern drei Stellen einen Endzustand. Der Wächter (`expireStalePendingJobs`) setzt bei jedem
Speichern offene Jobs nach `maxTime` auf `expired`, der Merge speichert `obsolete_seq`/`expired`, Ablehnen speichert
`rejected` (das extern trotzdem gesendet werden kann). Wer `obsolete_seq` oder `expired` sieht, legt den Auftrag neu an,
und die Zahlung geht ein zweites Mal raus. Für das unklare Senden gibt es schon eine Klärung über
`GET /transactions/{hash}` (F-2, `submit_unclear`, R-1).

## Entscheidung

Die bestehende Klärung (`resolveUnclearJobs`) prüft zusätzlich Kandidaten: gespeichert `pending_signatures`,
`ready_to_submit`, `expired`, `obsolete_seq` oder `rejected`, ohne `ledgerCheckedAt`, mit laut Live-Daten verbrauchter
Sequence. `submitted_success` und `submitted_failed` nie. Gefunden und erfolgreich: `submitted_success` mit
`submittedExternally: true`, `submittedResult` im F-3-Format (`{hash, ledger}`), `submittedAt` aus `created_at` von
Horizon. Gefunden und im Ledger fehlgeschlagen: `submitted_failed` ebenso. Sicher nicht gefunden (R-1: Ledger-Zeit mehr
als 60 s nach `maxTime`): `obsolete_seq` (die Sequence ist verbraucht), gespeichert `obsolete_seq` und `rejected`
bleiben; ein gespeichertes `expired` wird `obsolete_seq`, weil der Wächter einen widerrufenen Job vorher nach der
Serveruhr auf `expired` setzt. Kennt Horizon das Konto nicht mehr (404, etwa nach einem extern gesendeten
`accountMerge`), gilt die Sequence als verbraucht. Geprüft wird die Sequence der Tx-Quelle (Basiskonto); seit K1 ist
das `accountId`, bei Altjobs von vor K1 ein anderes Konto. Ein Kandidat im Endzustand (`expired`, `obsolete_seq`,
`rejected`), dessen Sequence nicht verbraucht ist, wird ohne Abfrage der Transaktion geklärt, sobald Horizon einen
Ledger mehr als 60 s nach `maxTime` meldet: Die Transaktion kann nie mehr ins Ledger, der Status bleibt, es kommt nur
`ledgerCheckedAt` dazu. Jede gespeicherte Klärung,
auch die von `submit_unclear`, setzt `ledgerCheckedAt`; danach wird der Job nie wieder abgefragt. Alles andere
(Horizon-Fehler, 404 vor der Marge, `successful` fehlt, fremder Hash im Datensatz) speichert nichts, das nächste
Lesen fragt erneut. Es wird nie gesendet.

Liste und Detail tragen `ledgerCheckPending` (nur in der Antwort, nie gespeichert): Der Job ist Kandidat, seine
Sequence ist verbraucht oder unbekannt (Horizon-Fehler), und die Anfrage hat ihn nicht geklärt. Das Frontend zeigt dann
statt „Lege den Auftrag bei Bedarf neu an“ den Hinweis, dass noch geklärt wird, ob die Transaktion schon im Ledger
steht, und dass der Auftrag bis dahin nicht neu angelegt werden soll. In der Liste lässt sich ein solcher Job nicht
auswählen (das Backend lehnt das Löschen ohnehin mit 409 ab). Das Detail braucht ein Job-Token; ohne gemerkten Key lädt
es nicht und übernimmt Status und `ledgerCheckPending` aus der Liste, die ohne Token klärt.

Zwei Schreibwege sichern das ab: Das Anlegen lehnt eine Transaktion ab, deren Sequence schon verbraucht oder deren
`maxTime` vorbei ist (409 `tx_not_viable` mit `status`), sonst ließe sich eine alte, schon ausgeführte Transaktion eines
fremden Kontos als Job unterschieben und erschiene als „außerhalb von SKM gesendet“. Das Löschen lehnt einen
ungeprüften Kandidaten mit verbrauchter Sequence ab (409 `ledger_check_pending`), damit der Nachweis nicht vor der
Klärung verschwindet.

## Begründung

- SKM sendet nur über den Write-ahead `submit_unclear` (R-3). Steht ein Job mit einem anderen nicht abgeschlossenen
  Status im Ledger, wurde er nicht über diesen Job gesendet: außerhalb von SKM oder über einen anderen Job mit derselben
  Transaktion (das Anlegen prüft keine doppelten Hashes), bei Altjobs von vor R-3 auch durch ein zweites Senden von SKM.
  `submittedExternally` und der Text sagen deshalb nur „Im Ledger gefunden, nicht über diesen Job gesendet“, nicht
  wer und nicht „außerhalb von SKM“.
- Eine Klärung statt zwei: gleiche Abfrage, gleiche R-1-Regel, gleiches Budget von 5 je Anfrage
  (`SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST`), gleicher Lock.
- Reihenfolge im Budget (`compareResolvePriority`): `submit_unclear` zuerst (Sendeschutz). Dann Kandidaten mit
  mindestens einer gültigen gesammelten Signatur eines Signers des Job-Kontos vor Jobs ohne Signatur: Jobs anlegen kann
  jeder, eine gültige Signatur erzeugen nur ein Signer. Untergeschobene unsignierte Jobs verdrängen einen echten
  Kandidaten deshalb nicht; sie bleiben Kandidaten, nur zuletzt. Innerhalb jeder Gruppe zuerst Kandidaten, deren
  `maxTime` plus 60 s laut Serveruhr vorbei ist (ein 404 kann dort schon endgültig sein), dann älteste `maxTime`,
  ohne Zeitgrenze zuletzt. So verhungern entscheidbare Jobs nicht hinter einem widerrufenen Job, der bis
  `maxTime` plus 60 s bei jedem Lesen 404 liefert.
- Fee-Bump als Hülle braucht keinen eigenen Code: Testnet-Probe vom 16.11.2026, `GET /transactions/{innerHash}`
  liefert 200 mit `hash` gleich dem inneren Hash, `inner_transaction.hash` und `fee_bump_transaction.hash`. Der
  Datensatz zählt nur, wenn `hash` oder `inner_transaction.hash` dem abgefragten Hash gleicht
  (`transactionLookupFromRecord`).
- Ein Widerruf (`bumpSequence`) hat einen anderen Hash: Der Job-Hash ergibt 404, nach der Marge `obsolete_seq`.

## Verworfene Alternativen

- **Nur offene Jobs prüfen:** Wächter und Merge machen offene Jobs ohne Ledger-Prüfung endgültig. Liest niemand den
  Job zwischen externem Senden und `maxTime`, bliebe er für immer `expired`.
- **Eigener Hintergrundjob:** neuer Mechanismus mit eigener Last und eigener Fehlerbehandlung, PHP hat keinen Daemon.
- **`submittedResult` um Zeit erweitern:** ändert das F-3-Format samt Sanitizern in beiden Backends und im Frontend.
  Die Zeit steht in `submittedAt`.
- **Wächter und Merge erst nach Ledger-Prüfung speichern lassen:** zusätzliche Horizon-Abfragen in Schreibpfaden, die
  bewusst ohne Netz auskommen. Der Marker `ledgerCheckedAt` holt die Prüfung beim Lesen nach.

## Folgen

- Code: `isExternalCheckCandidate`, `compareResolvePriority`, `transactionLookupFromRecord`, `externalOutcome` in
  `services/submitUnclear.js` und `api/submitUnclear.php` (`skm_*`); `resolveUnclearJobs` und
  `lookupJobTransaction`/`lookupTransactionByHash` in `server.js` und `api/multisig.php`. Gespeichert wird unter dem
  Job-Lock nur, wenn der Job noch existiert, denselben Status wie beim Lesen hat und noch Kandidat ist.
  Dazu `externalUnconsumedOutcome`, `isPastMaxTimeByClock` (Endzustand mit freier Sequence) und in den Backends
  `sequenceAccountOf`, `sequenceConsumedFromMeta`, `isLedgerCheckPending` (`skm_*`).
  Frontend: Hinweis `job-submitted-externally` im Detail, `job-submitted-externally-hint` in der Liste,
  `job-ledger-check-pending` (Detail) und `job-ledger-check-pending-hint` (Liste), Texte nur DE.
  Die Hinweise zu fremder `op.source` erscheinen in Endzuständen nicht.
- Fixture `test/assets/external-submit.json` für beide Backends (Kandidaten, Datensatz, Ergebnis, Reihenfolge,
  Routenfälle).
- Neue Felder am Job: `submittedExternally` (true: im Ledger gefunden, nicht über diesen Job gesendet),
  `ledgerCheckedAt` (Zeitpunkt der Klärung, danach keine Abfrage mehr); `submittedAt` kommt bei extern gesendeten Jobs
  aus Horizon (fehlt `created_at`, steht `null`). Nur in der Antwort: `ledgerCheckPending`.
- Last: Für jeden Kandidaten lädt die Klärung Live-Kontodaten (gecacht 30 s), auch nach erschöpftem Budget, damit
  `ledgerCheckPending` stimmt. Ein Kandidat im Endzustand mit nicht verbrauchter Sequence kostet keine Abfrage der
  Transaktion und hört nach `maxTime` plus 60 s auf, Kandidat zu sein (Ledger-Zeit einmal je Netz und Anfrage). Ein
  widerrufener Job kostet bis `maxTime` plus 60 s (höchstens 7 Tage) je Lesen eine Abfrage im Budget.
- Ein Job ohne Zeitgrenze (`maxTime` 0, nur Altjobs: das Anlegen verlangt seit G5 eine Zeitgrenze) wird nie sicher
  nicht gefunden und nie über die Ledger-Zeit abgeschlossen: Ohne `maxTime` gibt es keinen Zeitpunkt, ab dem die
  Transaktion sicher nicht mehr ins Ledger kann. Er bleibt Kandidat, kostet je Lesen Kontodaten und steht in der
  Reihenfolge zuletzt. PHP entfernt solche Endzustände nach 30 Tagen (`pruneOldJobs`).
- Fee-Bump-Altjobs (von vor #15) haben keine eigene Sequence und werden nicht geprüft.
- Ein Dritter kann für ein fremdes Konto Jobs mit der nächsten Sequence anlegen (dazu braucht er keine Signatur, nur
  das Rate-Limit begrenzt). Verbraucht das Konto die Sequence danach, sind diese Jobs bis `maxTime` plus 60 s
  Kandidaten mit 404. Sie stehen hinter jedem Kandidaten mit gültiger Signatur. Belegen können sie das Budget nur vor
  einem echten Job ohne jede in SKM gesammelte Signatur (ganz außerhalb signiert); der bleibt dann in der Liste länger
  `obsolete_seq`, aber mit `ledgerCheckPending` und dem Hinweis, ihn nicht neu anzulegen. Nur Anzeige, gesendet wird
  nie. Das Detail ohne gemerkten Key klärt nicht (Token nötig); ein Klären ohne Token gibt es nur über die Liste, die
  ohnehin ohne Token lesbar und rate-limitiert ist.
- Löschen vor der Klärung: Ein Kandidat ohne Zeitgrenze (`maxTime` 0, nur Altjobs) ist nie sicher geklärt und lässt
  sich deshalb nicht löschen, solange seine Sequence verbraucht ist. Liest das Löschen bei einem nachhinkenden
  Horizon-Knoten eine noch nicht verbrauchte Sequence, ist es erlaubt; die laufende Klärung legt den Job dann nicht
  wieder an.
