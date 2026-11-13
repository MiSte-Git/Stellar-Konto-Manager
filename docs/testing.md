# Tests

Drei Ebenen. Jede hat einen festen Zweck und eine feste Auslösung.

| Ebene | Befehl | Dauer | Wann |
|---|---|---|---|
| Backend (Node) | `npm test` | Sekunden | bei jedem Deploy (`test:report`) |
| Backend (PHP) | `for f in test/*.test.php; do php "$f" \|\| break; done` | Sekunden | bei jeder Backend-Änderung |
| Frontend (Vitest) | `cd frontend && npm test` | Sekunden bis Minuten | bei jedem Deploy |
| E2E gegen Testnet (Playwright) | `npm run test:e2e` | ca. 1–3 Minuten | automatisch bei jedem Frontend-Deploy |

## E2E-Tests (Testnet)

Ordner `e2e/`. Die Tests steuern die echte App (Vite lokal) gegen das Stellar Testnet und prüfen den Zustand
danach direkt bei Horizon. Sie sind die Wiederholung der manuellen Online-Tests.

- **Fixtures:** `e2e/setup/fixtures.mjs` legt bei jedem Lauf frische Konten per Friendbot an (`main`, `lp`, `cb`,
  `issuer`), gibt die Test-Assets SKMA/SKMB aus, stellt einen Markt und einen Pool XLM/SKMA. Die Keys stehen nur
  in `e2e/.fixtures/run.json` (nicht versioniert, nur Testnet).
- **Helfer:** `e2e/helpers.mjs` (App öffnen, Konto laden, Menü, Signieren mit Testkey). Selektoren nutzen die
  sichtbaren deutschen UI-Texte. Ändert sich ein Text, schlägt der Test fehl: Spec anpassen, nicht den Test
  abschwächen.
- **Start:** `npm run test:e2e` (alle Specs, schreibt `e2e/.last-run.json`) oder `npm run test:e2e -- sendLock`
  (nur passende Specs, zählt nicht als Stand für den Deploy). Einmalig `npx playwright install chromium`.
- **Log und Bericht:** Nach jedem Lauf gibt es eine Zusammenfassung in der Konsole (ok/rot, Gesamtdauer, die drei
  langsamsten Tests, Fehler mit erster Meldungszeile, flaky Tests). Dauerhaft liegt alles unter `e2e/.results/`
  (nicht versioniert): `history.log` (eine Zeile je Test und Lauf: Zeit, Commit, Ergebnis, Dauer, Versuche, Datei,
  Name, bei Fehlern die erste Meldung), `report/` (HTML, `npx playwright show-report e2e/.results/report`) und
  `artifacts/` (Screenshots und Traces fehlgeschlagener Tests, `npx playwright show-trace <trace.zip>`). Ein Test,
  der erst im zweiten Versuch besteht, ist „flaky“: meist Netz oder Friendbot, bei Wiederholung im Verlauf prüfen.
- **Netz:** Horizon und Friendbot müssen erreichbar sein. Bei Friendbot-Problemen den Lauf später wiederholen,
  kein Fehler der App.
- **Deploy:** Bei Frontend-Änderungen startet der Deploy die E2E-Tests automatisch (Testnet, ca. 1–3 Minuten).
  Bei Rot bricht der Deploy ab. Notausgang für Notfälle (z. B. Friendbot down): `SKIP_E2E=1 npm run deploy ...`;
  der Deploy zeigt dann den Stand des letzten Laufs. Das ersetzt die frühere Frage „durchgeklickt?“.

### Abdeckung

Jede Zeile nennt Funktion und Spec. Neue oder geänderte Abläufe, die Geld bewegen oder Schlüssel betreffen,
brauchen hier einen Eintrag (Regel 9 in [AGENTS.md](../AGENTS.md)). Der Test `test/e2eCoverage.test.js` prüft,
dass jede Spec in dieser Tabelle steht und jede genannte Datei existiert.

| Funktion | Spec |
|---|---|
| Meine Trustlines / Trustlines vergleichen mit Pool-Shares-Konto (Regression 12.11.2026) | `e2e/specs/trustlines.spec.mjs` |
| Claimable Balance einlösen, Batch-Convert (Assets ohne Trustline nach XLM) | `e2e/specs/claimable.spec.mjs` |
| Liquidity Pool: laden, einzahlen, abheben, Pool-Trustline entfernen | `e2e/specs/liquidity.spec.mjs` |
| Konto erstellen: Guards für ungesicherte Schlüssel, Netzwechsel | `e2e/specs/accountGuards.spec.mjs` |
| Einstellungen: Verläufe löschen, Scam-Statistik zurücksetzen | `e2e/specs/settings.spec.mjs` |
| Sendesperre über Tabs, Warten abbrechen | `e2e/specs/sendLock.spec.mjs` |
| Trading mit gemerktem Session-Key: Limit-Order und Swap ohne Key-Dialog, ohne Haken Merken fragt der Dialog wieder (die Asset-Suche des Backends ist im Spec nachgebildet, Senden läuft echt gegen Testnet) | `e2e/specs/trading.spec.mjs` |
| Wallet-Assets: Pool-Anteile mit Paar und Gegenwert, Filter nach Code. Asset-Detailseite: Wallet → Details zeigt Saldo und Fakten, Handeln öffnet Token suchen und handeln mit vorbelegtem Asset, kaputter Link zeigt Hinweis. Token suchen und handeln: Kontoliste (Modus Im Konto) mit Filter und den Modi Alle zeigen, Ausblenden, Nur diese zeigen, Pool-Karte ohne Aufklappen, Handeln öffnet die Detailansicht (Asset-Suche, Fakten und StellarExpert des Backends nachgebildet) | `e2e/specs/assetDetail.spec.mjs` |
| Smoke-Crawl: jeder Menüpunkt öffnet ohne Absturz (Konto mit Trustlines/Pool-Shares und Konto mit Offers) | `e2e/specs/smoke.spec.mjs` |

### Noch nicht abgedeckt (bewusst, bei Bedarf ergänzen)

- Zahlung senden und Sammelzahlung mit Ergebnis, unklarer Status (Netz sperren), Trading mit Multisig, Multisig-Job mit
  zweitem Signer, Xdr-Export, Bugreport (sendet echte Mail), Mainnet (nie automatisch).
- Memo-Pflicht und Fee-Bump-Ablehnung sind als Unit-Tests abgedeckt (`memoRequired.test.js`, Multisig-Tests).

### Regeln für die Pflege

1. Ein Fehler, der von Hand gefunden wird, bekommt zuerst einen Regressionstest (Unit, wenn möglich, sonst E2E).
2. Änderungen an UI-Texten oder Abläufen, die ein Spec benutzt, ändern das Spec im selben Commit.
3. Neue Funktion mit Geld- oder Schlüsselbezug: Eintrag in der Tabelle und mindestens ein Spec.
4. Vor Releases auf Mainnet: `npm run test:e2e` ohne Filter und den Mainnet-Test von Hand (Checkliste im Backlog).
