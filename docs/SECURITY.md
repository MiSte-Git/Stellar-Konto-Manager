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
  Skripte, Monitoring), denn ein Browser sendet bei Cross-Origin-Requests und bei jedem POST immer eine Origin.
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
| Sammelzahlung: Sperre gegen doppeltes Senden in zwei Tabs ist ohne Web Locks API nur probabilistisch (`localStorage`) | Moderne Browser haben Web Locks; Rest betrifft nur Altbrowser. |
| Sammelzahlung: nach Tab-Absturz bis 3 Minuten Wartezeit | Schutz vor Doppelzahlung geht vor. |
| Sammelzahlung: Fehltreffer der Warnhinweise nur bei ungültigen Eingaben | Kein Einfluss auf gültige Zahlungen. |
| `npm audit`: moderate Meldungen über `exceljs` → `archiver` → `glob`/`minimatch` | Im genutzten Pfad nicht ausnutzbar; der angebotene Fix wäre ein Downgrade. |

## Hinweise für Reviewer (häufige Fehlannahmen)

Diese Punkte wurden in früheren Reviews falsch gemeldet. Bitte vor einer Meldung prüfen.

- **„Token- und Ablehnungs-Signatur sind austauschbar.“** Nein, siehe Zweckbindung. Bitte per Probe prüfen, nicht aus
  Funktionsnamen schließen.
- **„Command Injection in composeMail.“** `spawn` ohne Shell mit festen Argumenten. composeMail ist nur im lokalen
  Node-Backend vorhanden.
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
