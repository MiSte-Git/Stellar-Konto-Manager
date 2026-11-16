# Sicherheit: Modell, Grenzen, bewusste Entscheidungen

Stand: 08.11.2026 (nach Bündel 4b', Fee-Bump-Sperre und Fix von dessen Review). Pflichtlektüre vor jedem Security-Review, ob durch Mensch oder KI.

Ein Review, das nur den Code liest, sieht nicht, was gewollt ist. Dieses Dokument beschreibt Schutzziele,
Vertrauensgrenzen und die Entscheidungen, die **bewusst** so getroffen wurden. Ein Befund, der einer dieser
Entscheidungen widerspricht, ist nur dann ein Befund, wenn er einen Weg zeigt, den die Begründung nicht abdeckt.

Begründungen der wichtigsten Entscheidungen: [docs/adr/](adr/README.md). Vorlage für Reviews:
[docs/review-briefing.md](review-briefing.md).

## Sicherheitslücke melden

Bitte nicht als öffentliches Issue. Meldungen über GitHub, Reiter „Security“ → „Report a vulnerability“
(private Meldung).

## Was SKM ist

SKM ist eine **non-custodial** Wallet für Stellar als Single-Page-App im Browser. Dazu kommt ein kleines Backend für
Funktionen, die mehrere Personen betreffen (Multisig-Jobs, Bugtracker, Federation- und Token-Abfragen).

- Frontend: React/Vite, `frontend/`
- Backend Entwicklung: Node/Express, `server.js` und `services/`
- Backend Produktion: PHP auf Shared Hosting, `api/`
- Beide Backends müssen sich **gleich verhalten** (Dual-Backend-Parität). Jede Sicherheitsänderung gilt für beide.

## Schutzziele

1. **Secret Keys verlassen nie den Browser.** Kein Endpunkt nimmt einen Secret Key an. Signiert wird ausschließlich
   lokal.
2. **Ein Signer sieht, was er signiert.** Vor jeder Signatur zeigt SKM die Transaktion vollständig und lesbar an.
   SKM signiert nichts, was der Nutzer nicht bestätigt hat.
3. **Das Backend kann kein Geld bewegen.** Es speichert Transaktionen und Signaturen, kann aber keine gültige
   Signatur erzeugen. Ein kompromittiertes Backend kann stören (Jobs löschen, verfälschen, nicht weiterleiten), aber
   keine Transaktion ohne die Schlüssel der Signer gültig machen.
4. **SKM bewertet keine Tokens.** SKM zeigt Fakten (Master-Key-Status, TOML-Daten, StellarExpert-Tags, Flags), sagt
   aber nie, ob ein Token echt, sicher oder unsicher ist. Kein Text darf das in irgendeine Richtung andeuten.

## Was ausdrücklich nicht geschützt ist

- **Schadcode auf der Seite selbst (XSS, bösartige Browser-Erweiterung).** Wer JavaScript im Kontext der Seite
  ausführt, kann alles, was die App kann, auch gemerkte Secrets entschlüsseln. Dagegen schützen nur CSP, saubere
  Ausgabe und der Verzicht auf Fremdskripte, nicht die Verschlüsselung im Speicher. Das steht so auch in der UI.
- **Kompromittiertes Gerät des Nutzers.**
- **Doppeltes Senden über ein anderes Gerät, einen anderen Browser oder eine andere Wallet.** Die Sperre bei unklarem
  Sendestatus liegt im `localStorage` dieses Browsers und gilt nur dort. SKM kann dasselbe Konto auf einem anderen
  Gerät, in einem anderen Browser oder in einer anderen Wallet nicht sperren. Wer nach einem unklaren Ergebnis dort
  erneut sendet, bevor Horizon den Ausgang gezeigt hat, kann dieselbe Aktion doppelt ausführen (Einzahlen,
  Einlösen, Sammel-Tausch, Zahlung). Der Hinweiskasten sagt das in der Oberfläche (`browserOnlyHint` in
  `SendAmbiguousPanel.jsx`, auf jeder Seite mit Sendeweg), ebenso die Sperrtexte der Wege. Eine technische
  Lösung gibt es ohne Server-Zustand pro Konto nicht, und der Server soll keine Konto-Aktivität speichern.
- **Kompromittierter Webhoster.** Frontend und PHP-Backend liegen auf demselben Host. Wer den Host kontrolliert, kann
  das ausgelieferte JavaScript tauschen. Maßnahmen gegen ein bösartiges Backend sind trotzdem gewollt (siehe
  Zweckbindung), gelten aber als Verteidigung in der Tiefe, nicht als vollständiger Schutz.
- **Verfügbarkeit.** Shared Hosting ohne Schutz vor gezielter Überlastung. Rate-Limits begrenzen Missbrauch, sie
  garantieren keinen Betrieb.
- **Fremde Dienste.** Horizon, StellarExpert und Home-Domains liefern Daten, die SKM anzeigt, aber nicht verbürgt.

## Vertrauensgrenzen

| Bereich | Vertraut | Nicht vertraut |
|---|---|---|
| Browser | eigener Code der App | Eingaben, Memos, Daten von Horizon/TOML/StellarExpert, Inhalte aus Links und Dateien |
| Backend | eigene Konfiguration | jeder Request; Job-Daten von anderen Nutzern; jede Angabe des Clients über Signer oder Gewichte |
| Stellar-Netz | Horizon als Quelle für aktuelle Signer und Thresholds | Daten in Transaktionen, die ein anderer angelegt hat |

Folgen daraus:
- Das Backend prüft Signer **live gegen Horizon**, nicht gegen gespeicherte Daten oder Client-Angaben.
- Das Frontend prüft eine Job-Transaktion selbst (Hash, Quelle, Netz) und verlässt sich nicht auf das Backend.

## Wichtige Abläufe

### Secret Key im Browser

- Abgefragt wird ein Secret Key **erst, wenn signiert werden muss**, nicht beim Öffnen eines Kontos.
- „Für diese Sitzung merken“: AES-GCM-verschlüsselt in `sessionStorage`. Der Schlüssel liegt nur im Arbeitsspeicher
  und wird bei jedem Neuladen neu erzeugt, ein Reload macht also alle gemerkten Secrets unbrauchbar. Löschung nach
  15 Minuten Inaktivität und beim Schließen des Tabs. Gemerkte Keys sind ans Netz gebunden (Speicherschlüssel mit
  Netz): Ein auf Testnet gemerkter Key signiert nie auf Mainnet. Code: `frontend/src/utils/sessionSecrets.js`.
  Ein Eintrag ohne `enc1:`-Präfix (Klartext aus der Zeit vor der Verschlüsselung) gilt als nicht gemerkt: Er wird nie
  im Klartext zurückgegeben und beim Lesen entfernt; der Aufrufer fragt den Key dann wie sonst ab (Review Fable, F-12).
- Der Haken „Für diese Sitzung merken“ ist in allen Key-Dialogen standardmäßig an, auch in der Sammelzahlung
  (bewusste Entscheidung 14.11.2026, Opus-Review #11: einheitlich wie in den anderen Abläufen). Die Sammelzahlung merkt
  den Key schon beim Bestätigen im Dialog, weil sie danach mehrere Zahlungen mit ihm sendet; die anderen Abläufe erst
  nach erfolgreichem Senden.
- Eingegebene Secrets werden in Entwürfen, Listen und der Eingabe-Historie nicht gespeichert (`containsSecretKey` in
  `frontend/src/utils/secretKeyDetection.js`, mit Prüfsumme, auch über Trennzeichen). Die Eingabe-Historie
  (`utils/inputHistory.js`, alle `TEXT_INPUT_HISTORY_KEYS`: Empfänger, Beträge, Memos, `recentWallets`) lässt beim
  Schreiben jeden Eintrag mit Secret Key weg und bereinigt beim Lesen den Altbestand (einmal zurückgeschrieben, ohne
  Event); „Zahlung senden“ nimmt ihn auch nicht in die Vorschlagsliste auf. Vorher landete ein ins Empfänger- oder
  Memo-Feld eingefügter Secret Key beim Verlassen des Feldes im `localStorage` und als Vorschlag (Review Fable, F-4).
- Ausnahme Lernbereich: Der Story-Modus erzeugt ein zufälliges Keypair nur für das Testnet. Dessen Secret liegt
  unverschlüsselt im `sessionStorage` (`stellar_story_keypair`) und endet mit dem Tab, der Fortschritt im
  `localStorage` enthält keinen Secret. Ältere Einträge mit Secret im `localStorage` werden beim Laden in den
  `sessionStorage` übernommen und dort entfernt. Code: `frontend/src/components/story/StoryContext.jsx`.

### Multisig-Jobs

Ein Job ist eine unsignierte oder teilsignierte Transaktion, die mehrere Signer nacheinander signieren.

- **Anlegen** ist ohne Anmeldung möglich (Rate-Limit). Der Server prüft: XDR dekodierbar, Netz bekannt,
  Transaktionsquelle = Job-Konto (auch bei M-Adresse über das Basiskonto), Gültigkeitsfenster begrenzt. Ohne
  Signer-Daten aus Horizon entsteht kein Job: Horizon nicht erreichbar ergibt 503 `horizon_unavailable`, Konto
  unbekannt (Horizon 404) 400 `account_not_found` (beide Backends). Früher entstand dann ein Job mit leeren
  Signern und nötigem Gewicht 1, der falsch angezeigt wurde (Review Fable, Befund F-8).
- **Lesen** (Liste, Detail, Ablehnen, Löschen): Offene Jobs werden live neu berechnet, wenn Horizon antwortet
  (Signer, Schwellen, nötiges Gewicht, gesammeltes Gewicht über `verifyCollected`, Status), nichts davon wird
  gespeichert. Ein inzwischen entfernter Signer zählt also nicht mehr. Antwortet Horizon nicht, gilt der
  gespeicherte Stand. Endzustände werden ohne Horizon-Abfrage aus dem gespeicherten Stand gezeigt. Auf gespeicherte
  `collectedSigners` wird nur bei nicht lesbarem XDR zurückgegriffen (`summarizeJob` in `api/multisig.php`,
  `recomputeJobState` in `server.js`; Befund F-11). Die Sequenz für den Lebenszyklus kommt von `accountId`; das
  reicht, weil Anlegen und Merge Quelle = `accountId` erzwingen (K1). Den Status `submit_unclear` lässt die
  Neuberechnung stehen (siehe Unklares Sendeergebnis).
- **Signatur hinzufügen (Merge):** Der Server übernimmt nur Signaturen von aktuellen Signern des Kontos, je Signer
  höchstens eine (die zuerst vorhandene, also die schon gespeicherte) und insgesamt höchstens 20 Signaturen
  (Stellar-Grenze, `services/txSignatures.js`, `api/txSignatures.php`). Grund für „je Signer eine“: Ed25519 erlaubt
  mehrere verschiedene gültige Signaturen desselben Keys; zwei davon im Envelope lehnt das Netz mit
  `tx_bad_auth_extra` ab, ein Mitsigner könnte den Job so sabotieren (Review Fable, Befund F-5). Merge prüft zuerst
  den Hash, dann die Quelle. Antwortet Horizon beim Merge nicht, antworten beide Backends 502 `signers_unavailable`
  und ändern nichts (Node rechnete früher mit dem gespeicherten Stand weiter und sendete gegebenenfalls, Befund F-9).
- **Job-Token:** Wer Job-Details lesen will, braucht ein Token (Header `x-job-token`, nie in der URL). Es gibt das
  Token beim Anlegen oder über eine **Challenge**: Der Server erzeugt eine Nonce für Job und Signer (60 s gültig,
  einmalig), der Client signiert sie lokal und schickt sie mit der Signatur zurück (Feld `challenge`), der Server
  prüft die Signatur und ob der Key aktuell Signer des Kontos ist. Je Job und Signer können mehrere Challenges offen
  sein (höchstens 5, dazu weiter 20 je Job und 2000 gesamt; bei Überlauf fällt jeweils die älteste weg). Schlüssel
  ist die Nonce. Token, Ablehnen und Löschen verbrauchen nur genau die mitgeschickte Nonce, und nur wenn sie für
  diesen Job und diesen Signer ausgestellt wurde; das geschieht vor der Signaturprüfung und unabhängig von deren
  Ergebnis (kein Replay). Andere offene Challenges desselben Signers bleiben. Fehlt die Nonce im Body, ist sie keine
  strikte base64 mit genau 32 Byte, unbekannt, abgelaufen oder für einen anderen Job oder Signer ausgestellt,
  antworten beide Backends 400 `challenge_missing_or_expired`; eine fremde Nonce wird dabei nicht verbraucht.
  Vorher gab es je Job und Signer genau eine Challenge: Wer Job-ID und Signer-Adresse kannte (beides öffentlich),
  konnte sie per `POST /challenge` ersetzen oder mit einer falschen Signatur verbrauchen und so Anmeldung, Ablehnen
  und Löschen eines ehrlichen Signers scheitern lassen (Sabotage, kein Geldrisiko). Code und gemeinsame Fälle:
  `services/challengeStore.js`, `api/challengeStore.php`, `test/assets/challenge-cases.json`. In PHP liegen die Challenges in `api/data/challenges.json`; scheitert dort das Schreiben (Kodieren,
  Temp-Datei oder Umbenennen), antworten Challenge, Token, Ablehnen und Löschen mit 500 und geben keine Nonce
  heraus. Vorher wurde der Fehler verschluckt, und eine Nonce ließ sich bis zum Ablauf mehrfach einlösen (F-13).
  Ein 503 `horizon_unavailable` bei Token, Ablehnen oder Löschen verbraucht die mitgeschickte Challenge ebenfalls; der nächste
  Versuch holt eine neue (bewusst so, B3-7: Verbrauch unabhängig vom Ausgang, kein getrenntes Lesen und Verbrauchen
  an der Stelle, die die Zweckbindung trägt). Mit gemerktem Key oder einem schon eingegebenen Key im Job-Detail
  (Entsperren, Ablehnen) geht der nächste Versuch ohne neue Eingabe. Beim Löschen in der Liste mit eingegebenem Key
  muss der Key danach neu eingegeben werden, weil das Feld nach jedem Lauf geleert wird, auch bei Fehlschlag (kein
  Secret im Feld stehen lassen).
- **Zweckbindung:** Signiert wird nie die rohe Nonce, sondern `skm:<zweck>:` plus Nonce (`token`, `decline`,
  `delete`). Grund: Eine Stellar-Transaktionssignatur ist eine Ed25519-Signatur über 32 Bytes (Hash). Würde der Client rohe 32 Bytes
  signieren, könnte ein bösartiges Backend einen Transaktions-Hash als „Challenge“ schicken und bekäme eine gültige
  Transaktionssignatur. Mit Präfix ist keine signierte Nachricht 32 Bytes lang, und eine Signatur für einen Zweck
  gilt nicht für einen anderen. Code: `services/challengeStore.js`, `api/challengeStore.php`,
  `frontend/src/utils/multisigApi.js`. Das hängt nicht am Server: Der Client signiert nur eine Nonce, die strikte
  base64 mit genau 32 Byte ist (gleiche Strenge wie K5 im Backend, `decodeChallengeNonce`), sonst nichts und mit
  Hinweis. Mit einer 22-Byte-Nonce wäre `skm:token:` plus Nonce sonst genau 32 Byte lang (Review Fable, F-6).
- **Ablehnen:** nur aktuelle Signer, nicht nach eigener Signatur, nicht im Endzustand und nicht bei
  `submit_unclear` (409). Gewicht und Threshold kommen live.
- **Löschen** (`POST /api/multisig/jobs/:id/delete`): nur aktuelle Signer des Job-Kontos (live geprüft, Gewicht > 0),
  Besitznachweis per Challenge mit Zweck `delete`, nur im Endzustand (sonst 409 `not_final`). Das Job-Token reicht
  nicht: Es hat auch, wer den Job angelegt hat, und es bleibt gültig, wenn ein Signer später entfernt wird
  (Review Runde 2, Befund C1). Das Löschen aller Jobs eines Netzes bleibt dem Admin-Endpunkt mit
  `MULTISIG_ADMIN_TOKEN` vorbehalten.
- **Signer-Prüfung bei Horizon-Ausfall:** Token, Ablehnen und Löschen prüfen die Signer live. Ist Horizon nicht
  erreichbar (Netz, Timeout 10 s, 5xx), antworten beide Backends 503 `horizon_unavailable`, nicht 403: Der Ausfall sagt
  nichts über die Signer, und die UI soll nicht „kein Signer“ melden. Ein Horizon-404 (Konto unbekannt) bleibt 403
  `forbidden`. Der Timeout verhindert, dass ein hängendes Horizon den Job-Lock (Node) belegt.
- **Speicherfehler und kaputtes JSON:** Schlägt das Schreiben der Jobdatei fehl, melden Anlegen, Merge, Ablehnen und
  Löschen in beiden Backends 500 und nie Erfolg (Node nimmt den Job dann auch wieder aus dem Speicher). Kaputtes JSON im
  Body ergibt 400 `invalid_json` ohne Stacktrace und ohne Body-Inhalt. Sendet das Backend (Anlegen oder Merge erreicht
  die Schwelle), speichert es den Job **vorher** als `submit_unclear` (Write-ahead, mit der neuen Signatur), sendet erst
  danach und schreibt dann das Ergebnis, und zwar nur, wenn der Job noch `submit_unclear` ist (`applySubmitOutcome` in
  `server.js` und `api/multisig.php`; Node hält dabei den Job-Lock, PHP gibt den Dateilock während des POST frei).
  Scheitert das Speichern vor dem POST, wird nicht gesendet (500 `multisig.jobs.save_failed` bzw. `merge_failed`).
  Scheitert es danach, lautet der Code `multisig.jobs.save_failed_after_submit` (500, beide Backends); der Job steht dann
  als `submit_unclear` in der Datei und wird über die Klärung entschieden, nie erneut gesendet. Dasselbe gilt, wenn der
  Prozess zwischen POST und Speichern stirbt. Vorher blieb in beiden Fällen der alte Stand (pending/ready) stehen, ein
  weiterer Merge sendete erneut, und eine schon ausgeführte Transaktion konnte als `obsolete_seq` enden (Review
  Fixrunde Opus, R-3). Damit sendet das Backend jede Transaktion eines Jobs höchstens einmal: Ein Job, der einmal
  gesendet wurde, ist `submit_unclear` oder final, und beide nehmen keinen Merge mehr an. Die Abbildung
  `tx_bad_seq`/`tx_too_late` auf `obsolete_seq`/`expired` beim Merge betrifft also nur das erste und einzige Senden; ein
  Weg, der einen schon gesendeten Job ohne Hash-Abfrage `obsolete_seq` setzt, bleibt nicht. Offen bleibt nur ein Einreichen
  außerhalb des Backends (ein Signer reicht das angezeigte XDR selbst ein): Dann zeigen Lesen und Merge `obsolete_seq`,
  weil das Backend davon nichts weiß.
- **Sendeergebnis (`submittedResult`):** Beide Backends speichern und liefern nur Fehlertext und `result_codes`
  (Ablehnung) bzw. Hash und Ledger (Erfolg), nie `envelope_xdr` oder `result_xdr` aus der Horizon-Antwort
  (`services/submitResult.js`, `api/submitResult.php`). Grund: Die Job-Liste ist ohne Token lesbar (G-Adresse reicht);
  mit dem signierten Envelope könnte ein Dritter eine nur vorläufig abgelehnte Transaktion (z. B.
  `tx_insufficient_fee`) bis `maxTime` selbst einreichen. Altjobs mit vollständiger Antwort werden bei jeder Ausgabe
  (Liste, Detail, Merge, Anlegen) bereinigt (Review Fable, Befund F-3) und zusätzlich bei jedem Schreiben der Jobdatei
  (`saveMultisigDb` in `server.js`, `saveJobs` in `api/multisig.php`, über alle Jobs, idempotent): Sobald die Datei
  einmal geschrieben wird, steht auch kein alter Envelope mehr darin, der sonst mit einem Backup oder einer Kopie
  der Datei weiterwandern würde (Review Fixrunde Opus, R-7).
- **Unklares Sendeergebnis (`submit_unclear`):** Kommt beim Senden durch das Backend (Anlegen oder Merge) keine
  eindeutige Antwort, wird der Job `submit_unclear`, nicht `submitted_failed`. Unklar heißt: keine Antwort, Timeout
  (20 s in beiden Backends), Status 0, HTTP 408, 429 oder ab 500 ohne `result_codes`, oder 2xx ohne Hash. Mit
  `result_codes` ist es eine Ablehnung wie bisher (`tx_bad_seq`/`tx_too_late` beim Merge als `obsolete_seq`/`expired`).
  Als `result_codes` zählen nur echte Codes: `transaction` oder `inner_transaction` als String oder mindestens ein
  String in `operations`; ein leeres Objekt, eine leere oder nicht lesbare Liste zählt nicht (beide Backends gleich,
  gemeinsame Fälle in `test/assets/submit-classification.json`, Review Fixrunde Opus R-6). Node sendet ohne die
  SEP-29-Prüfung des SDK (`skipMemoRequiredCheck`), wie PHP: Sonst lud das SDK vor dem POST die Zielkonten, und ein
  Memo-Pflicht-Ziel oder ein Ladefehler ergab `submit_unclear`, obwohl nichts gesendet war (R-5). Grund: Die
  Transaktion kann trotz Timeout im Ledger landen. Als `submitted_failed` hätten die Signer dieselbe Zahlung neu
  angelegt, und sie wäre doppelt ausgeführt worden (Review Fable, Befund F-2). Der Status ist nicht final, aber
  gesperrt: Merge und Ablehnen antworten 409 `submit_unclear`, Löschen 409 `not_final`, es wird nie erneut gesendet;
  die Live-Neuberechnung und der Ablaufwächter `expireStalePendingJobs` ändern ihn nicht. Geklärt wird beim Lesen
  (Liste, Detail). Abgefragt wird `GET /transactions/{hash}`, sobald die Sequence der Tx-Quelle verbraucht ist
  (Konto-Sequence ≥ Tx-Sequence) oder `maxTime` laut Serveruhr vorbei ist. Die Serveruhr bestimmt nur, wann gefragt
  wird, nie den Ausgang. Gefunden ist sofort endgültig: erfolgreich ergibt `submitted_success` (Hash, Ledger),
  fehlgeschlagen `submitted_failed`. Ein 404 ist erst endgültig, wenn Horizon einen Ledger meldet, der mehr als 60 s
  nach `maxTime` geschlossen wurde (`history_latest_ledger_closed_at` aus `GET /`,
  `SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS`, nur nach einem 404 abgefragt, einmal je Netz und Anfrage): bei verbrauchter
  Sequence `obsolete_seq` (eine andere Transaktion hat sie verbraucht), sonst `expired`. Grund: Eine Transaktion kann
  nur in einen Ledger mit Schließzeit ≤ `maxTime`; hat der Knoten einen späteren Ledger aufgenommen, kennt er alle
  davor. Die Marge von 60 s gilt, weil Ledger-Zeit und Transaktion zwei Anfragen sind und hinter dem Load Balancer
  verschiedene Knoten treffen können: Der Knoten der Transaktionsabfrage müsste dann über 60 s zurückliegen statt nur
  einen Ledger. Gleiche Marge wie der strenge Pfad im Sendeschutz des Frontends. Vorher, ohne Ledger-Zeit oder bei unlesbarer Ledger-Zeit bleibt der Job bei 404
  unklar und es wird nichts gespeichert, auch wenn die Sequence schon verbraucht ist. Früher entschied die Serveruhr
  mit 120 s Karenz (`SUBMIT_UNCLEAR_GRACE_SECONDS`, entfallen): Hinkte ein Horizon-Knoten mehr als 120 s nach oder ging
  die Serveruhr vor, wurde eine ausgeführte Transaktion als `expired` gespeichert, die Signer hätten sie neu angelegt
  (Review Fixrunde Opus, R-1). Jeder andere Fehler lässt den Job ebenfalls unklar. Ohne Live-Kontodaten wird nicht geklärt. Gespeichert wird unter dem Job-Lock und nur,
  wenn der Job dort noch `submit_unclear` ist; höchstens 5 Klärungen je Anfrage
  (`SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST`). Code: `services/submitUnclear.js`, `api/submitUnclear.php`. Das
  Job-Detail zeigt einen Hinweis (nicht neu anlegen, nicht anderswo senden) und keine Knöpfe für Signieren, Import und
  Ablehnen. Die Ergebnisdialoge nach dem Anlegen oder nach „Jetzt signieren“ (`MultisigResultDialog`,
  `MultisigPrepareDialog`, auch in den Multisig-Einstellungen mit gemerktem Key) zeigen den Status aus der Antwort des
  Backends: bei `submit_unclear` denselben Hinweis, bei `submitted_success` und `submitted_failed` den
  Ausgang, nie „noch nicht gesendet“ und kein weiteres Signieren. Vorher stand dort auch nach dem Senden durch das
  Backend „Die Transaktion wurde noch nicht gesendet“, und die Nutzerin hätte die Zahlung erneut gesendet (Review
  Fixrunde Opus, R-2). Der Widerruf (Sequence verbrauchen) bleibt erlaubt. Er baut eine
  `bumpSequence`-Transaktion mit genau der Sequence des Jobs; im Netz kann also höchstens eine der beiden ausgeführt
  werden. Gelingt er, ist der Job sicher ungültig. Zeigt das Konto die Sequence schon als verbraucht, wird nichts
  gesendet: Bei `submit_unclear` wurde dann vermutlich gerade dieser Job ausgeführt, SKM meldet das (Text
  `detail.revoke.unclearConsumed`, nicht „bereits ungültig“) und lädt den Job neu, was die Klärung auslöst (Review
  Fixrunde Opus, R-4). Hinkt das Konto bei Horizon nach, obwohl die Transaktion schon im Ledger steht, lehnt das Netz
  den Widerruf mit `tx_bad_seq` ab.
- **Nebenläufigkeit:** Node serialisiert Merge, Ablehnen und Löschen je Job (`services/multisigJobLock.js`), PHP
  arbeitet unter Dateilock. Endzustände werden im Lock geprüft.
- **Anzeige vor dem Signieren** (`frontend/src/utils/multisig/describeTransaction.js`,
  `frontend/src/components/multisig/TransactionFacts.jsx`): Quelle, Sequence, Memo (unsichtbare Zeichen maskiert),
  Fees, Zeitfenster und Ledger-Grenzen, Operationen mit `op.source`, Extra Signer, Fee-Bump.
- **Fee-Bump ist als Job gesperrt (#15).** Beide Backends lehnen ihn beim Anlegen und beim Merge mit 400
  `fee_bump_not_supported` ab (vor Quelle, Zeitgrenze und Hash), das Frontend sperrt ihn im Job-Detail ohne
  Bestätigung (`verifyJobTransaction`, Grund `fee_bump`). Grund: Eine Signatur auf der Hülle autorisiert nur das
  zahlende Konto, nicht die angezeigten Operationen. Der Widerruf (Sequence verbrauchen) bleibt für gespeicherte
  Fee-Bump-Altjobs möglich, aber nur nach bestandener Hash-Prüfung: Der Hash der Hülle wird wie bei jeder Transaktion
  gegen `job.txHash` verglichen, bei Abweichung (`hash_mismatch`) ist auch der Widerruf gesperrt. Der Widerruf baut nie
  aus einem ungeprüften Server-XDR.
- **Typ- und Reihenfolge-Regeln sind in beiden Backends gleich:** Ein `txXdr` oder `signedXdr`, das kein String oder leer
  ist, ergibt 400 `invalid_xdr` (nie 500). Beim Merge kommen Job (404) und Token (403) vor der XDR-Prüfung. Ein
  `network`, das kein String ist (Array, Zahl, Objekt), ergibt beim Anlegen 400 `invalid_network` (nie 200, nie 500).
- **Bugreports tragen kein Zugriffstoken:** Die Seitenadresse im Bugreport wird über `reportUrl()` gebildet
  (`frontend/src/utils/reportUrl.js`): Query-Parameter und Fragment mit „token“ werden entfernt.
- **Eigenes Konto als `op.source`** sperrt das Signieren hart, ohne Bestätigungs-Checkbox.
- **Fremde `op.source` wird nie automatisch gesendet** ([ADR 0013](adr/0013-fremde-op-source-kennzeichnen-nicht-senden.md)).
  Das nötige Gewicht kommt nur aus dem Job-Konto; für Operationen mit anderer Quelle prüft das Netz deren Signer und
  Thresholds, die das Backend nicht kennt. Beide Backends vermerken diese Konten am Job (`foreignOpSourcesOf` in
  `services/txSignatures.js` und `api/txSignatures.php`, Basiskonto, M-Adresse aufgelöst, beim Fee-Bump die innere
  Transaktion; Feld `foreignOpSources`, beim Lesen aus dem XDR) und senden beim Anlegen und beim Merge nicht, auch wenn
  das Gewicht des Job-Kontos erreicht ist: Der Job bleibt `ready_to_submit`. Vorher wurde er gesendet und endete mit
  `tx_bad_auth` als `submitted_failed`. Signaturen von Signern fremder Konten verwirft der Merge weiter (nur Signer des
  Job-Kontos zählen, sonst `tx_bad_auth_extra`); fertig signieren und senden geht nur außerhalb von SKM über den
  XDR-Export. Ablehnen rechnet weiter nur mit dem Job-Konto. Gemeinsame Fälle: `test/assets/foreign-op-sources.json`.
  Die Detailseite nimmt die fremden Konten aus dem XDR, die Liste des Backends nur ohne dekodierbares XDR. Den
  Exporthinweis zeigt sie nicht, wenn ADR 0005 (eigenes Konto als `op.source`) oder die Integritätsprüfung sperrt; beim
  eigenen Konto steht stattdessen die Warnung, die Operation nirgends zu signieren. Der Hinweis richtet sich an den
  Ersteller des Jobs, nicht an Signer der fremden Konten.

### Weitere Schutzmaßnahmen

- SSRF-Schutz für serverseitige Abrufe (TOML, Federation): Auflösung und Prüfung der Ziel-IP, Größenlimits, eine
  Stelle je Backend (`services/ssrfGuard.js` für Trading und Federation, `api/ssrfGuard.php`). Adressen werden binär
  geprüft (Node `net.isIP` und Bytes, PHP `inet_pton`), für literale Hosts und für jedes DNS-Ergebnis (Node im
  Lookup des Agents, ohne zweite Auflösung). Gesperrt: 0.0.0.0/8, 10/8, 100.64.0.0/10, 127/8, 169.254/16, 172.16/12,
  192.0.0.0/24, 192.168/16, 198.18.0.0/15, ab 224.0.0.0; `::`, `::1`, fe80::/10, fec0::/10, fc00::/7, ff00::/8.
  IPv4-mapped (`::ffff:0:0/96`) und IPv4-compatible (`::/96`) gelten wie ihre IPv4-Adresse, auch in Hex
  (`::ffff:7f00:1`). Weitere IPv6-Formen mit eingebetteter IPv4 sind ganz gesperrt, auch mit öffentlicher IPv4,
  weil ein Relay oder Übersetzer sonst eine interne Adresse erreichen könnte: NAT64 (64:ff9b::/96, 64:ff9b:1::/48),
  SIIT (::ffff:0:0:0/96), 6to4 (2002::/16) und Teredo (2001::/32). Ungültige Adressen sind gesperrt.
  Dokumentationsnetze bleiben erlaubt (nicht routbar), auch 2001:db8::/32. Gemeinsame Fälle: `test/assets/ssrf-addresses.json`. Vorher erkannte Node
  `::ffff:7f00:1` nicht als Loopback, und beide ließen 100.64/10, 198.18/15 und NAT64 durch, PHP auch `::7f00:1`
  (Review Fable, F-7). Die stellar.toml und jede von Hand verfolgte Weiterleitung gehen nur über https
  (`nextRedirectUrl` bzw. `skm_next_redirect_url`, in PHP zusätzlich `CURLOPT_PROTOCOLS` und
  `CURLOPT_REDIR_PROTOCOLS`); Federation folgt keinen Weiterleitungen.
- CORS-Allowlist (`services/corsConfig.js`, `api/cors.php`). Fremde Origins werden abgewiesen (Review Runde 2,
  Befund G3): Hat ein Request einen `Origin`-Header außerhalb der Allowlist (auch leer oder `null`), antworten beide
  Backends sofort mit 403 `forbidden_origin`, auch beim Preflight, bevor Body-Parser, Session oder Handler laufen.
  Vorher fehlte nur `Access-Control-Allow-Origin`; einfache Cross-Origin-Requests (Formular, `text/plain`) liefen
  bis in den Handler, und PHP las ihren Body als JSON. Ohne `Origin`-Header bleibt alles erlaubt (gleiche Origin,
  Skripte, Monitoring), denn ein Browser sendet bei Cross-Origin-Requests und bei jedem POST immer eine Origin. Die 403 hat `Cache-Control: no-store`, `Vary: Origin` steht auf jeder CORS-Antwort. Das Trimmen von `PROD_ORIGIN` nutzt in beiden Backends dieselben Zeichen (nur ASCII-Whitespace und NUL), damit ein Wert mit NBSP oder BOM nicht in Node gilt und in PHP nicht; auch die Regex ist gleich (kein `s`-Flag), ein Zeilenumbruch im Pfad macht den Wert in beiden ungültig.
  Allowlist in beiden Backends gleich (`localhost:5173`, `127.0.0.1:5173`, `https://skm.steei.de`, `PROD_ORIGIN`
  normalisiert auf Schema, Host, Port); nur Node nimmt zusätzlich die Origin aus `PROD_API_URL` auf. Kein
  PHP-Endpunkt ist für fremde Origins gedacht, auch `federation.php` nicht (löst nur für das eigene Frontend auf,
  SKM ist kein Federation-Server).
- Admin-Requests mit Origin- und Content-Type-Prüfung (Review Runde 2, Befund G4): Login, Logout und
  Bugreport-Update nur, wenn `Origin` vorhanden ist und exakt in der CORS-Allowlist steht (sonst 403
  `forbidden_origin`); Login und Update zusätzlich nur mit `Content-Type: application/json` (sonst 415
  `unsupported_media_type`). Grund: `SameSite=Lax` hilft nicht gegen eine Seite derselben Site (andere Subdomain),
  und PHP las JSON auch aus einem `text/plain`-Formular ohne Preflight. Geprüft wird vor Login-Rate-Limit und
  Admin-Prüfung, ein abgewiesener Request verbraucht also keinen Login-Versuch und berührt die DB nicht.
  Code: `services/requestGuard.js`, `api/requestGuard.php`. Das öffentliche Anlegen von Bugreports bleibt offen.
- Rate-Limits je IP (R-8). PHP: alle Bereiche über `api/rateLimit.php`, je Bereich eine eigene Datei unter
  `api/data/`, gleiche IP-Bildung (IPv6 je /64, IPv4-mapped `::ffff:a.b.c.d` als IPv4), Lock-Datei, höchstens 5000
  Einträge je Datei (die ältesten Fenster fallen zuerst weg), fail open nur für den Limiter selbst (beim
  Admin-Login nur beim Schreiben: eine gespeicherte Sperre gilt auch ohne öffenbare Lock-Datei). Budgets:
  Federation 30 je 60 s (429 `federation.rateLimited`, nur Header `Retry-After`), Bugreport anlegen 10 je 60 s,
  Job anlegen 20 je 300 s, Jobliste (`GET /api/multisig/jobs`) 60 je 60 s, `POST /challenge` 20 je 60 s (alle
  429 `too_many_requests` mit `retryAfter` und `Retry-After`). Admin-Login zählt nur Fehlversuche: nach 5 im
  Fenster von 15 Minuten ist die IP 15 Minuten gesperrt (429 `too_many_attempts`), ein Erfolg löscht den Zähler
  (`rateLimitFailureCheck`, `rateLimitFailureRecord`). Vorher zählten Bugreport, Job anlegen und Admin-Login
  jede IPv6-Adresse einzeln und waren per Adresswechsel im eigenen /64 umgehbar; die Jobliste hatte kein
  Limit. Node: eigener Limiter für Jobliste und Challenge (`services/rateLimit.js`, gleiches Budget und gleiche
  Antwort) und für Federation, alles andere nur über den globalen Limiter (100 je 15 min); alle Node-Limiter zählen
  IPv6 je /64 (`ipv6Subnet: 64`, Default der Bibliothek wäre /56). Das
  Budget der Liste: Das Frontend pollt nicht, es lädt beim Öffnen, bei Filterwechsel, Aktualisieren, nach dem
  Schließen eines Jobs und nach dem Löschen, je höchstens 2 Anfragen; Löschen selbst nutzt Challenge und Delete,
  nicht die Liste. Gemeinsame Werte: `test/assets/rate-limits.json`.
- Security-Header aus einer Quelle (`services/securityHeaders.js`, PHP-Zwilling `api/securityHeaders.php`): strikte
  CSP, `connect-src` nur zu bekannten Zielen.
- Datenordner auf dem Server per `.htaccess` gesperrt, Dateirechte eng. `api/.htaccess` sperrt zusätzlich `vendor/`,
  `vendor_old/`, `vendor_next/`, `composer.json` und `composer.lock` (403; Review Fable, F-14). Das Deploy bricht ab,
  wenn diese Regeln fehlen oder der api-Filter die `.htaccess` ausnimmt (`checkApiUpload` in `scripts/deploy-cyon.js`);
  die Wirkung prüft `test/apiHtaccess.test.js` mit Apache.
- Konstante Vergleiche für Geheimnisse (`hash_equals` in PHP).
- CSV-Exporte gegen Formel-Injection (`frontend/src/utils/csvEscape.js`).
- Keine Tokens, XDR oder Signaturen in Logs.

## Bewusste Entscheidungen (kein Befund)

| Entscheidung | Begründung |
|---|---|
| Kein CAP-21 (Preconditions) für Multisig-Jobs | Würde lang gültige signierte Transaktionen ermöglichen und den einzigen Abbruchweg (Verbrauch der Sequence) entfernen. Gewinn wäre nur Komfort. |
| `/challenge` prüft nicht gegen gespeicherte Signer | Signer können sich ändern (Key-Rotation). Geprüft wird live beim Einlösen. |
| Ein abgelehnter Job kann trotzdem eingereicht werden, wenn jemand das signierte XDR hat | Das Backend kann das nicht verhindern. Endgültig stoppt nur ein Widerruf (Sequence verbrauchen). So in der UI beschrieben. |
| „Ausblenden“ eines Jobs wirkt nur lokal (`localStorage`) | Reiner Komfort, ohne Wirkung auf Server oder andere Signer. |
| Alter offener Tab bekommt 403, bis er neu geladen wird | Folge der Zweckbindung; alte Clients signieren ohne Präfix. Gewollt. |
| Alter offener Tab ohne Nonce im Body bekommt 400 `challenge_missing_or_expired`, bis er neu geladen wird | Folge der Bindung an die Nonce; alte Clients schicken das Feld `challenge` nicht mit. Gewollt. |
| PHP cacht Signer bis 30 s | Weniger Horizon-Anfragen. Ein gerade entfernter Signer kann höchstens so lange noch als Signer gelten. |
| Node-Rate-Limits liegen im Speicher je Prozess | Node ist das lokale Entwicklungs-Backend. |
| Federation-Rückwärtssuche bleibt | Wird abgesichert statt entfernt. |
| Kein eigener Federation-Server | Vorerst nicht angeboten. |

## Akzeptierte Restrisiken

| Risiko | Warum akzeptiert |
|---|---|
| Sammelzahlung und „Zahlung senden“: Sperre gegen doppeltes Senden in zwei Tabs ist ohne Web Locks API nur probabilistisch (`localStorage`) | Moderne Browser haben Web Locks; Rest betrifft nur Altbrowser. |
| Sammelzahlung: nach Tab-Absturz bis 3 Minuten Wartezeit | Schutz vor Doppelzahlung geht vor. |
| Sammelzahlung: Fehltreffer der Warnhinweise nur bei ungültigen Eingaben | Kein Einfluss auf gültige Zahlungen. |
| „Zahlung senden“ und Sammelzahlung: Ein unlesbarer Eintrag wird über Horizon nur zeitlich freigegeben (erstes Erkennen plus Gültigkeit plus Puffer, Ledger-Zeit); ohne lesbaren Hash ist nicht bekannt, ob die Transaktion angewendet wurde. Ein unlesbarer Eintrag der Sammelzahlung sperrt bis dahin alle Konten im Netz | Nur bei beschädigtem localStorage; Hinweis auf den Kontoverlauf. Die Gültigkeit ist eine Konstante für alle Sendewege (`MAX_SEND_VALIDITY_SECONDS` = 180 s; Trading, Zahlung senden und Sammelzahlung), nicht der Wert der gerade offenen Seite: Der Eintrag liegt pro Konto unter einem Schlüssel und verrät nicht, welcher Weg ihn schrieb. `guardedSubmit` sendet nichts mit längerer Gültigkeit. Erstes Erkennen ist das Spätere aus lokaler Zeit und Ledger-Zeit (beim Erkennen, spätestens bei der ersten Prüfung festgehalten). Nur wenn Horizon beim Erkennen nicht erreichbar war und die Rechneruhr zwischen Senden und Erkennen zurückgestellt wurde, kann die Freigabe zu früh kommen. |
| Pin der Sequence nach „nicht ausgeführt“ wird 30 Tage nach der Klärung mit dem Eintrag aufgeräumt | Der Pin schützt gegen einen hinkenden Horizon-Knoten beim Klären und wirkt beim nächsten Senden von diesem Konto, in allen Sendewegen (Zahlung senden, Sammelzahlung, Trading, Liquidity, Claimable Balances, Sammel-Tausch). Die Frist zählt ab Vergabe des Pins (`settledAt`; Einträge aus der Zeit davor ohne dieses Feld ab dem Senden), nicht ab dem Senden der unklaren Transaktion. Aufgeräumt wird erst nach dem Lesen der Pins, nur im Netz des Sendens und unter dessen Sende-Lock (die Sammelzahlung räumt beim Prüfen nur auf, wenn der Lock frei ist), und ein vom laufenden Senden gelesener Pin bleibt bis dahin erhalten. Wird 30 Tage lang nicht gesendet, entfällt er; war die frühere Transaktion trotz „nicht ausgeführt“ doch angewendet, bleibt nur der Kontoverlauf als Hinweis. Gewollt (Aufräumen nicht ausgeführter Einträge). |
| Liegt die Konto-Sequence beim Senden unter „Pin minus 1“ (hinkender Horizon-Knoten, Testnet-Reset), wird mit dem Pin nicht gesendet: Die frühere Transaktion geht wieder in die strenge Prüfung (zwei Abfragen im Abstand von 30 s, beide mit Ledger-Zeit nach maxTime plus 60 s) | Früher wurde mit der Pin-Sequence gesendet und vom Netz mit `tx_bad_seq` abgelehnt; das Pin würde bei einem Reset dauerhaft blockieren. Abwägung: Die harte Garantie des Pins (höchstens eine der beiden Transaktionen kann angewendet werden) gilt in diesem Randfall nicht mehr, die Sicherheit ist die des strengen Pfads. Der Fall „frühere Transaktion angewendet, Knoten liegt mehr als eine Sequence zurück und holt zwischen Klärung und Senden auf“ ist sehr eng und wird vom strengen Pfad (Rückstand über etwa 90 s nötig, damit er nicht greift) abgedeckt. |
| Prüfen in der Sammelzahlung abbrechen | Die Klärung läuft seriell (bis ca. 32 s je Eintrag); ein Abbruch durch die Nutzerin wirft einen AbortError und schreibt nichts: Unklare Einträge bleiben unklar und gesperrt, nichts wird freigegeben oder verloren. Beim nächsten Prüfen wird erneut geklärt. Schließen des Dialogs bei laufender Klärung: kein Abbruch, das Ergebnis wird noch geschrieben (das Schreiben ist synchron: lesen, Hash vergleichen, schreiben, kein halber Zustand). Schließen der Seite oder des Tabs: JavaScript endet, es wird nichts geschrieben, der Eintrag bleibt unklar und wird beim nächsten Prüfen erneut geklärt. |
| Zweiter Tab: Nach einer eindeutigen Ablehnung im ersten Tab kann der zweite Tab kurz „Eintrag fehlt“ melden | Fail-closed (zu viel Sperre, kein Geldrisiko): Der zweite Tab kennt den unklaren Eintrag aus der Zeit während des Submits im ersten Tab. Die Prüfung über Horizon stellt den Eintrag her und gibt frei. Betrifft nur zwei Tabs mit demselben Konto und eine eindeutige Ablehnung. |
| Alte Sammelzahlungs-Einträge ohne Quellkonto (vor der Einführung von Sequence und Quellkonto) sperren nur ihre eigene Zahlung, nicht das Konto, und lassen sich nicht über Horizon klären | Bestand vor der Änderung, nur bei sehr alten Einträgen; ohne Zeitgrenze nicht klärbar. Eine solche Transaktion ist nach Stellar-Regeln nach wenigen Minuten nicht mehr anwendbar, sofern sie mit Zeitgrenze gebaut wurde. |
| Sendeschutz auch in Trading, Liquidity, Claimable Balances und Sammel-Tausch (Backlog #18 erledigt); Job und XDR-Export bauen überall unter derselben Sperre, unter demselben Sende-Lock pro Netz wie das Senden und mit dem Pin (`guardedUnsignedBuild`) | Alle nicht idempotenten Sendewege senden über den gemeinsamen Sendeschutz (`guardedSubmit`; die Sammelzahlung mit eigenem, gleichwertigem Pfad): Trading (Swap, Trustline, Trustline + Swap, Limit-Orders), Liquidity (Einzahlen, Abheben), Claimable Balances (Einlösen) und Sammel-Tausch. Eintrag vor dem Submit mit Herkunft (`payment`, `trade`, `liquidity`, `claimable`, `convert`; nur Anzeige, die Sperre gilt für alle gleich), Sperre pro Konto und Netz über alle Wege, Pin der Sequence nach „nicht ausgeführt“, Freigabe nur über Horizon. Unklar ist ein Sendefehler ohne brauchbare `result_codes` (`transaction` oder `inner_transaction` als String oder mindestens ein String in `operations`) bei keiner Antwort, Status 0, 408, 429 oder ab 500 (`isAmbiguousSubmitError`, gleiche Regel und gemeinsame Fälle wie die Backends, `test/assets/submit-classification.json`); vorher nur 500, 502, 503 und 504, und jedes `result_codes`-Objekt galt als Ablehnung, sodass etwa ein Proxy-520 das Konto freigab (Review Fable, F-10). Die Änderung macht nur aus eindeutig unklar, nie umgekehrt. Dieselbe Prüfung der Codes (`hasUsableResultCodes`) nutzt die Kontoanlage (`classifyHorizonSubmitError` in `utils/stellar/activationOutcome.js`), die ohne brauchbare Codes jeden Fehler als unklar wertet; ein leeres `result_codes`-Objekt galt dort vorher als Ablehnung, und der Secret Key eines womöglich gefüllten Kontos wäre verworfen worden. Nach einem unklaren Ergebnis gibt es keinen neuen Versuch ohne Beleg: Das Konto bleibt gesperrt (auch nach Neuladen, der Hinweiskasten steht auf der Seite jedes Weges), „Erneut senden“ schickt nur dieselbe signierte Transaktion. Der Sammel-Tausch schützt jede Transaktion des Laufs einzeln; bei unklarem Ergebnis, Sperre oder Fehler stoppt der Lauf, die übrigen werden nicht gesendet, angezeigt und nie automatisch nachgeholt. Er legt als Multisig-Job weiter nur die erste Transaktion an. Wie bei allen Wegen: Die Sperre liegt im localStorage dieses Browsers und gilt nicht für ein anderes Gerät oder einen anderen Browser mit demselben Konto (eigener Punkt unter „Was ausdrücklich nicht geschützt ist“). Wartet ein Vorgang am Sende-Lock auf einen anderen Tab, zeigt die Oberfläche das an (Text `waitingForLock`), und „Abbrechen“ (auch im Secret-Key-Dialog) beendet das Warten; danach wird nichts gesendet. Ein Abbruch, der erst während des Ladens im Lock kommt, wirkt vor dem Eintrag (`SendBlockedError('lockCancelled')`). Laden und Bauen im Lock haben ein Zeitlimit von 20 s (`LOAD_IN_LOCK_TIMEOUT_MS`, `buildTimeoutMs` in `guardedSubmit` und `guardedUnsignedBuild`), weil das SDK für GET-Aufrufe keins setzt (nur der POST hat 60 s): Danach `LoadTimeoutError` (ein `PreSubmitCheckError`: nichts gesendet, kein Eintrag). Der POST hat kein eigenes Limit. |
| Weitere Sendewege ohne Eintrag, Lock und Sperre, aber idempotent: Trustline anlegen oder ändern in der Wallet (`ListTrustlines`), Trustlines löschen in Blöcken, Multisig-Einstellungen (`MultisigEditPage`, setOptions), Konto-Anlage mit Multisig (`MultisigCreatePage`, eigener Aktivierungsvermerk), Widerruf eines Jobs (bumpSequence), Lern-Demos im Testnet | Ein zweites Senden führt zum selben Zielzustand oder scheitert am Protokoll (`op_already_exists`, Sequence verbraucht). Sie verbrauchen aber Sequences, ohne die Sperre zu prüfen; ein offener Pin geht danach in die strenge Prüfung (fail-closed). Die nicht idempotenten Wege (Liquidity, Claimable Balances, Sammel-Tausch) laufen seit Bündel 4c über den Sendeschutz. Konto zusammenführen (`accountMerge`) hat das Frontend nicht; Operationen anderer Art sendet es nur über die genannten Wege. |
| Memo-Pflicht (SEP-29) beim Senden | „Zahlung senden“ prüft die **fertig gebaute Transaktion** mit `checkMemoRequired` des SDK (`verifyMemoRequired`, in `buildTx` nach dem Bauen und vor dem Eintrag), nicht einen separat aufgelösten Empfänger: Geprüft wird genau das Ziel, das gesendet wird, auch wenn sich die Auflösung einer Federation-Adresse zwischen Vorprüfung und Bauen unterscheidet. Fail-closed: Laden des Ziels scheitert (Netz, Server) oder der Server hat die Methode nicht: `PreSubmitCheckError`, nichts gesendet, kein Eintrag. Erst danach wird mit `skipMemoRequiredCheck` gesendet (kein zweites Laden vor dem POST). Die Vorprüfung in der Oberfläche (`checkRecipientMemoRequired`) ist nur für eine frühe Rückmeldung. Die Sammelzahlung prüft beim Prüfen (`checkRowOnNetwork`), nicht beim Senden: Setzt ein Ziel die Pflicht dazwischen, geht die Zahlung ohne Memo raus; SEP-29 ist ohnehin nur eine Client-Prüfung. Trading, Liquidity, Claimable Balances und Sammel-Tausch prüfen nicht (kein fremdes Ziel: Swap und Sammel-Tausch zahlen an das eigene Konto, die anderen haben keine Zahlungsoperation) und senden mit `skipMemoRequiredCheck`. Andere Wege lassen das SDK vor dem POST prüfen; ein Fehler dort heißt „nichts gesendet“ (`PreSubmitCheckError`), nie „unklar“. Wiederholt wird nur das Laden (GET, 1 s und 2 s), nie der POST, nie das Bauen. Ein nicht aktiviertes Ziel (Horizon 404) ist keine Sperre; erkannt wird es über die SDK-Klasse `NotFoundError` (`isNotFoundError`), nicht über `response.status` (dort steht der Body der Antwort, den ein Proxy anders füllen kann). |
| Klärung eines unklaren Multisig-Jobs: Ledger-Zeit (`GET /`) und Abfrage der Transaktion (`GET /transactions/{hash}`) sind zwei Anfragen und können hinter dem Load Balancer von Horizon verschiedene Knoten treffen | Falsch endgültig (`expired` bzw. `obsolete_seq` für eine ausgeführte Transaktion) wird ein Job nur, wenn der Knoten der Transaktionsabfrage mehr als 60 s (`SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS`) plus den Abstand zwischen Ausführung und `maxTime` hinter dem Knoten der Ledger-Zeit liegt. Ein einzelner nachhinkender Knoten reicht nicht, wenn er beide Anfragen bedient, und die Serveruhr spielt keine Rolle mehr (R-1). Eine zweite Beobachtung im Abstand von mindestens 30 s wie im Sendeschutz des Frontends ist bewusst nicht umgesetzt: Der Rest betrifft nur einen Knoten mit über 60 s Rückstand bei gleichzeitig ungleich verteilten Anfragen, die zweite Beobachtung bräuchte gespeicherten Zustand je Job. |
| Challenge eines Signers verdrängen: Wer Job-ID und Signer-Adresse kennt, kann weiter neue Challenges anfordern. Ab der sechsten offenen Challenge desselben Signers, der 21. des Jobs oder der 2001. gesamt fällt die älteste weg, auch die eines ehrlichen Signers | Überschreiben und Verbrauchen mit falscher Signatur gehen nicht mehr. Verdrängen braucht laufend neue Anfragen innerhalb der 60 s zwischen Challenge und Einlösen, begrenzt durch das Rate-Limit von `POST /challenge` (20 je Minute und IP). Folge ist nur ein fehlgeschlagener Versuch (400), kein Geldrisiko; der nächste Versuch holt eine neue Challenge. |
| Rate-Limits zählen je IP bzw. /64: Hinter einem NAT teilen sich viele Nutzer ein Budget, wer viele Adressen (viele /64 oder IPv4) hat, umgeht sie. Detailseite (`GET /api/multisig/jobs/:id`) ohne eigenes Limit in PHP | Verfügbarkeit ist kein Schutzziel; die Budgets begrenzen Missbrauch einzelner Clients. Das Detail braucht ein gültiges Job-Token (403 vor jeder Klärung), die teure Klärung trifft also nur Inhaber des Tokens. Ist eine Limit-Datei voll (5000 Einträge), fallen die ältesten Fenster weg; beim Admin-Login die Einträge, die am frühesten ablaufen, auch Sperren. Das ist für IPv6 keine hohe Hürde: Ein einzelnes /48 (übliche Zuteilung an einen Standort) enthält 65 536 /64, ein Angreifer mit eigenem Prefix füllt die Datei also leicht. Beim Admin-Login kann er so seine eigene Sperre verdrängen und hat ohnehin je /64 eigene 5 Versuche; Schutz bleibt das Secret (`hash_equals`). |
| Rate-Limits setzen voraus, dass `REMOTE_ADDR` die Client-IP ist. Hinter einem Reverse Proxy oder CDN ohne `mod_remoteip` (o. ä.) ist sie für alle Clients gleich: Alle teilen sich ein Budget, und 5 falsche Admin-Versuche beliebiger Besucher sperren den Login für alle für 15 Minuten | Der Code wertet bewusst keine Forwarded-Header aus (fälschbar). Belegt ist im Repo nur, dass direkt zu cyon deployt wird (`scripts/deploy-cyon.js`, rsync nach `public_html/SKM/`) und kein CDN oder Proxy konfiguriert ist; ob vor dem Webserver von cyon ein Proxy sitzt, ist hier nicht belegt. Prüfen: nach einer eigenen Anfrage muss in `api/data/federation_rate_limit.json` die eigene IP (bzw. das eigene /64) stehen, nicht eine Adresse von cyon. Vor einem Wechsel auf Proxy/CDN `mod_remoteip` mit fester Liste vertrauenswürdiger Proxys einrichten. |
| IP-Bildung Node/PHP in Randfällen verschieden (`::ffff:` in Hex-Form, NAT64 `64:ff9b::/96`, Zonen-ID `%eth0`) | `REMOTE_ADDR` und `req.ip` liefern diese Formen praktisch nicht; Node ist nur Dev-Backend. |
| Admin-Login: Prüfen und Zählen sind zwei Schritte; parallele Anfragen vor der ersten Zählung bekommen mehr als 5 Versuche | Gewinn ist nur ein Burst je Sperrfenster; Schutz bleibt das Secret (`hash_equals`). |
| Node schickt zusätzlich `RateLimit`-Header (auch bei 200), PHP nur `Retry-After` bei 429 | Status, Code, Body und `Retry-After` sind gleich; das Frontend nutzt die Zusatz-Header nicht. |
| Job mit fremder `op.source` (ADR 0013): SKM sendet ihn nie; er bleibt bis Ablauf oder Widerruf offen, und außerhalb von SKM gesendet erkennt ihn das Lesen nur als `obsolete_seq` (Sequence verbraucht), nicht als `submitted_success` | Kein Geldrisiko, nur Anzeige. Klärung über `txHash` ist als eigener Schritt vorgemerkt. |
| `npm audit`: moderate Meldungen über `exceljs` → `archiver` → `glob`/`minimatch` | Im genutzten Pfad nicht ausnutzbar; der angebotene Fix wäre ein Downgrade. |

## Hinweise für Reviewer (häufige Fehlannahmen)

Diese Punkte wurden in früheren Reviews falsch gemeldet. Bitte vor einer Meldung prüfen.

- **„Token- und Ablehnungs-Signatur sind austauschbar.“** Nein, siehe Zweckbindung. Bitte per Probe prüfen, nicht aus
  Funktionsnamen schließen.
- **„Command Injection in composeMail.“** `spawn` ohne Shell mit festen Argumenten. composeMail ist nur im lokalen
  Node-Backend vorhanden. Der Endpunkt gilt nur für Aufrufe von derselben Maschine: Peer-Adresse und alle Adressen in
  `X-Forwarded-For`, `Forwarded` und `X-Real-IP` müssen Loopback sein (`services/network.js`), im Zweifel 403. Bei
  `Forwarded` zählt jedes `for=` in jedem Element und jeder Header-Zeile, auch mehrere in einem Element; ein Element ohne
  `for=` lehnt ab (B3-5, vorher zählte je Element nur das erste `for=`). Hinter dem
  Vite-Proxy ist die Peer-Adresse immer Loopback; deshalb hängt der Proxy die Client-Adresse an (`xfwd: true`). Restgrenzen:
  jeder Prozess auf derselben Maschine gilt als lokal (ohne zusätzliches Secret nicht lösbar); ein Reverse Proxy, der keine
  Forwarded-Header setzt oder `X-Forwarded-For` überschreibt, hebt den Schutz auf; und der Schutz hängt an `xfwd: true` in
  `frontend/vite.config.js` (ein Test wertet die Konfiguration aus, `test/viteProxyXfwd.test.js`). composeMail nie hinter
  einen solchen Proxy stellen oder mit `ENABLE_COMPOSE_MAIL=0` abschalten.
- **„Job-Detail zeigt nicht alles, was signiert wird.“** Siehe `describeTransaction.js` und `TransactionFacts.jsx`.
- **„PHP fehlt Prüfung X.“** Viele Prüfungen liegen in eigenen Dateien (`multisigDecline.php`,
  `multisigLifecycle.php`, `multisigJobsGuard.php`, `rateLimit.php`, `txSignatures.php`). Erst dort suchen.
- **Node ist nicht Produktion.** Befunde, die nur das lokale Node-Backend betreffen, sind meist niedriger einzustufen.
  Parität zu PHP ist trotzdem gefordert.

Anforderungen an einen Befund:
- Ort mit Datei und Zeile, am **aktuellen** Stand (`git log -1` angeben).
- Konkreter Weg: wer greift an, mit welchen Rechten, was ist das Ergebnis.
- „Bestätigt“ nur, wenn am Code nachvollzogen oder per Probe ausgeführt. Sonst „vermutet“.
- Abgleich mit diesem Dokument: Widerspricht der Befund einer bewussten Entscheidung, Begründung, warum sie nicht
  greift.
