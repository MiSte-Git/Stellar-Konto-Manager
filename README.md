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

## Architekturüberblick
- Frontend: React + Vite, Ordner `frontend/`.
- Backend: Node.js/Express, `server.js` im Projekt-Root, lokale Dateiablage.
- Env-Konfiguration: `.env` im Projekt-Root (siehe `.env.example`), u. a. `PROD_API_URL` für Produktions-Builds (`npm run start-build`) und die Prod-Backend-Option von `npm run dev`. Optional `PROD_ORIGIN`, um die CORS-Allowlist aller Backend-Endpunkte (`server.js` via `services/corsConfig.js`; alle `api/*.php` via die gemeinsame `api/cors.php`) auf eine abweichende Produktions-Origin zu erweitern (Default: `https://skm.steei.de`). `BUGTRACKER_ADMIN_SECRET` (Bugtracker-Admin-Login, serverseitig geprüft) und `SESSION_SECRET` (signiert das Admin-Session-Cookie) sind für die Node-Variante nötig.
- Daten (Node-Backend): `data/bugreports.json`, `data/multisig_jobs.json` (lokale Laufzeitdaten, bewusst nicht in Git getrackt, siehe `.gitignore`).
- PHP-Alternative: `api/` (siehe Abschnitt „PHP-Backend“ unten).
- Keine externen Server, keine zentrale Datenspeicherung.
- Security-Header (Content-Security-Policy, HSTS, Referrer-Policy, Permissions-Policy, nosniff, X-Frame-Options) kommen aus einer Quelle: `services/securityHeaders.js`. Daraus erzeugt das Vite-Plugin in `frontend/vite.config.js` beim Build `dist/.htaccess` aus `frontend/.htaccess.template` (SPA-Rewrite plus Header, Base aus `VITE_BASE`), `vite preview` bekommt dieselben Header, `server.js` setzt die API-Header. `api/securityHeaders.php` ist der PHP-Zwilling für die API (Parität per Test). Der Vite-Dev-Server läuft bewusst ohne CSP (HMR). `VITE_CSP_REPORT_ONLY=1` beim Build setzt `Content-Security-Policy-Report-Only` statt der scharfen CSP.

## Installation & Start (lokal)
- Voraussetzungen: Node.js 22+ (ab `@stellar/stellar-sdk` 16 erforderlich), npm, moderner Browser.
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
- Abhängigkeiten: Composer + PHP (empfohlen PHP 8.1+ mit den Extensions `curl`, `gmp`, `bcmath`, `dom`, `intl`, `sodium`/`libsodium`, `openssl`). Auf Debian z. B.:
  ```bash
  sudo apt update
  sudo apt install php-cli php-curl php-gmp php-bcmath php-intl composer
  cd /path/to/project/api
  composer install
  ```
- Upload/Deploy: `api/*.php`, `api/.htaccess`, `api/composer.json`, `api/composer.lock`, `api/_config.php` (manuell, nicht per Git!), kompletter `api/vendor/` und sicherstellen, dass `api/data/` beschreibbar ist. `api/data/.htaccess` (sperrt direkten HTTP-Zugriff auf `multisig_jobs.json`/`signers_cache.json` u. a. – enthält Access-Tokens/XDRs) liegt im Repo und wird mit hochgeladen.
- Falls lokal kein PHP/Composer verfügbar (z. B. Windows ohne Extensions): Composer-Installer per `php composer-setup.php`, danach `php composer.phar install --ignore-platform-req=ext-pcntl --ignore-platform-req=ext-gmp` ausführen, anschließend den erzeugten `vendor/` hochladen.
- Routing: Apache muss `/api/multisig/...`, `/api/trade/...`, `/api/admin/...` und `/api/federation` per `.htaccess` im `api/`-Ordner auf `multisig.php`, `trade.php`, `admin.php` bzw. `federation.php` leiten.
- Frontend-Deploy: Der Build legt `frontend/dist/.htaccess` an (SPA-Rewrite und Security-Header). Beim manuellen Upload per FileZilla versteckte Dateien anzeigen lassen (Server > Anzeigen versteckter Dateien erzwingen), damit die `.htaccess` mitkommt. Die Header gelten nicht für `/api`; dort setzt PHP eigene. Der Workflow `.github/workflows/deploy.yml` startet nur noch manuell, `deploy-canary.yml` baut mit `VITE_CSP_REPORT_ONLY=1`.
- Frontend-Builds: `npm run start-build` setzt `VITE_BACKEND_URL` automatisch auf `PROD_API_URL`, wenn nicht explizit gesetzt. Alternativ `VITE_BACKEND_URL=https://www.skm.steei.de` in `.env` definieren, um jeden Build auf die produktive API zu pinnen.

## Rechtliches
- Öffentliche Nutzung erfordert Impressum/Datenschutz: Seite `/legal` verlinkt im Footer und Menü.
- Open-Source-Lizenz: GNU GPL v3.0, siehe `LICENSE.md`.

## Roadmap (Ausblick)
- Soroban-Smart-Contract-Unterstützung.
- dApp/IPFS-Variante.
- Erweiterte Multisig-Flows.
- Mobile UI-Optimierung.
