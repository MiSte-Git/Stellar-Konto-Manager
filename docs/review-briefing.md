# Review-Briefing

Vorlage für Code- und Security-Reviews von SKM, durch Menschen oder KI-Modelle. Den Abschnitt „Auftrag“ je Review
anpassen, den Rest unverändert mitgeben.

## Vorher lesen

1. [docs/SECURITY.md](SECURITY.md): Schutzziele, Grenzen, bewusste Entscheidungen, akzeptierte Risiken,
   häufige Fehlannahmen früherer Reviews.
2. [docs/adr/](adr/README.md): Entscheidungen mit Begründung.
3. [docs/ARCHITECTURE.md](ARCHITECTURE.md): wo was liegt.
4. [AGENTS.md](../AGENTS.md): Regeln des Projekts.

Ein Befund, der einer dokumentierten Entscheidung widerspricht, ist nur dann einer, wenn er zeigt, warum die
Begründung nicht greift.

## Auftrag (je Review anpassen)

- **Stand:** Commit `<hash>` auf `main`. Vorher `git fetch origin && git log --oneline HEAD..origin/main` (muss leer
  sein) und `git log -1` ins Ergebnis schreiben.
- **Bereich:** `<Commit-Bereich oder Dateien>`
- **Schwerpunkt:** `<z. B. neue Endpunkte, Signieren, i18n>`
- **Bekannte offene Punkte, nicht neu melden:** `<Liste aus dem Backlog>`

## Vorgehen

- Nur lesen und Proben ausführen. Keinen Produktivcode ändern, nichts committen.
- Proben gegen die Module im Repo (`node -e`, `php -r`) oder im **Testnet**. Nie Mainnet-Konten, nie echte Keys.
- Beide Backends prüfen. Eine Lücke nur in Node ist meist niedriger einzustufen (Node läuft nicht öffentlich),
  eine Abweichung zwischen Node und PHP ist trotzdem ein Befund.
- Vor einer Aussage „PHP fehlt X“ in den eigenen Dateien suchen (`multisigDecline.php`, `multisigLifecycle.php`,
  `multisigJobsGuard.php`, `rateLimit.php`, `txSignatures.php`, `challengeStore.php`).
- Frühere Reviews erst **nach** der eigenen Prüfung lesen und dann abgleichen. Sie können veraltet oder falsch sein.

## Form des Ergebnisses

Datei `review_<thema>_<modell>.md` im Repo-Root (wird nicht versioniert).

1. **Kurzurteil:** zwei bis vier Sätze.
2. **Befunde**, je Befund:
   - ID, Schwere (kritisch, hoch, mittel, klein), Status (**bestätigt** = am Code nachvollzogen oder per Probe
     ausgeführt; **vermutet** = abgeleitet, nicht geprüft)
   - Ort: Datei und Zeile am angegebenen Stand
   - Szenario: wer greift an, mit welchen Rechten, Schritt für Schritt, was ist das Ergebnis
   - Einordnung: warum diese Schwere, was begrenzt den Schaden
   - Fix: konkret, für beide Backends
3. **Bereiche ohne Befund:** kurz, was geprüft wurde und warum es hält.
4. **Abgleich** mit früheren Reviews.
5. **Konsolidierte Liste** nach Schwere.

## Schwere

| Schwere | Bedeutung |
|---|---|
| kritisch | Geld kann ohne Zutun des Opfers bewegt werden, oder ein Secret Key verlässt den Browser |
| hoch | Geld kann mit wenig Zutun bewegt werden (eine plausible Bestätigung), oder ein Signer signiert, was er nicht sieht |
| mittel | Verteidigungslinie fehlt, Schaden braucht weitere Voraussetzungen, oder Daten anderer Nutzer werden sichtbar oder veränderbar |
| klein | Härtung, Parität, Verfügbarkeit, Hilfsendpunkte |
