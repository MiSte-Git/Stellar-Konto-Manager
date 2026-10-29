# Stellar Konto Manager (SKM)

Local-first Stellar Wallet & Account Manager: Trustlines, Zahlungen, Muxed Accounts, Multisig (Produktivmodus), Lerninhalte, Glossar, Quiz und Bugtracker. Open Source, lokal ausführbar, keine zentrale Datenspeicherung.

## Funktionsübersicht

### A. Wallet / Basisfunktionen
- SecretKeyModal für S-Key-Eingabe, optionales Speichern in der Sitzung (nur lokal).
- Zahlungen senden (XLM/Assets), Memos, Preflight inkl. Aktivierung nicht finanzierter Konten.
- Federation-Adressen (SEP-2, `name*domain`) werden über das eigene Backend aufgelöst (`GET /api/federation?type=name&q=...`, Node und PHP), nicht direkt im Browser. Für ein eingegebenes Konto sucht `type=id` den Namen rückwärts: home_domain aus Horizon, stellar.toml und FEDERATION_SERVER nur per https von genau dieser Domain, der Name muss auf diese Domain lauten und vorwärts wieder dasselbe Konto ergeben. Angezeigt wird das neutral als „Name laut Federation-Server von <domain>“, nie als verifiziert.
- Sichtbarer Processing-Indikator (`common:main.processing`), Explorer-Links zu StellarExpert/LumenScan.

### B. Trustlines
- Trustlines anzeigen, hinzufügen, löschen (chunked), Limits berücksichtigen.
- Vergleich zweier Konten (Duplikate erkennen, keine Alt/Neu-Vergleiche).
- Multisig-Prepare-Flow für ChangeTrust möglich.

### C. Muxed Accounts
- M-Adresse aus G-Adresse + ID erzeugen, anzeigen und konvertieren.
- Zahlungen an/von M-Accounts; XDR-Unterstützung im Flow.
- Contract-Adressen (`C…`) und muxed Contract-Adressen (`W…`, Protocol 30 / CAP-84) werden als Ziel erkannt und mit eigener Meldung abgelehnt, da klassische Zahlungen an sie nicht möglich sind (Frontend `utils/stellar/addressType.js`, Federation-Backend Node und PHP mit Fehlercode `federation.contractAddress`, HTTP 422).

### D. Multisig – Produktivmodus
- Signer/Weights/Thresholds verwalten, inkl. MasterKey=0-Szenarien.
- PendingMultisigJobs mit XDR-Export/Import, Status-Badges und Signatur-Fortschritt.
- Signieren auf mehreren Geräten (PC/Laptop/Handy); optional alle Signaturen lokal sammeln (Checkbox im SecretKeyModal).
- Zahlungen im Multisig-Produktivmodus (Job/XDR) oder lokal (wenn alle Keys vorhanden).
- Jeder Job hat ein zufälliges Zugriffstoken; Abruf eines Jobs und Signatur-Einreichung erfordern es (per Header oder im geteilten Link), Joblisten selbst bleiben ungeschützt (nötig für „meine offenen Jobs“ per Konto/Signer).
- Ohne Token (z. B. erster Aufruf ohne geteilten Link) wird das Token per Challenge-Response ausgestellt: Client fordert eine 60s gültige, einmal verwendbare Nonce für (Job-ID, Signer-Public-Key) an, signiert sie lokal mit dem Signer-Secret und weist damit den Besitz des Schlüssels nach – erst danach (und nach Prüfung, dass dieser Public Key laut Horizon aktiver Signer ist) wird das Token ausgegeben.

### E. Lernbereich / Glossar / Quiz
- Learn-Seiten mit Diagrammen (z. B. Multisig Single vs Multi Signer).
- Glossary mit Originalbegriffen in Klammern, SmallGlossaryLink.
- Quiz mit zufälliger Antwortreihenfolge und Fortschrittsspeicherung.

### F. Bugtracker
- Fehler melden über UI; Speicherung in `data/bugreports.json` (Node-Backend) bzw. per MySQL, wenn die PHP-Variante (`api/bugreport.php`) genutzt wird.
- Admin-Modus zum Anzeigen/Löschen, geschützt durch serverseitigen Session-Login (Admin-Secret nie im Frontend-Bundle, siehe `POST /api/admin/login`).

### G. Spenden
- Menüpunkt „Spenden“ (optional, Feature-Flag) öffnet den regulären Zahlungsdialog (freiwillig).

### H. Trading
- Asset-Suche mit Issuer-Risikoprüfung (Home Domain, TOML-Abgleich, Auth-Flags, Master-Weight).
- StellarExpert-Verzeichnis-Hinweis zum gewählten Asset (`GET /api/trade/assets/expert`, Node und PHP): kuratierte Drittanbieter-Tags, rote Warnung bei `#malicious`/`#unsafe`; bewusst nur Hinweis, kein Echtheitsbeweis, Ausfall blockiert die Anzeige nicht.
- Trustline-Anlage, auch kombiniert mit Swap in einer Transaktion.
- Market-Swap via `pathPaymentStrictSend` inkl. Slippage-Berechnung.
- Limit-Orders (`manageSellOffer`): Erstellen, eigene offene Orders anzeigen, Stornierung.
- Orderbook-Tiefe (Bid/Ask) zum gewählten Asset.
- Multisig-Signing-Unterstützung im Trading-Flow (gleiches Signer-Sammel-Muster wie bei Zahlungen).
- Referenzkurs XLM ↔ Token in der Token-Detailansicht: Orderbook-Mittelkurs plus simulierter Ausführungspreis (Pfadsuche, Referenzmenge 1), automatisch für das gerade angezeigte Asset, unabhängig von Trustline oder Swap-Eingabe.

### I. Liquidity Pools (Stufe 1 lesend, Stufe 2a Einzahlen/Abheben, Stufe 2b Multisig-Jobs)
- Eigene Seite unter Handel → „Liquidity Pools“ (`frontend/src/pages/LiquidityPoolsPage.jsx`, Pfad `/trading/pools`, optional `?pool=<64 Hex>` zum Vorauswählen; ungültige Werte werden ignoriert). Nur native Stellar Pools (CAP-38, constant product, Fee 30 bps), Konzept in `konzept_liquidity_pools.md`.
- „Meine Positionen“: Pool Shares, Anteil in %, Gegenwert in Asset A/B und Quelle je Pool; Trustlines mit 0 Shares sind markiert. Braucht ein existierendes Konto (AccountGate wie bei den anderen kontoabhängigen Seiten).
- „Pool finden“ per Asset-Paar (Token-Picker `components/trading/AssetPickerField.jsx`, gemeinsam mit dem Ziel-Token-Picker im Swap) oder per Pool-ID, auch ohne Konto: Reserven, Total Pool Shares, Teilnehmer (`total_trustlines`), Fee, Pool-ID kopierbar, `TokenFactsSummary` je Asset. Gibt es keinen Pool, erscheint ein neutraler Hinweis. Ein 404 und ein Netzwerkfehler werden getrennt angezeigt.
- Im Swap-Bereich verlinkt jeder angezeigte Pool auf die Pool-Ansicht.
- Einzahlen (Button in den Pool-Fakten, nur mit existierendem Konto und nicht bei leerem Pool) und Abheben (Button je Position), direkt signiert über `SecretKeyModal` → `signTransactionWithCollectedSigners` → `submitTransactionSafely`. Reicht das gesammelte Gewicht nicht, bricht der Vorgang mit `multisig.insufficientWeight` ab (bei Multisig-Konten mit Hinweis auf den Job-Weg).
  - Multisig-Jobs (Stufe 2b): Bei Multisig-Konten (`isMultisigAccount`) bieten beide Dialoge nach der Bestätigung zusätzlich „Multisig-Job vorbereiten“ an, ohne `SecretKeyModal`. Ablauf wie beim direkten Weg (frischer Stand, `assertHorizonNetwork`, dieselben Vorprüfungen und Abweichungsprüfung gegen die bestätigten Werte), Fee über `resolveFeePerOp(server, { deferred: true })`, Gültigkeit aus `multisigTimeoutSeconds` (Einstellungen), dann `createMultisigJobFromXdr` und `MultisigPrepareDialog` mit Zusammenfassung (Quellkonto, Netz, Pool, Beträge bzw. Mindestbeträge, Preisgrenzen, Slippage, Pool-Trustline, Gültigkeit, Job-ID). Vor dem Erstellen steht ein Hinweis, dass Preisgrenzen bzw. Mindestbeträge am aktuellen Kurs hängen und der Job bei stärkerer Kursbewegung bis zur letzten Signatur scheitert (`op_bad_price`/`op_under_minimum`). Doppelklick-Schutz und `jobCreated`-Sperre; wird der Dialog vor dem Erstellen abgebaut, wird verworfen, ein bereits erstellter Job wird der Seite gemeldet.
  - Einzahlen: Betrag für eine Seite, Gegenseite nach Pool-Verhältnis (aufgerundet), Slippage 0,1 bis 5 % (Default 0,5 %), Preisgrenzen als int32-Bruch (`minPrice` abgerundet, `maxPrice` aufgerundet), erwartete Shares, zusätzliche Reserve (Pool-Trustline 1 XLM). Dazu ein kurzer Hinweis auf Kursrisiko und Impermanent Loss.
  - Abheben: 25/50/75/100 % oder Share-Betrag, Mindestbeträge nach Slippage (abgerundet). Bei 100 % kann die Pool-Trustline in derselben Transaktion entfernt werden (Default an).
  - Vor dem Signieren erscheinen die Operationen im Klartext (`describeOperations`). Direkt vor dem Bauen werden Konto und Pool neu geladen und das Netz geprüft (`assertHorizonNetwork`). Liegt der Preis dann außerhalb der bestätigten Grenzen (bzw. die Auszahlung unter den Mindestbeträgen), wird abgebrochen und neu angezeigt.
  - Vorprüfungen (`utils/stellar/liquidityChecks.js`): verfügbares Guthaben nach Verbindlichkeiten, Mindestreserve inkl. neuer Subentries und Fee; fehlende oder nicht autorisierte Trustline, `auth_required`; Platz in den Trustlines beim Abheben. Aktiver Clawback sperrt nicht (Clawback-Assets sind laut CAP-38 poolfähig), sondern erscheint als Hinweis. Ist das Konto selbst Issuer eines Pool-Assets, braucht es dafür keine Trustline (kein `changeTrust`, keine Guthaben- oder Platzprüfung). Alles nur als Fakt formuliert.
  - Fehler-Mapping (`utils/stellar/liquidityErrors.js`): Horizon-Op-Codes → `submitTransaction.failed:liquidity.*`, Texte in `locales/de/errors.json`.
- Gezeigt werden nur Fakten, ohne Bewertung oder Ranking (Token-Trust-Prinzip). Pools eröffnen (Einzahlen in leere Pools) ist nicht möglich.
- Module: `utils/stellar/liquidityPools.js` (reine Funktionen: kanonische Sortierung, Pool-ID, Horizon-Normalisierung, Positionsberechnung, `quoteDeposit`/`quoteWithdraw`, Preisbrüche, alles in Stroop-`BigInt`), Builder `buildLiquidityDepositTransaction`/`buildLiquidityWithdrawTransaction` in `utils/stellar/tradingTransactions.js`, Hooks `components/liquidity/hooks/usePoolPositions.js`, `usePoolLookup.js` und `useLiquidityAction.js` (direkter Weg und Job-Weg), Dialoge `DepositDialog.jsx`/`WithdrawDialog.jsx` mit `jobParts.jsx`, Texte im Namespace `liquidity` (vorerst nur DE).
- Die Multisig-Job-Ansicht (`pages/MultisigJobDetail.jsx`, `utils/multisig/describeOperations.js`) zeigt `liquidityPoolDeposit`/`liquidityPoolWithdraw` im Klartext an, und `changeTrust` auf Pool Shares erscheint dort als „Pool A/B“.
  - Pool-Assets werden über `utils/multisig/liquidityPoolInfo.js` aufgelöst: zuerst aus einem `changeTrust(LiquidityPoolAsset)` derselben Transaktion (nur bei passender Pool-ID), sonst aus Horizon `/liquidity_pools/{id}` im Netz des Jobs (`normalizeNativePool` inkl. Pool-ID-Prüfung). Die Beschreibung nennt dann die echten Assets und den Preis als Dezimalzahl (A/B kanonisch). Ohne Pool-Daten bleibt der Text mit Asset A/B und einem Hinweis; Ladefehler blockieren die Anzeige nicht.
  - Zusätzlich als Fakt laut Horizon (nur Anzeige): aktueller Kurs und ob die Einzahlung damit innerhalb der Preisgrenzen liegt (geprüft wie stellar-core über das tatsächliche Einzahlungsverhältnis, mit den exakten Preisbrüchen aus dem XDR), bzw. bei Abhebungen die aktuell zu erwartenden Beträge gegen die Mindestbeträge.
  - Scheitert der Submit eines Jobs mit LP-Op-Codes (z. B. `op_bad_price`, `op_under_minimum`, `op_trustline_frozen`), zeigt das Job-Detail dieselben Texte wie der direkte Weg (`liquidityErrorKeyFromResultCodes`, `jobSubmitResultCodes` liest die Codes aus beiden Backend-Formen).

## Architekturüberblick
- Frontend: React + Vite, Ordner `frontend/`.
- Backend: Node.js/Express, `server.js` im Projekt-Root, lokale Dateiablage.
- Env-Konfiguration: `.env` im Projekt-Root (siehe `.env.example`), u. a. `PROD_API_URL` für Produktions-Builds (`npm run start-build`) und die Prod-Backend-Option von `npm run dev`. Optional `PROD_ORIGIN`, um die CORS-Allowlist aller Backend-Endpunkte (`server.js` via `services/corsConfig.js`; alle `api/*.php` via die gemeinsame `api/cors.php`) auf eine abweichende Produktions-Origin zu erweitern (Default: `https://skm.steei.de`). `BUGTRACKER_ADMIN_SECRET` (Bugtracker-Admin-Login, serverseitig geprüft) und `SESSION_SECRET` (signiert das Admin-Session-Cookie) sind für die Node-Variante nötig.
- Daten (Node-Backend): `data/bugreports.json`, `data/multisig_jobs.json` (lokale Laufzeitdaten, bewusst nicht in Git getrackt, siehe `.gitignore`).
- PHP-Alternative: `api/` (siehe Abschnitt „PHP-Backend“ unten).
- Keine externen Server, keine zentrale Datenspeicherung.
- Stellar-Netzwerke (Passphrase, Horizon-, RPC-, Friendbot-URL) kommen aus einer Registry: `frontend/src/config/networks.js` (Frontend), `services/stellarNetworks.js` (Node) und `api/stellarNetworks.php` (PHP); Parität prüft `test/stellarNetworks.test.js`. Aktiv sind Mainnet und Testnet. Futurenet ist eingetragen, aber deaktiviert (`enabled: false`); die Schritte zum Aktivieren stehen im Kopfkommentar von `frontend/src/config/networks.js`.
- Security-Header (Content-Security-Policy, HSTS, Referrer-Policy, Permissions-Policy, nosniff, X-Frame-Options) kommen aus einer Quelle: `services/securityHeaders.js`. Daraus erzeugt das Vite-Plugin in `frontend/vite.config.js` beim Build `dist/.htaccess` aus `frontend/.htaccess.template` (SPA-Rewrite plus Header, Base aus `VITE_BASE`), `vite preview` bekommt dieselben Header, `server.js` setzt die API-Header. `api/securityHeaders.php` ist der PHP-Zwilling für die API (Parität per Test). Der Vite-Dev-Server läuft bewusst ohne CSP (HMR). `VITE_CSP_REPORT_ONLY=1` beim Build setzt `Content-Security-Policy-Report-Only` statt der scharfen CSP.

## Installation & Start (lokal)
- Voraussetzungen: Node.js 22.12+ (ab `@stellar/stellar-sdk` 17 erforderlich), npm, moderner Browser.
- Entwicklung (Dev-Server, Hot-Reload), Arbeitsverzeichnis: Projekt-Root:
  ```bash
  git clone https://github.com/MiSte-Git/Stellar-Trustline-Manager.git
  cd Stellar-Trustline-Manager
  npm run dev      # installiert Backend- und Frontend-Abhängigkeiten automatisch,
                    # startet Backend (Port 3000) und Frontend (Port 5173)
  ```
  Alternativ manuell: `npm install && npm start` (Backend), `cd frontend && npm install && npm run dev` (Frontend).

- Produktions-Build (Frontend):
  ```bash
  # Empfohlen – Arbeitsverzeichnis: Projekt-Root
  npm run start-build
  ```
  Führt i18n-Prüfungen aus, leert `frontend/dist/` und baut dann automatisch im Arbeitsverzeichnis `frontend/` (`npm run build` → `vite build`). Ergebnis liegt in `frontend/dist/`.
  ```bash
  # Alternativ ohne i18n-Prüfungen – Arbeitsverzeichnis: frontend/
  cd frontend
  npm install
  npm run build
  ```

- Deployment zu cyon (Produktion, `public_html/SKM/` auf skm.steei.de), Arbeitsverzeichnis: Projekt-Root:
  ```bash
  npm run deploy:dry-run   # Prüfungen, Build und rsync-Dry-Run, lädt nichts hoch
  npm run deploy           # wie oben, danach Abfragen und Upload
  ```
  Kurz: Änderung committen, `git push`, dann `npm run deploy`. Im Zweifel vorher `npm run deploy:dry-run`. `npm run start-build` allein baut nur und lädt nichts hoch.
  Ruft `scripts/start-build.js --deploy [--dry-run]` auf, die Deploy-Logik steht in `scripts/deploy-cyon.js`. Voraussetzung ist ein SSH-Eintrag `cyon-skm` in `~/.ssh/config` (Host `s014.cyon.net`, User `stegmann`, Key `~/.ssh/SSH_Cyon_new`) und lokal `rsync`. Ablauf:
  1. Git sauber und `HEAD` gleich `origin/main` (im Dry-Run nur Warnung), `npm test` im Root und in `frontend/` grün.
  2. Build mit `VITE_BASE=/` ohne `VITE_CSP_REPORT_ONLY`, Prüfung von `dist/.htaccess` und `index.html`, danach `gen-build-info.mjs` und `hash-dist.mjs`.
  3. rsync-Dry-Run mit `--checksum`, Rohausgabe getrennt für Frontend und `api/`.
  4. Abfrage „Frontend-Aenderungen lokal im Browser durchgeklickt (npm run dev oder preview)?“, nur wenn der Frontend-Dry-Run außer `SHA256SUMS` und `build-info.json` weitere Dateien zeigt. Nicht `preview:csp` verwenden, das baut neu. Danach muss `frontend/dist` exakt zu `SHA256SUMS` passen.
  5. Frontend-Upload nach eigener j/N-Abfrage, mit `--delete` nur unterhalb von `assets/`. Danach Smoke-Test: `index.html` vom Server laden, Commit in `build-info.json` prüfen und alle in `index.html` referenzierten JS-/CSS-Assets per HEAD abfragen (jedes muss HTTP 200 liefern, sonst Fehler mit Liste der fehlenden Dateien).
  6. `api/` nur, wenn der Dry-Run Unterschiede zeigt, nach eigener j/N-Abfrage, ohne `--delete`, danach Health-Check `api/health.php`.
  7. Eine Zeile in `deploy.log` (Zeitpunkt in lokaler Zeit mit Offset, Ziel, Commit, Ergebnis; gitignored).

  Ausschlüsse stehen in `scripts/deploy/frontend.rsync-filter` (u. a. `api/`, `.ftpquota`) und `scripts/deploy/api.rsync-filter` (`_config.php`, `data/*` außer `data/.htaccess`, `vendor/`). `api/vendor/` und `api/_config.php` bleiben manuell, `SKM_Canary` deckt das Skript nicht ab.

- Produktions-CSP lokal testen, Arbeitsverzeichnis: `frontend/` (Backend parallel mit `npm start` im Root):
  ```bash
  npm run preview:csp                          # Build + vite preview mit Produktions-Headern
  VITE_CSP_REPORT_ONLY=1 npm run preview:csp   # nur beobachten (Report-Only)
  ```
  `/api` und `/horizon` gehen dabei über den Vite-Proxy. Verstöße erscheinen in der Browser-Konsole.

- Tests:
  ```bash
  npm test            # Node-Test-Runner, Arbeitsverzeichnis: Projekt-Root
  npm run test:trade  # nur tradeService-Tests, Arbeitsverzeichnis: Projekt-Root
  cd frontend && npx vitest   # Frontend-Unit-Tests (kein eigener npm-Skript-Eintrag)
  for f in test/*.test.php; do php "$f" || break; done   # PHP-Tests, Arbeitsverzeichnis: Projekt-Root
  ```
  Die Federation-Fälle liegen gemeinsam in `test/assets/federationCases.json` und laufen gegen Node und PHP.

## i18n-System
- Namespaced JSON unter `frontend/src/locales/<lang>/*.json`, DE als Referenzsprache.
- Autoload aller Namespaces, keine Hardcoded-Texte.
- Automatisches Übersetzungsskript: `UpdateSprachdateienBasierendAufDE.py` (bzw. Sync-Skripte im Repo).
  - Provider: `--provider openai` (erfordert `pip install openai` + `OPENAI_API_KEY`) oder `--provider deepl` (`DEEPL_API_KEY`/`DEEPL_AUTH_KEY`).
  - Key-Auflösung (in dieser Reihenfolge, bricht erst ab, wenn keiner greift): Umgebungsvariable -> OS-Keyring (`pip install keyring`; Service/Username per `DEEPL_KEYRING_SERVICE`/`DEEPL_KEYRING_USERNAME` bzw. `OPENAI_KEYRING_SERVICE`/`OPENAI_KEYRING_USERNAME` überschreibbar, Default-Service `SKM-i18n`) -> interaktive Eingabe an einem echten Terminal (wird danach im Keyring gespeichert). Läuft nur an einem Terminal; unbeaufsichtigt (z. B. Cron) bricht das Skript wie bisher mit Fehlermeldung ab, statt zu hängen.
  - Optional Voll-Lauf: `--full`; gezielte Keys: `--force-key foo.bar`.
  - Fachbegriffe bleiben in allen Sprachen englisch (auch im deutschen Quelltext): Liste `TECH_TERMS` im Skript (Trustline, Memo, Signer, Threshold, Secret Key, Public Key, Multisig, Asset, Token, Wallet, ...). Sie werden vor der Übersetzung durch Platzhalter ersetzt (beide Phasen, beide Provider); geht ein Platzhalter verloren, wird der Key nicht übernommen und beim nächsten Lauf erneut versucht. Neue Begriffe dort ergänzen.
  - i18next-Variablen (`{{name}}`) werden genauso maskiert (`__KEEP_VAR_n__`), damit DeepL die Variablennamen nicht mitübersetzt (früher z. B. `{{time}}` → `{{tempo}}`, i18next fand die Variable dann nicht mehr). Fehlt ein Token in der Antwort, wird der Key nicht übernommen.
  - `--fix-terms [Begriffe]`: übersetzt zusätzlich Bestands-Keys neu, in deren Übersetzung ein Fachbegriff fehlt (z. B. Trustline als Kreditlinie). Ohne Wert alle Begriffe, sonst komma-separierte Auswahl, z. B. `--fix-terms "Trustline,Memo"` (Kosten auf mehrere Läufe verteilen, DeepL Free = 500k Zeichen/Monat).
  - Tests: `cd frontend/src/locales && python3 -m unittest test_UpdateSprachdateienBasierendAufDE -v`
- CI-Prüfung `node scripts/i18n_ci_check.js` (Workflow `i18n-and-lint.yml`): alle Sprachen müssen den DE-Key-Baum haben, und je Key muss die Menge der `{{...}}`-Platzhalter exakt der deutschen entsprechen (Reihenfolge egal). Abweichungen brechen den Lauf mit Datei, Key, erwartet und gefunden ab.

## Sicherheitshinweise
- Geheimnisse bleiben lokal; keine Secret-Übertragung an Server.
- Strikte Content-Security-Policy in Produktion: nur eigene Scripts und Styles, `connect-src` nur zu eigener API, Horizon (Mainnet/Testnet), Friendbot und CoinGecko. Neue direkte Verbindungen aus dem Frontend müssen in `services/securityHeaders.js` ergänzt werden (der Test `frontend/src/test/cspSourceGuards.test.js` meldet sie). Eine eigene Horizon-URL per `localStorage` (`SKM_HORIZON_URL`) gilt nur im Dev-Modus.
- Multisig-XDR-Signaturen können vollständig lokal gehandhabt werden.
- Empfehlung: echte Wallet-Keys nur auf vertrauenswürdigen Geräten, Backups offline halten.

## PHP-Backend (wenn Node nicht erlaubt ist)
- Ordner: `api/` enthält `multisig.php` (nutzt `challengeStore.php` für die Challenge-Response-Tokenausgabe und `multisigJobsGuard.php` für Rate-Limit + Ablauf verwaister Jobs bei der Job-Erstellung), `trade.php`, `bugreport.php`, `health.php`, `admin.php` (Bugtracker-Admin-Login/Check/Logout per PHP-Session, siehe `admin_session.php`), `federation.php` (SEP-2 über das Backend, Regeln in `federationService.php`, SSRF-Schutz über `ssrfGuard.php`, Rate-Limit 30 pro Minute und IP in `api/data/federation_rate_limit.json`), `securityHeaders.php` (API-Security-Header, eingebunden über `cors.php`), `.htaccess`, `composer.json`/`composer.lock` sowie den Fallback-Routing-Unterordner `trade/assets/{search,facts,expert}/index.php`. Speicherung der Multisig-Jobs in `api/data/multisig_jobs.json`, der Challenge-Nonces in `api/data/challenges.json` (beide schreibbar machen).
- `MULTISIG_ADMIN_TOKEN` (echte Prozess-Umgebungsvariable, per `getenv()` gelesen – **nicht** Teil von `api/_config.php`s Array, das über einen anderen Mechanismus eingelesen wird; je nach Hosting z. B. via `.htaccess`/`SetEnv` oder das Hosting-Panel setzen): schützt `DELETE /api/multisig/jobs` (Bulk-Löschung aller Jobs eines Netzwerks, per `x-admin-token`-Header + `hash_equals()`-Vergleich). Gilt für **beide** Netzwerke gleichermaßen – der öffentliche, im Frontend sichtbare Bestätigungstext („DELETE TESTNET JOBS“) ist nur noch ein zusätzlicher Schutz gegen Versehen, kein Ersatz für dieses Secret. Ohne gesetztes `MULTISIG_ADMIN_TOKEN` antwortet der Endpunkt für beide Netzwerke mit 401 – der „Testnet-Jobs löschen“-Button im Frontend funktioniert dann nicht, bis das Token konfiguriert ist.
- **Vor dem ersten Start**: `api/_config.php` anlegen (Datei ist `.gitignore`t und liegt nicht im Repo!). Muss ein PHP-Array zurückgeben, mindestens:
  ```php
  <?php
  return [
      'DB_DSN' => 'mysql:host=localhost;dbname=DEIN_DB;charset=utf8mb4',
      'DB_USER' => '...',
      'DB_PASS' => '...',
      'DB_TABLE_BUGREPORTS' => 'bugreports',
      'BUGTRACKER_ADMIN_SECRET' => '...', // eigenständiger Zufallswert, NICHT identisch mit DB_PASS; nur serverseitig geprüft (POST /api/admin/login), landet nie im Frontend-Bundle
  ];
  ```
  Ohne diese Datei antworten `bugreport.php` und `health.php` mit `missing_config`.
- Abhängigkeiten: Composer + PHP 8.1+ (Pflicht ab `soneso/stellar-php-sdk` 1.16) mit den Extensions `curl`, `gmp`, `bcmath`, `mbstring`, `dom`, `intl`, `sodium`/`libsodium`, `openssl`. Auf Debian z. B.:
  ```bash
  sudo apt update
  sudo apt install php-cli php-curl php-gmp php-bcmath php-mbstring php-intl composer
  cd /path/to/project/api
  composer install
  ```
- Upload/Deploy: `npm run deploy` lädt `api/*.php`, `api/.htaccess`, `api/composer.json`, `api/composer.lock`, `api/trade/` und `api/data/.htaccess` hoch (siehe Deployment zu cyon oben). Manuell bleiben `api/_config.php` (nicht per Git!) und der komplette `api/vendor/`; sicherstellen, dass `api/data/` beschreibbar ist. `api/data/.htaccess` (sperrt direkten HTTP-Zugriff auf `multisig_jobs.json`/`signers_cache.json` u. a. – enthält Access-Tokens/XDRs) liegt im Repo und wird mit hochgeladen.
- Falls lokal kein PHP/Composer verfügbar (z. B. Windows ohne Extensions): Composer-Installer per `php composer-setup.php`, danach `php composer.phar install --ignore-platform-req=ext-pcntl --ignore-platform-req=ext-gmp` ausführen, anschließend den erzeugten `vendor/` hochladen.
- Routing: Apache muss `/api/multisig/...`, `/api/trade/...`, `/api/admin/...` und `/api/federation` per `.htaccess` im `api/`-Ordner auf `multisig.php`, `trade.php`, `admin.php` bzw. `federation.php` leiten.
- Frontend-Deploy: Der Build legt `frontend/dist/.htaccess` an (SPA-Rewrite und Security-Header), `npm run deploy` lädt sie mit hoch. Die Header gelten nicht für `/api`; dort setzt PHP eigene. Der Workflow `.github/workflows/deploy.yml` startet nur noch manuell, `deploy-canary.yml` baut mit `VITE_CSP_REPORT_ONLY=1`.
- Frontend-Builds: `npm run start-build` setzt `VITE_BACKEND_URL` automatisch auf `PROD_API_URL`, wenn nicht explizit gesetzt. Alternativ `VITE_BACKEND_URL=https://www.skm.steei.de` in `.env` definieren, um jeden Build auf die produktive API zu pinnen.

## Rechtliches
- Öffentliche Nutzung erfordert Impressum/Datenschutz: Seite `/legal` verlinkt im Footer und Menü.
- Open-Source-Lizenz: GNU GPL v3.0, siehe `LICENSE.md`.

## Roadmap (Ausblick)
- Soroban-Smart-Contract-Unterstützung.
- dApp/IPFS-Variante.
- Erweiterte Multisig-Flows.
- Mobile UI-Optimierung.
