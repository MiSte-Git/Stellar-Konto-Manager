# Stellar Konto Manager (SKM)

Local-first Stellar Wallet & Account Manager: Trustlines, Zahlungen, Muxed Accounts, Multisig (Produktivmodus), Lerninhalte, Glossar, Quiz und Bugtracker. Open Source, lokal ausführbar, keine zentrale Datenspeicherung.

## Funktionsübersicht

### A. Wallet / Basisfunktionen
- SecretKeyModal für S-Key-Eingabe, optionales Speichern in der Sitzung (nur lokal).
- Zahlungen senden (XLM/Assets), Memos, Preflight inkl. Aktivierung nicht finanzierter Konten.
- Sichtbarer Processing-Indikator (`common:main.processing`), Explorer-Links zu StellarExpert/LumenScan.

### B. Trustlines
- Trustlines anzeigen, hinzufügen, löschen (chunked), Limits berücksichtigen.
- Vergleich zweier Konten (Duplikate erkennen, keine Alt/Neu-Vergleiche).
- Multisig-Prepare-Flow für ChangeTrust möglich.

### C. Muxed Accounts
- M-Adresse aus G-Adresse + ID erzeugen, anzeigen und konvertieren.
- Zahlungen an/von M-Accounts; XDR-Unterstützung im Flow.

### D. Multisig – Produktivmodus
- Signer/Weights/Thresholds verwalten, inkl. MasterKey=0-Szenarien.
- PendingMultisigJobs mit XDR-Export/Import, Status-Badges und Signatur-Fortschritt.
- Signieren auf mehreren Geräten (PC/Laptop/Handy); optional alle Signaturen lokal sammeln (Checkbox im SecretKeyModal).
- Zahlungen im Multisig-Produktivmodus (Job/XDR) oder lokal (wenn alle Keys vorhanden).
- Jeder Job hat ein zufälliges Zugriffstoken; Abruf eines Jobs und Signatur-Einreichung erfordern es (per Header oder im geteilten Link), Joblisten selbst bleiben ungeschützt (nötig für „meine offenen Jobs“ per Konto/Signer).

### E. Lernbereich / Glossar / Quiz
- Learn-Seiten mit Diagrammen (z. B. Multisig Single vs Multi Signer).
- Glossary mit Originalbegriffen in Klammern, SmallGlossaryLink.
- Quiz mit zufälliger Antwortreihenfolge und Fortschrittsspeicherung.

### F. Bugtracker
- Fehler melden über UI; Speicherung in `data/bugreports.json` (Node-Backend) bzw. per MySQL, wenn die PHP-Variante (`api/bugreport.php`) genutzt wird.
- Admin-Modus zum Anzeigen/Löschen, geschützt durch serverseitigen Session-Login (Admin-Secret nie im Frontend-Bundle, siehe `POST /api/admin/login`).

### G. Spenden
- Menüpunkt „Spenden“ (optional, Feature-Flag) öffnet den regulären Zahlungsdialog (freiwillig).

## Architekturüberblick
- Frontend: React + Vite, Ordner `frontend/`.
- Backend: Node.js/Express, `server.js` im Projekt-Root, lokale Dateiablage.
- Env-Konfiguration: `.env` im Projekt-Root (siehe `.env.example`), u. a. `PROD_API_URL` für Produktions-Builds (`npm run start-build`) und die Prod-Backend-Option von `npm run dev`. Optional `PROD_ORIGIN`, um die CORS-Allowlist der Multisig-/Admin-Endpunkte (`server.js` und `api/multisig.php`/`api/admin.php`) auf eine abweichende Produktions-Origin zu erweitern (Default: `https://skm.steei.de`). `BUGTRACKER_ADMIN_SECRET` (Bugtracker-Admin-Login, serverseitig geprüft) und `SESSION_SECRET` (signiert das Admin-Session-Cookie) sind für die Node-Variante nötig.
- Daten (Node-Backend): `data/bugreports.json`, `data/multisig_jobs.json` (lokale Laufzeitdaten, bewusst nicht in Git getrackt, siehe `.gitignore`).
- PHP-Alternative: `api/` (siehe Abschnitt „PHP-Backend“ unten).
- Keine externen Server, keine zentrale Datenspeicherung.

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

- Tests:
  ```bash
  npm test            # Node-Test-Runner, Arbeitsverzeichnis: Projekt-Root
  npm run test:trade  # nur tradeService-Tests, Arbeitsverzeichnis: Projekt-Root
  cd frontend && npx vitest   # Frontend-Unit-Tests (kein eigener npm-Skript-Eintrag)
  ```

## i18n-System
- Namespaced JSON unter `frontend/src/locales/<lang>/*.json`, DE als Referenzsprache.
- Autoload aller Namespaces, keine Hardcoded-Texte.
- Automatisches Übersetzungsskript: `UpdateSprachdateienBasierendAufDE.py` (bzw. Sync-Skripte im Repo).
  - Provider: `--provider openai` (erfordert `pip install openai` + `OPENAI_API_KEY`) oder `--provider deepl` (`DEEPL_API_KEY`/`DEEPL_AUTH_KEY`).
  - Optional Voll-Lauf: `--full`; gezielte Keys: `--force-key foo.bar`.

## Sicherheitshinweise
- Geheimnisse bleiben lokal; keine Secret-Übertragung an Server.
- Multisig-XDR-Signaturen können vollständig lokal gehandhabt werden.
- Empfehlung: echte Wallet-Keys nur auf vertrauenswürdigen Geräten, Backups offline halten.

## PHP-Backend (wenn Node nicht erlaubt ist)
- Ordner: `api/` enthält `multisig.php`, `trade.php`, `bugreport.php`, `health.php`, `admin.php` (Bugtracker-Admin-Login/Check/Logout per PHP-Session, siehe `admin_session.php`), `.htaccess`, `composer.json`/`composer.lock` sowie den Fallback-Routing-Unterordner `trade/assets/{search,facts}/index.php`. Speicherung der Multisig-Jobs in `api/data/multisig_jobs.json` (schreibbar machen).
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
- Routing: Apache muss `/api/multisig/...`, `/api/trade/...` und `/api/admin/...` per `.htaccess` im `api/`-Ordner auf `multisig.php`, `trade.php` bzw. `admin.php` leiten.
- Frontend-Builds: `npm run start-build` setzt `VITE_BACKEND_URL` automatisch auf `PROD_API_URL`, wenn nicht explizit gesetzt. Alternativ `VITE_BACKEND_URL=https://www.skm.steei.de` in `.env` definieren, um jeden Build auf die produktive API zu pinnen.

## Rechtliches
- Öffentliche Nutzung erfordert Impressum/Datenschutz: Seite `/legal` verlinkt im Footer und Menü.
- Open-Source-Lizenz: GNU GPL v3.0, siehe `LICENSE.md`.

## Roadmap (Ausblick)
- Soroban-Smart-Contract-Unterstützung.
- dApp/IPFS-Variante.
- Erweiterte Multisig-Flows.
- Mobile UI-Optimierung.
