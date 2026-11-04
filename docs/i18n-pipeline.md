# i18n-Pipeline

Stand: 04.11.2026. Gilt für `frontend/src/locales/UpdateSprachdateienBasierendAufDE.py` und die Hilfsskripte daneben.

Dieses Dokument erklärt, **warum** die Pipeline so gebaut ist. Wer sie ändert (Mensch oder KI), liest es vorher. Viele
Regeln sehen im Code wie Umwege aus, sind aber Antworten auf konkret beobachtete Fehler. Die Begründungen stehen
zusätzlich als Kommentare im Skript.

## Grundregeln

1. **Deutsch ist die einzige Quelle.** Texte werden nur in `de/<namespace>.json` geschrieben. Alle anderen Sprachen
   entstehen daraus. Sprachen: `de` (Quelle), `en`, `nl`, `es`, `fr`, `it`, `fi`, `hr`, `ru`.
2. **Zwei Stufen, Englisch als Zwischensprache.** Phase A übersetzt DE → EN, Phase B übersetzt EN → alle anderen.
   Nie direkt DE → FR usw. Siehe [Entscheidung: Zwei Stufen](#entscheidung-zwei-stufen).
3. **Fachbegriffe bleiben englisch**, in jeder Sprache und auch im deutschen Quelltext (Trustline, Memo, Signer,
   Threshold, Secret Key, Public Key, Multisig, Muxed Account, Claimable Balance, ...). Liste: `TECH_TERMS` im Skript.
   Siehe [Entscheidung: Fachbegriffe](#entscheidung-fachbegriffe-englisch).
4. **UI-Begriffe:** `M-Adresse` (nicht Unteradresse), `Trustline` (nicht Token-Freigabe). Muxed Account ist der
   offizielle Begriff zur M-Adresse.
5. **Keine Texte im Code.** Komponenten nutzen `t('namespace:key')`. DE-Fallbacks im Code nur, wo schon vorhanden.
6. **Variablen** haben die Form `{{name}}` und müssen in jeder Sprache exakt gleich vorkommen (prüft `i18n_ci_check.js`).

## Ablauf eines Laufs

```
de/<ns>.json ──Phase A──▶ en/<ns>.json ──Phase B──▶ nl/ es/ fr/ it/ fi/ hr/ ru/<ns>.json
                 │                          │
       .i18n_hash/en_from_de.json   .i18n_hash/<lang>_from_en.json
```

Pro Namespace läuft erst Phase A, dann Phase B für alle sieben Sprachen. Scheitert Phase A für einen Namespace,
werden dessen Folgesprachen übersprungen (sonst würde von einem veralteten EN weiterübersetzt).

### Was wird übersetzt? (Hash-Manifeste)

Für jede Zielsprache gibt es ein Manifest unter `frontend/src/locales/.i18n_hash/`. Es speichert je Key den SHA-256
des **Quelltexts, aus dem die vorhandene Übersetzung entstanden ist** (für EN der DE-Text, für alle anderen der
EN-Text).

Ein normaler Lauf (ohne Optionen) übersetzt:
- Keys, die in der Zielsprache fehlen, und
- Keys, deren Quelltext-Hash nicht mehr zum Manifest passt (Quelltext wurde geändert).

Ändert sich ein DE-Text, wird also EN neu übersetzt. Dadurch ändert sich EN, und Phase B übersetzt die anderen
Sprachen im selben Lauf nach.

Ein Key landet **nur dann** mit neuem Hash im Manifest, wenn dieser Lauf ihn wirklich erfolgreich übersetzt hat.
Fehlgeschlagene Keys (siehe Schutzmechanismen) bleiben offen und werden beim nächsten Lauf automatisch erneut
versucht.

### Optionen

| Option | Wirkung |
|---|---|
| `--provider deepl` | Pflicht. `openai` ist noch vorhanden, wird aber nicht mehr genutzt. |
| `--force-key ns.key` | Übersetzt genau diese Keys neu (auch ganze Teilbäume oder ganze Namespaces). Mehrfach oder komma-getrennt. **Während eines Force-Laufs gibt es keine allgemeine Hash-Erkennung**, fehlende Keys werden aber weiter ergänzt. |
| `--full` | Alles neu. Teuer, praktisch nie sinnvoll (Kontingent). |
| `--fix-terms [Liste]` | Übersetzt zusätzlich Keys neu, in deren Übersetzung ein Fachbegriff fehlt (z. B. Trustline als Kreditlinie). |
| `--prune-extra` | Entfernt Keys aus Zielsprachen, die es in DE nicht mehr gibt. |
| `--base-path` | Anderes Locale-Verzeichnis (Tests). Manifeste folgen dem Pfad. |

API-Key: Umgebungsvariable `DEEPL_API_KEY`/`DEEPL_AUTH_KEY` → OS-Keyring (Service `SKM-i18n`) → Eingabe am Terminal.

### Hilfsskripte

| Skript | Zweck |
|---|---|
| `frontend/src/locales/sync_i18n_hashes.py` | Setzt **alle** Manifeste auf den aktuellen Inhalt von `de/` und `en/`. Keine API, keine Übersetzung. |
| `scripts/i18n_ci_check.js` | JSON gültig, gleicher Key-Baum wie DE, gleiche `{{...}}`-Variablen je Key. Läuft in CI. |
| `frontend/src/locales/test_UpdateSprachdateienBasierendAufDE.py` | Tests der Pipeline: `cd frontend/src/locales && python3 -m unittest test_UpdateSprachdateienBasierendAufDE -v` |

## Hand-Übersetzungen und `sync_i18n_hashes.py` (wichtig)

Wird ein Text in einer Zielsprache **von Hand** geschrieben (z. B. weil DeepL ihn schlecht übersetzt oder das
Kontingent fehlt), muss das Manifest davon erfahren. Sonst sieht der nächste Lauf einen geänderten DE-Text und
**überschreibt die Hand-Übersetzung** mit DeepL.

Dafür gibt es `sync_i18n_hashes.py`. Es kennt aber keine einzelnen Keys: Es markiert **jede** aktuelle Abweichung als
erledigt, auch DE-Änderungen, die noch nie übersetzt wurden. Deshalb gilt:

- Nach `sync_i18n_hashes.py` werden geänderte, aber noch nicht übersetzte Keys **nicht mehr erkannt**. Sie müssen
  danach per `--force-key` ausdrücklich nachübersetzt werden.
- Vor dem Sync also immer erst ermitteln, welche abweichenden Keys von Hand gepflegt sind und welche wirklich neu
  übersetzt werden müssen. Die zweite Gruppe beim anschließenden Lauf als `--force-key` übergeben.
- Fehlende Keys sind davon nicht betroffen, die füllt jeder Lauf.

Empfohlene Reihenfolge, wenn beides vorkommt:
1. Liste der abweichenden Keys erstellen und in „von Hand“ und „neu übersetzen“ aufteilen.
2. `python3 sync_i18n_hashes.py`
3. `python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --force-key <alle Keys aus „neu übersetzen“>`
   (dieser Lauf füllt auch die fehlenden Keys)
4. `node scripts/i18n_ci_check.js`
5. Stichprobe in EN und einer weiteren Sprache lesen.

## Schutzmechanismen und ihr Grund

Jeder Mechanismus geht auf einen beobachteten Fehler zurück. Nicht entfernen, ohne den Grund zu kennen.

| Mechanismus | Funktion im Skript | Anlass |
|---|---|---|
| Fachbegriffe maskieren | `protect_tech_terms` | DeepL übersetzte Trustline in 93 Keys als „Kreditlinie“, andere Begriffe mal so, mal so. Begriffe werden durch `__KEEP_TERM_n__` ersetzt und danach zurückgesetzt. Deutscher Dativ-Plural (Signern) wird dabei zu Signers. |
| Variablen maskieren | `protect_i18n_vars` | DeepL übersetzte Variablennamen mit (`{{time}}` → `{{tempo}}`), i18next fand sie nicht mehr. |
| Englisch in Klammern schützen, **nur Phase A** | `protect_parenthesized_english_for_target` | „Mehrfachsignatur (Multi-Signature)“ soll den Klammerbegriff behalten. In Phase B ist der Quelltext schon englisch, dort würde jedes Klammerwort eingefroren („(empty)“ blieb in allen Sprachen englisch). |
| Klammer-Heuristik | `_looks_like_kept_english_term` | Reines ASCII ist kein Beweis für Englisch („(leer)“ blieb dadurch deutsch). Geschützt wird nur ein einzelnes Wort mit Ziffer, Großbuchstabe oder `_:/`. |
| Denylist für Bindestrich-Wörter | `GERMAN_COMPOUND_TAILS_NOT_KEPT` | „S-Key“ (schützen) und „M-Adresse“ (übersetzen) haben dieselbe Form. Eine Form-Regel kann das nicht trennen, deshalb eine kleine Liste deutscher Wortenden (`vorlage`, `adresse`). Neue Fälle dort ergänzen. |
| Verlorener Platzhalter | `translate_protected` (Zähler `lostPlaceholderKeys`) | Verändert DeepL einen Platzhalter, wird die Übersetzung verworfen und der Key bleibt offen. |
| Sonderzeichen bewahren | `_preserve_special_chars` | Fehlt ein Emoji oder Symbol in der Übersetzung, bleibt der Quelltext stehen. Der Key wird **nicht** ins Manifest übernommen, damit der nächste Lauf es erneut versucht. Gewöhnliche Satzzeichen (&, Gedankenstrich, Anführungszeichen) zählen bewusst nicht dazu. |
| Echo-Erkennung | `_looks_like_untranslated_echo` | DeepL gab manchmal den Quelltext unverändert zurück. Das galt früher als Erfolg und wurde dauerhaft gesperrt. Ab 20 Zeichen mit Leerzeichen gilt Gleichheit jetzt als Fehlschlag. Texte nur aus Fachbegriffen sind ausgenommen. |
| `source_lang` fest setzen | `translate_text_deepl` | Ohne Angabe erkannte DeepL kurze Texte falsch (DE als Afrikaans). Phase A immer `DE`, Phase B immer `EN`. |
| Original-Keys | `is_original_key` | Keys auf `.original` werden nie übersetzt, sondern aus DE kopiert. |
| Namespace-Kollisionen | `check_namespace_key_collisions` | `quiz.ui.json` und ein `ui`-Objekt in `quiz.json` erzeugten denselben Manifest-Schlüssel, die Erkennung wurde unzuverlässig. Warnt jetzt laut. |
| Keys mit Punkt im Namen | `_get_node_by_path` | Flache Keys wie `d.fb` in `quiz.json` wurden von `--force-key` nie gefunden. |
| LF-Zeilenenden | `save_json`, `_save_manifest` | Unter Windows entstand sonst bei jedem Lauf CRLF-Rauschen in git. |
| 429 mit Backoff, 456 sammeln | `translate_text_deepl`, `aborts` in `main` | 429 (Rate Limit) wird wiederholt. 456 (Kontingent erschöpft) bricht die Sprache ab und wird am Ende zusammengefasst, Exit-Code 1. |

## Entscheidungen

### Entscheidung: Zwei Stufen

- **Entscheidung:** DE → EN → andere Sprachen, nicht DE → andere direkt.
- **Grund:** Beobachtung im Projekt: Übersetzungen EN → X waren deutlich besser als DE → X. Sprachpaare mit Englisch
  haben bei maschineller Übersetzung meist die meisten Trainingsdaten.
- **Weiterer Vorteil:** EN ist ein lesbarer Zwischenstand. Ein Fehler wird dort einmal korrigiert und wirkt in allen
  Sprachen.
- **Nachteile:** Ein Fehler in EN geht in alle Sprachen über, deshalb EN nach jedem Lauf stichprobenartig lesen.
  Was es im Englischen nicht gibt, geht verloren, vor allem Du/Sie. Die Pipeline setzt derzeit **keinen**
  `formality`-Parameter. Welche Anredeform in NL, ES, FR, IT, RU entsteht, entscheidet also DeepL. Offener Punkt.
- **Status:** beruht auf Beobachtung, nicht auf einer Messung. Prüfbar mit einer Stichprobe (20 bis 30 Texte, direkt
  und über EN, in Sprachen vergleichen, die man selbst beurteilen kann).

### Entscheidung: Fachbegriffe englisch

- **Entscheidung (Okt. 2026):** Stellar- und Krypto-Begriffe werden in keiner Sprache übersetzt.
- **Grund:** Die Begriffe sind im Stellar-Umfeld englisch, Nutzer finden sie so in Doku, Explorern und anderen
  Wallets wieder. DeepL übersetzte sie uneinheitlich und teils fachlich falsch.
- **Verworfen:** DeepL-Glossar. Platzhalter wirken für beide Provider, in beiden Phasen und brauchen keine
  Glossar-Pflege je Sprachpaar.

## Kosten und Kontingent

DeepL läuft über das Frei-Kontingent (500 000 Zeichen im Monat). Jeder Key wird in acht Sprachen übersetzt, ein
geänderter DE-Text kostet also etwa das Achtfache seiner Länge. `--full` und große `--force-key`-Bereiche deshalb
vermeiden. Bei 456 bricht der Lauf sauber ab, offene Keys werden beim nächsten Lauf nachgeholt.

## Für KI-Assistenten und Reviewer

- Fachbegriffe im Deutschen nicht „eindeutschen“, das ist Absicht.
- Die Zwischenstufe EN nicht als Umweg wegoptimieren.
- Zielsprachen nicht direkt bearbeiten, ohne danach die Manifeste zu berücksichtigen (siehe oben).
- Keinen Lauf mit `--full` vorschlagen, um ein Einzelproblem zu lösen.
- Änderungen am Skript brauchen einen Test in `test_UpdateSprachdateienBasierendAufDE.py`.
