# Sicherheit: Modell, Grenzen, bewusste Entscheidungen

Stand: 04.11.2026 (Commit `9390b59`). Pflichtlektüre vor jedem Security-Review, ob durch Mensch oder KI.

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
  15 Minuten Inaktivität und beim Schließen des Tabs. Code: `frontend/src/utils/sessionSecrets.js`.
- Eingegebene Secrets werden in Entwürfen und Listen nicht gespeichert (`containsSecretKey` in
  `frontend/src/utils/batchPayment/`).

### Multisig-Jobs

Ein Job ist eine unsignierte oder teilsignierte Transaktion, die mehrere Signer nacheinander signieren.

- **Anlegen** ist ohne Anmeldung möglich (Rate-Limit). Der Server prüft: XDR dekodierbar, Netz bekannt,
  Transaktionsquelle = Job-Konto (auch bei M-Adresse über das Basiskonto), Gültigkeitsfenster begrenzt.
- **Signatur hinzufügen (Merge):** Der Server übernimmt nur Signaturen von aktuellen Signern des Kontos und höchstens
  20 Signaturen (Stellar-Grenze, `services/txSignatures.js`, `api/txSignatures.php`). Merge prüft zuerst den Hash,
  dann die Quelle.
- **Job-Token:** Wer Job-Details lesen will, braucht ein Token (Header `x-job-token`, nie in der URL). Es gibt das
  Token beim Anlegen oder über eine **Challenge**: Der Server erzeugt eine Nonce je Job und Signer (60 s gültig,
  einmalig), der Client signiert sie lokal, der Server prüft die Signatur und ob der Key aktuell Signer des Kontos
  ist.
- **Zweckbindung:** Signiert wird nie die rohe Nonce, sondern `skm:<zweck>:` plus Nonce (`token`, `decline`,
  `delete`). Grund: Eine Stellar-Transaktionssignatur ist eine Ed25519-Signatur über 32 Bytes (Hash). Würde der Client rohe 32 Bytes
  signieren, könnte ein bösartiges Backend einen Transaktions-Hash als „Challenge“ schicken und bekäme eine gültige
  Transaktionssignatur. Mit Präfix ist keine signierte Nachricht 32 Bytes lang, und eine Signatur für einen Zweck
  gilt nicht für einen anderen. Code: `services/challengeStore.js`, `api/challengeStore.php`,
  `frontend/src/utils/multisigApi.js`.
- **Ablehnen:** nur aktuelle Signer, nicht nach eigener Signatur, nicht im Endzustand. Gewicht und Threshold kommen
  live.
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
  Body ergibt 400 `invalid_json` ohne Stacktrace und ohne Body-Inhalt. Scheitert das Speichern, nachdem beim Anlegen oder
  Merge schon an Horizon gesendet wurde, lautet der Code `multisig.jobs.save_failed_after_submit` (500, beide Backends):
  Die Transaktion kann im Netz sein, ein erneutes Senden wäre falsch; die UI weist darauf hin.
- **Nebenläufigkeit:** Node serialisiert Merge, Ablehnen und Löschen je Job (`services/multisigJobLock.js`), PHP
  arbeitet unter Dateilock. Endzustände werden im Lock geprüft.
- **Anzeige vor dem Signieren** (`frontend/src/utils/multisig/describeTransaction.js`,
  `frontend/src/components/multisig/TransactionFacts.jsx`): Quelle, Sequence, Memo (unsichtbare Zeichen maskiert),
  Fees, Zeitfenster und Ledger-Grenzen, Operationen mit `op.source`, Extra Signer, Fee-Bump.
- **Eigenes Konto als `op.source`** sperrt das Signieren hart, ohne Bestätigungs-Checkbox.

### Weitere Schutzmaßnahmen

- SSRF-Schutz für serverseitige Abrufe (TOML, Federation): Auflösung und Prüfung der Ziel-IP, Größenlimits
  (`api/ssrfGuard.php`, Node über eigene Lookup-Funktion).
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
- Security-Header aus einer Quelle (`services/securityHeaders.js`, PHP-Zwilling `api/securityHeaders.php`): strikte
  CSP, `connect-src` nur zu bekannten Zielen.
- Datenordner auf dem Server per `.htaccess` gesperrt, Dateirechte eng.
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
| Pin der Sequence nach „nicht ausgeführt“ wird 30 Tage nach der Klärung mit dem Eintrag aufgeräumt | Der Pin schützt gegen einen hinkenden Horizon-Knoten beim Klären und wirkt beim nächsten Senden von diesem Konto, in allen Sendewegen (Zahlung senden, Sammelzahlung, Trading). Die Frist zählt ab Vergabe des Pins (`settledAt`; Einträge aus der Zeit davor ohne dieses Feld ab dem Senden), nicht ab dem Senden der unklaren Transaktion. Aufgeräumt wird erst nach dem Lesen der Pins, nur im Netz des Sendens und unter dessen Sende-Lock (die Sammelzahlung räumt beim Prüfen nur auf, wenn der Lock frei ist), und ein vom laufenden Senden gelesener Pin bleibt bis dahin erhalten. Wird 30 Tage lang nicht gesendet, entfällt er; war die frühere Transaktion trotz „nicht ausgeführt“ doch angewendet, bleibt nur der Kontoverlauf als Hinweis. Gewollt (Aufräumen nicht ausgeführter Einträge). |
| Liegt die Konto-Sequence beim Senden unter „Pin minus 1“ (hinkender Horizon-Knoten, Testnet-Reset), wird mit dem Pin nicht gesendet: Die frühere Transaktion geht wieder in die strenge Prüfung (zwei Abfragen im Abstand von 30 s, beide mit Ledger-Zeit nach maxTime plus 60 s) | Früher wurde mit der Pin-Sequence gesendet und vom Netz mit `tx_bad_seq` abgelehnt; das Pin würde bei einem Reset dauerhaft blockieren. Abwägung: Die harte Garantie des Pins (höchstens eine der beiden Transaktionen kann angewendet werden) gilt in diesem Randfall nicht mehr, die Sicherheit ist die des strengen Pfads. Der Fall „frühere Transaktion angewendet, Knoten liegt mehr als eine Sequence zurück und holt zwischen Klärung und Senden auf“ ist sehr eng und wird vom strengen Pfad (Rückstand über etwa 90 s nötig, damit er nicht greift) abgedeckt. |
| Prüfen in der Sammelzahlung abbrechen | Die Klärung läuft seriell (bis ca. 32 s je Eintrag); ein Abbruch durch die Nutzerin wirft einen AbortError und schreibt nichts: Unklare Einträge bleiben unklar und gesperrt, nichts wird freigegeben oder verloren. Beim nächsten Prüfen wird erneut geklärt. Schließen des Dialogs bei laufender Klärung: kein Abbruch, das Ergebnis wird noch geschrieben (das Schreiben ist synchron: lesen, Hash vergleichen, schreiben, kein halber Zustand). Schließen der Seite oder des Tabs: JavaScript endet, es wird nichts geschrieben, der Eintrag bleibt unklar und wird beim nächsten Prüfen erneut geklärt. |
| Zweiter Tab: Nach einer eindeutigen Ablehnung im ersten Tab kann der zweite Tab kurz „Eintrag fehlt“ melden | Fail-closed (zu viel Sperre, kein Geldrisiko): Der zweite Tab kennt den unklaren Eintrag aus der Zeit während des Submits im ersten Tab. Die Prüfung über Horizon stellt den Eintrag her und gibt frei. Betrifft nur zwei Tabs mit demselben Konto und eine eindeutige Ablehnung. |
| Alte Sammelzahlungs-Einträge ohne Quellkonto (vor der Einführung von Sequence und Quellkonto) sperren nur ihre eigene Zahlung, nicht das Konto, und lassen sich nicht über Horizon klären | Bestand vor der Änderung, nur bei sehr alten Einträgen; ohne Zeitgrenze nicht klärbar. Eine solche Transaktion ist nach Stellar-Regeln nach wenigen Minuten nicht mehr anwendbar, sofern sie mit Zeitgrenze gebaut wurde. |
| Trading und Liquidity: Gleicher Schutz im Trading, nicht in der Liquidity (Job und XDR-Export bauen im Trading und in Zahlung senden nur unter derselben Sperre, unter demselben Sende-Lock pro Netz wie das Senden und mit dem Pin, `guardedUnsignedBuild`) | Das Trading (Swap, Trustline, Trustline + Swap, Limit-Orders) sendet über den gemeinsamen Sendeschutz; bei unklarem Ausgang sperrt es das Konto in allen Wegen, Freigabe nur über Horizon. Liquidity (Einzahlen, Auszahlen), Claimable Balances und der Sammel-Tausch senden weiter ohne Eintrag und ohne Sperre (Backlog #18): Ein unklarer Ausgang zeigt nur den Hash, ein erneutes Senden ist möglich. Das ist eine bekannte offene Lücke: Ein erneutes Senden baut eine neue Transaktion (andere Sequence); war die erste doch angekommen, wirkt die Aktion doppelt. |
| Weitere Sendewege ohne Eintrag, Lock und Sperre, aber idempotent: Trustline anlegen oder ändern in der Wallet (`ListTrustlines`), Trustlines löschen in Blöcken, Multisig-Einstellungen (`MultisigEditPage`, setOptions), Konto-Anlage mit Multisig (`MultisigCreatePage`, eigener Aktivierungsvermerk), Widerruf eines Jobs (bumpSequence), Lern-Demos im Testnet | Ein zweites Senden führt zum selben Zielzustand oder scheitert am Protokoll (`op_already_exists`, Sequence verbraucht). Sie verbrauchen aber Sequences, ohne die Sperre zu prüfen; ein offener Pin geht danach in die strenge Prüfung (fail-closed). Nicht idempotent und deshalb oben genannt: Liquidity, Claimable Balances, Sammel-Tausch. |
| Memo-Pflicht (SEP-29) beim Senden | „Zahlung senden“ prüft die **fertig gebaute Transaktion** mit `checkMemoRequired` des SDK (`verifyMemoRequired`, in `buildTx` nach dem Bauen und vor dem Eintrag), nicht einen separat aufgelösten Empfänger: Geprüft wird genau das Ziel, das gesendet wird, auch wenn sich die Auflösung einer Federation-Adresse zwischen Vorprüfung und Bauen unterscheidet. Fail-closed: Laden des Ziels scheitert (Netz, Server) oder der Server hat die Methode nicht: `PreSubmitCheckError`, nichts gesendet, kein Eintrag. Erst danach wird mit `skipMemoRequiredCheck` gesendet (kein zweites Laden vor dem POST). Die Vorprüfung in der Oberfläche (`checkRecipientMemoRequired`) ist nur für eine frühe Rückmeldung. Die Sammelzahlung prüft beim Prüfen (`checkRowOnNetwork`), nicht beim Senden: Setzt ein Ziel die Pflicht dazwischen, geht die Zahlung ohne Memo raus; SEP-29 ist ohnehin nur eine Client-Prüfung. Das Trading prüft nicht (kein fremdes Ziel). Andere Wege lassen das SDK vor dem POST prüfen; ein Fehler dort heißt „nichts gesendet“ (`PreSubmitCheckError`), nie „unklar“. Wiederholt wird nur das Laden (GET, 1 s und 2 s), nie der POST, nie das Bauen. Ein nicht aktiviertes Ziel (Horizon 404) ist keine Sperre; erkannt wird es über die SDK-Klasse `NotFoundError` (`isNotFoundError`), nicht über `response.status` (dort steht der Body der Antwort, den ein Proxy anders füllen kann). |
| `npm audit`: moderate Meldungen über `exceljs` → `archiver` → `glob`/`minimatch` | Im genutzten Pfad nicht ausnutzbar; der angebotene Fix wäre ein Downgrade. |

## Hinweise für Reviewer (häufige Fehlannahmen)

Diese Punkte wurden in früheren Reviews falsch gemeldet. Bitte vor einer Meldung prüfen.

- **„Token- und Ablehnungs-Signatur sind austauschbar.“** Nein, siehe Zweckbindung. Bitte per Probe prüfen, nicht aus
  Funktionsnamen schließen.
- **„Command Injection in composeMail.“** `spawn` ohne Shell mit festen Argumenten. composeMail ist nur im lokalen
  Node-Backend vorhanden. Der Endpunkt gilt nur für Aufrufe von derselben Maschine: Peer-Adresse und alle Adressen in
  `X-Forwarded-For`, `Forwarded` und `X-Real-IP` müssen Loopback sein (`services/network.js`), im Zweifel 403. Hinter dem
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
