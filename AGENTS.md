# AGENTS.md

Einstieg für alle KI-Assistenten (Claude, Mistral, Copilot, ...) und für Menschen, die am Projekt mitarbeiten.
Kurz halten. Details stehen in den verlinkten Dokumenten.

## Projekt in drei Sätzen

SKM (Stellar Konto Manager) ist eine **non-custodial** Wallet für das Stellar-Netz als Single-Page-App im Browser.
Secret Keys verlassen nie den Browser, signiert wird nur lokal. Ein kleines Backend speichert Multisig-Jobs und
bedient Hilfsfunktionen, kann aber nie selbst signieren.

## Zuerst lesen

| Thema | Dokument |
|---|---|
| Setup, Befehle, Funktionen, Endpunkte | [README.md](README.md) |
| Sicherheitsmodell, bewusste Entscheidungen, Hinweise für Reviews | [docs/SECURITY.md](docs/SECURITY.md) |
| Übersetzungen und Pipeline | [docs/i18n-pipeline.md](docs/i18n-pipeline.md) |
| Aufbau, Abläufe, wo was liegt | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Tests, E2E-Abdeckung und Pflege | [docs/testing.md](docs/testing.md) |
| Entscheidungen mit Begründung | [docs/adr/](docs/adr/README.md) |
| Vorlage für Reviews | [docs/review-briefing.md](docs/review-briefing.md) |

Vor einem Security-Review ist `docs/SECURITY.md` Pflicht. Dort steht, was gewollt ist und was keine Lücke ist.

## Aufbau

- `frontend/`: React + Vite, Tailwind CSS v4, i18next. Texte unter `frontend/src/locales/<sprache>/<namespace>.json`.
- `server.js` + `services/`: Node/Express-Backend, **nur für die lokale Entwicklung**.
- `api/`: PHP-Backend, **Produktion** (Shared Hosting).
- `test/`: Backend-Tests, `*.test.js` für Node und `*.test.php` für PHP, meist als Paar.
- `scripts/`: Build, Deploy, i18n-Prüfungen.

## Regeln

1. **Dual-Backend-Parität.** Jede Änderung an Verhalten oder Sicherheit gilt für Node **und** PHP, mit Test in beiden.
   PHP nutzt Dateilocks für alles mit Zustand.
2. **Secret Keys** nie an einen Server schicken, nie speichern außer im bestehenden Sitzungsspeicher
   (`frontend/src/utils/sessionSecrets.js`), nie loggen. Abfragen erst, wenn signiert werden muss.
3. **Signer sehen, was sie signieren.** Keine Signatur ohne vollständige Anzeige und Bestätigung. Signaturen über
   Server-Challenges immer mit Zweck-Präfix `skm:<zweck>:`, nie über rohe Bytes.
4. **Tokens nie bewerten.** SKM zeigt Fakten zu Tokens, sagt aber nie, ob ein Token echt, sicher oder unsicher ist.
   Gilt für jeden Text, auch für Hinweise und Farben.
5. **Texte nur über i18n.** Neue Texte nur in `de/` anlegen, die anderen Sprachen erzeugt die Pipeline.
   Stellar-Fachbegriffe bleiben englisch, auch im Deutschen (Trustline, Memo, Signer, Threshold, Secret Key, ...).
   Begriffe in der UI: M-Adresse, Trustline.
6. **README.md aktuell halten** bei Änderungen an Befehlen, Struktur, Env-Variablen, Features oder Endpunkten
   (siehe [CLAUDE.md](CLAUDE.md)).
7. **Tests** zu jeder Änderung an Logik. Bestehende Tests nicht abschwächen, um sie grün zu bekommen.
8. **Keine Abhängigkeiten** ohne Rückfrage hinzufügen oder per `npm audit fix --force` ändern.
9. **E2E-Tests pflegen** ([docs/testing.md](docs/testing.md)). Ein von Hand gefundener Fehler bekommt zuerst einen
   Regressionstest. Ändert sich ein Ablauf oder UI-Text, den ein Spec in `e2e/specs/` benutzt, wird das Spec im selben
   Commit angepasst. Neue Funktion mit Geld- oder Schlüsselbezug: Eintrag in der Abdeckungstabelle und mindestens ein Spec.

## Befehle

```
npm run dev                         # lokal: Backend und Frontend
npm test                            # Node-Backend-Tests
for f in test/*.test.php; do php "$f" || break; done   # PHP-Tests
cd frontend && npm test             # Frontend-Tests (Vitest)
npm run test:e2e                    # E2E gegen das Testnet (Playwright), siehe docs/testing.md
cd frontend && npm run lint
node scripts/i18n_ci_check.js       # i18n-Prüfung
```

## Arbeitsweise

- Gearbeitet wird direkt auf `main`, es gibt nur einen Entwickler.
- **Nie selbst committen oder pushen.** Änderungen werden vorher geprüft und dann ausdrücklich freigegeben.
- Commits nach Conventional Commits (`fix(multisig): ...`, `docs: ...`), ein Thema pro Commit. Security, i18n,
  Abhängigkeiten und Features nicht mischen.
- Commit-Texte ohne Anführungszeichen, damit sie sich problemlos ins Terminal einfügen lassen.
- Vor jeder Sitzung prüfen, ob der lokale Stand aktuell ist:
  `git fetch origin && git log --oneline HEAD..origin/main` muss leer sein.
- Analyse- und Review-Dateien (`analyse_*.md`, `review_*.md`) im Repo-Root sind lokal und nicht versioniert.
  Frühere Reviews können veraltet oder falsch sein, immer am aktuellen Code prüfen.
- Projektsprache ist Deutsch.
