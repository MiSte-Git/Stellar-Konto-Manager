# 0001: Secret Key erst beim Signieren abfragen

- **Status:** akzeptiert
- **Datum:** 2026

## Kontext

Viele Stellar-Wallets verlangen den Secret Key schon beim Öffnen eines Kontos und halten ihn dann für die ganze
Sitzung. Die meisten Funktionen von SKM (Guthaben, Verlauf, Trustlines ansehen, Jobs lesen) brauchen aber nur den
Public Key.

## Entscheidung

SKM fragt den Secret Key erst ab, wenn tatsächlich signiert werden muss. Ein Konto wird über den Public Key geöffnet.
Optional kann der Nutzer den Key für die Sitzung merken lassen.

## Begründung

- Weniger Zeit, in der ein Secret im Speicher liegt, weniger Angriffsfläche.
- Bequemer: Ansehen und Prüfen geht ohne Key, auch auf fremden oder weniger vertrauten Geräten.
- Der Nutzer sieht bewusst, wann eine Aktion eine Signatur braucht.

## Folgen

- Gemerkte Keys: AES-GCM-verschlüsselt in `sessionStorage`, Schlüssel nur im Arbeitsspeicher, Löschung nach
  15 Minuten Inaktivität, beim Neuladen und beim Schließen des Tabs (`frontend/src/utils/sessionSecrets.js`).
- Kein Schutz gegen Schadcode auf der Seite (XSS), das steht so in der UI und in `docs/SECURITY.md`.
- Jede neue Funktion muss ohne Secret auskommen, bis zur Signatur.
