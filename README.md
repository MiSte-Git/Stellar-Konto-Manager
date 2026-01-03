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

### E. Lernbereich / Glossar / Quiz
- Learn-Seiten mit Diagrammen (z. B. Multisig Single vs Multi Signer).
- Glossary mit Originalbegriffen in Klammern, SmallGlossaryLink.
- Quiz mit zufälliger Antwortreihenfolge und Fortschrittsspeicherung.

### F. Bugtracker
- Fehler melden über UI; Speicherung in `data/bugreports.json`.
- Admin-Modus zum Anzeigen/Löschen (S-Key-geschützt).

### G. Spenden
- Menüpunkt „Spenden“ öffnet den regulären Zahlungsdialog (freiwillig).

## Architekturüberblick
- Frontend: React + Vite.
- Backend: Node.js/Express, lokale Dateiablage.
- Daten: `data/multisig_jobs.json`, `data/bugreports.json`.
- Keine externen Server, keine zentrale Datenspeicherung.

## Installation & Start (lokal)
- Voraussetzungen: Node.js 20+, npm/pnpm, moderner Browser.
- Schritte:
  ```bash
  git clone https://github.com/MiSte-Git/Stellar-Trustline-Manager.git
  cd Stellar-Trustline-Manager
  ./start-dev.sh   # startet Backend (Port 3000) und Frontend (Port 5173)
  ```
  Alternativ: `npm install && npm start` (Backend), `cd frontend && npm install && npm run dev` (Frontend).

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

## PHP-Multisig-Backend (wenn Node nicht erlaubt ist)
- Ordner: `api/` enthält `multisig.php`, `.htaccess`, `composer.json`. Speicherung in `api/data/multisig_jobs.json` (schreibbar machen).
- Abhängigkeiten: Composer + PHP (empfohlen PHP 8.1+ mit `gmp`). Auf Debian z. B.:
  ```bash
  sudo apt update
  sudo apt install php-cli php-curl php-gmp composer
  cd /path/to/project/api
  composer install
  ```
- Upload/Deploy: `api/multisig.php`, `api/.htaccess`, `api/composer.json`, `api/composer.lock`, kompletter `api/vendor/` und sicherstellen, dass `api/data/` beschreibbar ist.
- Falls lokal kein PHP/Composer verfügbar (z. B. Windows ohne Extensions): Composer-Installer per `php composer-setup.php`, danach `php composer.phar install --ignore-platform-req=ext-pcntl --ignore-platform-req=ext-gmp` ausführen, anschließend den erzeugten `vendor/` hochladen.
- Routing: Apache muss `/api/multisig/...` auf `api/multisig.php` leiten (per `.htaccess` im `api/`-Ordner).
- Frontend-Builds: `start-build.sh` setzt `VITE_BACKEND_URL` automatisch auf `PROD_API_URL`, wenn nicht explizit gesetzt. Alternativ `VITE_BACKEND_URL=https://www.skm.steei.de` in `.env` definieren, um jeden Build auf die produktive API zu pinnen.

## Rechtliches
- Öffentliche Nutzung erfordert Impressum/Datenschutz: Seite `/legal` verlinkt im Footer und Menü.
- Open-Source-Lizenz: siehe Lizenzdatei im Repo.

## Roadmap (Ausblick)
- Soroban-Smart-Contract-Unterstützung.
- dApp/IPFS-Variante.
- Erweiterte Multisig-Flows.
- Mobile UI-Optimierung.
