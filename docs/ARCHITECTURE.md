# Architektur

Stand: 05.11.2026. Überblick, wo was liegt und wie die Teile zusammenspielen. Befehle, Env-Variablen und
Endpunkte im Detail stehen in der [README.md](../README.md), Entscheidungen in [docs/adr/](adr/README.md).

## Gesamtbild

```
 Browser (SPA)                                   Stellar-Netz
 ┌──────────────────────────────┐               ┌───────────────┐
 │ React-App                    │──── Horizon ──▶│ Mainnet       │
 │ - Konten, Zahlungen, Trading │   (direkt)     │ Testnet       │
 │ - Signieren (lokal)          │               └───────────────┘
 │ - IndexedDB-Cache            │                       ▲
 └──────────┬───────────────────┘                       │ Signer/Thresholds live,
            │ HTTPS, nur eigene API                     │ Einreichen von Jobs
            ▼                                           │
 ┌──────────────────────────────┐                       │
 │ Backend (PHP in Produktion,  │───────────────────────┘
 │ Node lokal)                  │──── stellar.toml, Federation, StellarExpert
 │ - Multisig-Jobs              │
 │ - Bugtracker                 │
 │ - Token-Suche, Federation    │
 └──────────────────────────────┘
```

- Das Frontend spricht **direkt mit Horizon** für alles, was nur ein Konto betrifft (Guthaben, Verlauf, Senden).
- Das Backend ist nur für Dinge da, die **mehrere Personen** teilen (Multisig-Jobs, Bugreports) oder die aus dem
  Browser nicht gehen (Abrufe fremder Domains, die CORS oder die CSP verhindern würden).
- Das Backend hat **nie** einen Secret Key und kann nicht signieren (siehe [SECURITY.md](SECURITY.md)).

## Frontend (`frontend/`)

React mit Vite, Tailwind CSS v4, framer-motion, i18next.

| Ort | Inhalt |
|---|---|
| `src/App.jsx`, `src/components/layout/` | App-Shell mit Kopfleiste und Seitenleiste |
| `src/config/mainNavigation.js` | Menüstruktur |
| `src/config/networks.js` | Netz-Registry (Passphrase, Horizon, RPC, Friendbot), Zwilling in beiden Backends |
| `src/pages/` | Seiten: Wallet, Senden, Empfangen, Verlauf, Trading, Liquidity Pools, Multisig, Muxed, Groupfund, Lernen, Einstellungen |
| `src/components/` | Bausteine je Bereich (`wallet/`, `multisig/`, `trading/`, `liquidity/`, `groupfund/`, `learn/`, `quiz/`, `story/`, `scam-simulator/`, ...) |
| `src/utils/stellar/` | Stellar-Logik ohne UI: Transaktionen bauen, Gebühren, Adresstypen, Claimable Balances, Liquidity Pools, Groupfund-Auswertung |
| `src/utils/multisig/` | Job-Prüfung (`verifyJobTransaction.js`), Anzeige (`describeTransaction.js`, `describeOperations.js`), Widerruf, Signierstatus |
| `src/utils/multisigApi.js` | Client für die Multisig-Endpunkte, inkl. Challenge-Signatur mit Zweck |
| `src/utils/sessionSecrets.js` | Gemerkte Secret Keys, verschlüsselt, mit Inaktivitäts-Timeout |
| `src/utils/batchPayment/` | Sammelzahlung |
| `src/utils/submitGuard/` | Unklarer Sendestatus, gemeinsam für Sammelzahlung, „Zahlung senden“, Trading, Liquidity, Claimable Balances und Sammel-Tausch (Hinweiskasten: `components/wallet/AccountSendGuardNotice.jsx`): Auflösung über Horizon, Sperre pro Konto, Send-Lock pro Netz, geschützter Submit (`guardedSubmit`), Bauen von Job und XDR unter derselben Sperre (`guardedUnsignedBuild`), Zeitlimit für Laden und Bauen im Lock (`loadTimeout.js`), React-Hook |
| `src/utils/db/indexedDbClient.js` | Lokaler Cache für Zahlungen je Konto (IndexedDB) |
| `src/locales/<sprache>/<namespace>.json` | Texte, DE ist Quelle (siehe [i18n-pipeline.md](i18n-pipeline.md)) |

Lokal gespeichert wird im Browser: Kontenliste und Einstellungen (`localStorage`), Zahlungs-Cache (IndexedDB),
gemerkte Secrets verschlüsselt (`sessionStorage`). Nichts davon geht an den Server.

## Backend

Zwei Varianten mit gleichem Verhalten ([ADR 0003](adr/0003-dual-backend-paritaet.md)).

| Thema | Node (`server.js`, `services/`) | PHP (`api/`) |
|---|---|---|
| Multisig-Jobs | `server.js`, `multisigLifecycle.js`, `multisigJobsGuard.js`, `multisigJobLock.js`, `multisigDecline.js` | `multisig.php`, `multisigLifecycle.php`, `multisigJobsGuard.php`, `multisigDecline.php` |
| Challenges | `challengeStore.js`, `challengeRateLimit.js` | `challengeStore.php`, `rateLimit.php` |
| Signaturen | `txSignatures.js` | `txSignatures.php` |
| Federation | `federationService.js` | `federation.php`, `federationService.php` |
| Token-Suche/Trading | `tradeService.js` | `trade.php`, `trade/` |
| Bugtracker, Admin | `server.js`, `requestGuard.js` | `bugreport.php`, `admin.php`, `admin_session.php`, `requestGuard.php` |
| SSRF-Schutz | eigene Lookup-Funktion | `ssrfGuard.php` |
| CORS, Header | `corsConfig.js`, `securityHeaders.js` | `cors.php`, `securityHeaders.php` |
| Netze | `stellarNetworks.js` | `stellarNetworks.php` |

Daten liegen als JSON-Dateien: Node unter `data/`, PHP unter `api/data/` (`multisig_jobs.json`, `challenges.json`,
`signers_cache.json`, Bugreports). Beide Ordner sind per `.htaccess` gesperrt und nicht in git.

## Ablauf Multisig-Job

```
Ersteller           Backend                         Signer B
   │ Tx bauen (lokal)  │                                 │
   │── POST /jobs ────▶│ prüft XDR, Netz, Quelle,        │
   │◀── Job-ID, Token ─│ Zeitfenster                     │
   │                   │                                 │
   │                   │◀── POST /jobs/:id/challenge ────│
   │                   │──── Nonce ─────────────────────▶│ signiert skm:token:+Nonce
   │                   │◀── POST /jobs/:id/token ────────│
   │                   │ prüft Signatur + Signer live    │
   │                   │──── Token ─────────────────────▶│
   │                   │──── Job (XDR) ─────────────────▶│ prüft Hash/Quelle, zeigt alles an,
   │                   │◀── merge-signed-xdr ────────────│ signiert lokal
   │                   │ übernimmt nur Signaturen        │
   │                   │ aktueller Signer, max. 20       │
   │                   │── Schwelle erreicht: einreichen ─▶ Horizon
```

Zustände: offen, bereit, eingereicht (Erfolg/Fehler), abgelehnt, abgelaufen, veraltet (Sequence verbraucht).
Endzustände nehmen keine Signaturen mehr an.

## Build und Deploy

- `npm run dev`: Node-Backend und Vite-Frontend lokal.
- `npm run start-build`: Produktions-Build, erzeugt auch `dist/.htaccess` mit den Security-Headern.
- `npm run deploy`: Build plus rsync in die Produktion, mit Dry-Run und Rückfragen. Konfiguration des Servers
  (`api/_config.php`, `api/vendor/`) bleibt manuell.

## Tests

- Backend: `npm test` (Node), `for f in test/*.test.php; do php "$f" || break; done` (PHP). Meist als Paare.
- Frontend: `cd frontend && npm test` (Vitest).
- i18n: `node scripts/i18n_ci_check.js`, Pipeline-Tests unter `frontend/src/locales/`.
- CI: `.github/workflows/i18n-and-lint.yml`.
