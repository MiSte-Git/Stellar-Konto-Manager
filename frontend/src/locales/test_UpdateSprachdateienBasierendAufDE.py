"""
Regressionstests für UpdateSprachdateienBasierendAufDE.py.

Deckt konkret aufgetretene Pipeline-Bugs ab:

1. Sonderzeichen-Schutz ("&" und "–" haben faelschlich die komplette
   Uebersetzung verworfen und den deutschen Text unuebersetzt durchgereicht).
2. Change-Detection-Leck INNERHALB eines Namespace (`--force-key` hat
   unabhaengige, nicht angefragte Keys mit ohnehin schon abweichendem
   Manifest-Hash "gratis" mitgenommen) - siehe ForceKeyScopingTests.
3. Change-Detection-Leck ÜBER Namespace-Grenzen hinweg: ein `--force-key` fuer
   Namespace A loeste bei UNBETEILIGTEN Namespaces B, C, ... trotzdem die
   generische Hash-Drift-Erkennung aus, sobald deren Manifest (z.B. durch
   Hand-Edits an Sprachdateien vorbei am Skript) bereits vorher aus dem Tritt
   geraten war - konkret an trading.json reproduziert waehrend eines
   --force-key common.accountMode-Laufs, inkl. einer echten Fehluebersetzung
   ("different issuers" -> "different exhibitors"). Siehe
   CrossNamespaceScopingTests. Das war KEIN Hash-gegen-EN-Pivot-statt-DE-
   Quelle-Fehler (Phase A vergleicht nachweislich korrekt gegen die DE-
   Quelle) - der Manifest-Vergleich selbst war korrekt, nur nicht auf den
   angefragten Namespace beschraenkt.
4. protect_parenthesized_english() maskierte JEDES rein aus ASCII-Grossbuchstaben-
   freien-Zeichen bestehende Klammer-Wort als vermeintlich bewusst beizubehaltenden
   Fachbegriff - unabhaengig davon, ob es tatsaechlich Englisch war. Betraf sowohl
   Phase B (EN-Pivot -> andere Sprache, wo der Quelltext ohnehin schon Englisch ist -
   siehe protect_parenthesized_english_for_target) als auch Phase A selbst (z.B.
   "(leer)" ist reines ASCII-Deutsch ohne Umlaute und wurde faelschlich wie ein
   Fachbegriff wie "Multi-Signature" behandelt - siehe _looks_like_kept_english_term).
   Der Platzhalter kam in beiden Faellen unuebersetzt zurueck. Konkret beobachtet:
   payment.send.memoMismatch.empty = "(empty)"/"(leer)" blieb unlokalisiert. Siehe
   ParenthesizedEnglishPhaseTests.
5. translate_text_deepl() rief die DeepL-API nie mit explizitem source_lang auf und
   verliess sich auf Sprach-Auto-Detection - bei kurzen, kontextlosen Strings (z.B.
   einem einzelnen Wort ohne Satz drumherum) traf DeepL dabei nachweislich falsche
   Entscheidungen (verifiziert gegen die echte API: "(leer)" wurde als Afrikaans
   erkannt und zu "(learn)" statt "(empty)" uebersetzt). Da die Pipeline strukturell
   IMMER DE -> EN (Phase A) oder EN-Pivot -> andere Sprache (Phase B) uebersetzt, ist
   die Quellsprache nie unbekannt und wird jetzt explizit aus target_lang abgeleitet
   und mitgesendet. Siehe DeepLSourceLangTests.

Nur Standardbibliothek (unittest) - kein pytest/Netzwerk noetig.
Aufruf: python3 -m unittest test_UpdateSprachdateienBasierendAufDE -v
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import UpdateSprachdateienBasierendAufDE as usd  # noqa: E402


class SpecialCharProtectionTests(unittest.TestCase):
    """Bug 2: gängige Interpunktion darf die Übersetzung nicht blockieren."""

    def test_common_punctuation_not_flagged_as_special(self):
        # Diese Zeichen sollen NICHT in _extract_special_chars auftauchen -
        # ein Übersetzer darf sie legitim anders formulieren/stylen.
        samples = {
            "&": "Äpfel & Birnen",
            "–": "Ein Satz – mit Gedankenstrich.",
            "—": "Ein Satz — mit langem Gedankenstrich.",
            "…": "Warte kurz…",
            "„": "„Zitat” im Text",
            "‘": "‘Zitat’ im Text",
        }
        for ch, text in samples.items():
            with self.subTest(char=ch):
                found = usd._extract_special_chars(text)
                self.assertNotIn(ch, found, f"{ch!r} sollte nicht als Sonderzeichen gelten")

    def test_ampersand_reworded_translation_is_kept(self):
        # Regressionstest fuer den konkret beobachteten Bug: DeepL uebersetzt
        # "&" oft als "und"/"and" statt es woertlich zu behalten - das darf die
        # Uebersetzung nicht verwerfen.
        source = "Token suchen & handeln"
        translated = "Find and Trade Tokens"  # kein "&" mehr enthalten
        result = usd._preserve_special_chars(source, translated, "menu.swap")
        self.assertEqual(result, translated, "Übersetzung ohne '&' darf nicht auf DE-Text zurückfallen")

    def test_en_dash_reworded_translation_is_kept(self):
        source = "Mehr Infos – siehe Glossar."
        translated = "Zie de woordenlijst voor meer informatie."  # kein "–" mehr enthalten
        result = usd._preserve_special_chars(source, translated, "glossary.tokenTrading.desc")
        self.assertEqual(result, translated, "Übersetzung ohne '–' darf nicht auf DE-Text zurückfallen")

    def test_star_icon_is_still_protected(self):
        # Regressionsschutz: echte Icons/Symbole (z.B. ★) muessen weiterhin
        # geschuetzt werden, sonst geht UI-Ikonografie verloren.
        source = "Bonus ★ Level"
        translated_missing_star = "Bonus Level"  # Symbol verloren gegangen
        result = usd._preserve_special_chars(source, translated_missing_star, "some.key")
        self.assertEqual(result, source, "Fehlendes ★ muss weiterhin zum Fallback auf den Quelltext führen")

    def test_star_icon_kept_when_present(self):
        source = "Bonus ★ Level"
        translated_with_star = "Bonus ★ Niveau"
        result = usd._preserve_special_chars(source, translated_with_star, "some.key")
        self.assertEqual(result, translated_with_star)


class ForceKeyScopingTests(unittest.TestCase):
    """Bug 1: --force-key darf ausschließlich den angegebenen Key anfassen."""

    def setUp(self):
        # Sicherheitsnetz: das ECHTE .i18n_hash-Verzeichnis des Repos darf durch
        # keinen dieser Tests je berührt werden. Snapshot vor dem Test, Vergleich
        # in tearDown - schlägt hart fehl, falls ein Test versehentlich doch den
        # realen HASH_DIR statt des Test-Verzeichnisses verwendet (das ist exakt
        # der Vorfall, der bei der ersten Version dieses Tests passiert ist).
        self._real_hash_dir = usd.HASH_DIR
        self._real_hash_snapshot = self._snapshot_dir(self._real_hash_dir)

        self.tmp = tempfile.TemporaryDirectory()
        self.base_path = self.tmp.name
        self.langs = [l for l in usd.TARGET_LANGS if l != "en"]

        de_dir = os.path.join(self.base_path, "de")
        os.makedirs(de_dir, exist_ok=True)
        with open(os.path.join(de_dir, "testns.json"), "w", encoding="utf-8") as f:
            json.dump({"a": "Wert A", "b": "Wert B"}, f)

        # EN + alle Zielsprachen bereits vollständig vorhanden ("a" und "b" schon übersetzt).
        en_dir = os.path.join(self.base_path, "en")
        os.makedirs(en_dir, exist_ok=True)
        with open(os.path.join(en_dir, "testns.json"), "w", encoding="utf-8") as f:
            json.dump({"a": "Value A (old)", "b": "Value B (old)"}, f)

        for lang in self.langs:
            lang_dir = os.path.join(self.base_path, lang)
            os.makedirs(lang_dir, exist_ok=True)
            with open(os.path.join(lang_dir, "testns.json"), "w", encoding="utf-8") as f:
                json.dump({"a": f"{lang}-A (old)", "b": f"{lang}-B (old)"}, f)

        # Manifeste: "a" korrekt (Hash passt zum aktuellen Text), "b" absichtlich
        # STALE (Hash passt NICHT mehr) - simuliert genau die Art von Drift, die
        # in der Praxis beobachtet wurde (Manifest und Content sind auseinandergelaufen).
        hash_dir = os.path.join(self.base_path, ".i18n_hash")
        os.makedirs(hash_dir, exist_ok=True)
        man_en_from_de = {
            "testns.a": usd._sha256("Wert A"),
            "testns.b": "stale-hash-does-not-match-current-content",
        }
        with open(os.path.join(hash_dir, "en_from_de.json"), "w", encoding="utf-8") as f:
            json.dump(man_en_from_de, f)
        for lang in self.langs:
            man_lang_from_en = {
                "testns.a": usd._sha256("Value A (old)"),
                "testns.b": "stale-hash-does-not-match-current-content",
            }
            with open(os.path.join(hash_dir, f"{lang}_from_en.json"), "w", encoding="utf-8") as f:
                json.dump(man_lang_from_en, f)

        os.environ["DEEPL_API_KEY"] = "test-key-not-used"

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("DEEPL_API_KEY", None)
        after = self._snapshot_dir(self._real_hash_dir)
        self.assertEqual(
            self._real_hash_snapshot, after,
            "Das echte Repo-.i18n_hash-Verzeichnis wurde von diesem Test verändert! "
            "Das darf nie passieren - Tests müssen ausschließlich im Temp-Verzeichnis schreiben.",
        )

    @staticmethod
    def _snapshot_dir(path: str) -> dict:
        if not os.path.isdir(path):
            return {}
        snap = {}
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            if os.path.isfile(full):
                with open(full, "rb") as f:
                    snap[name] = f.read()
        return snap

    def _run_force_key(self, force_key: str):
        translated_texts = []

        def fake_translate_text_deepl(text, target_lang, api_key, api_url=None):
            translated_texts.append((target_lang, text))
            return f"[{target_lang}] {text}"

        argv = [
            "UpdateSprachdateienBasierendAufDE.py",
            "--provider", "deepl",
            "--base-path", self.base_path,
            "--force-key", force_key,
        ]
        # Zusaetzliche Absicherung (defense in depth) neben dem --base-path-Fix:
        # HASH_DIR wird hier zusaetzlich explizit auf das Test-Verzeichnis gepatcht,
        # damit ein Testlauf niemals die echten Repo-Manifeste beruehren kann,
        # selbst falls der --base-path-Fix in main() künftig regressiert.
        test_hash_dir = os.path.join(self.base_path, ".i18n_hash")
        with mock.patch.object(usd, "translate_text_deepl", side_effect=fake_translate_text_deepl), \
             mock.patch.object(usd, "HASH_DIR", test_hash_dir), \
             mock.patch.object(sys, "argv", argv):
            usd.main()
        return translated_texts

    def _load(self, lang):
        with open(os.path.join(self.base_path, lang, "testns.json"), encoding="utf-8") as f:
            return json.load(f)

    def _load_manifest(self, filename):
        with open(os.path.join(self.base_path, ".i18n_hash", filename), encoding="utf-8") as f:
            return json.load(f)

    def test_force_key_only_touches_forced_key_content(self):
        self._run_force_key("testns.a")

        en_data = self._load("en")
        self.assertEqual(en_data["a"], "[en] Wert A", "'a' hätte neu übersetzt werden müssen")
        self.assertEqual(en_data["b"], "Value B (old)", "'b' hätte trotz Hash-Drift NICHT angefasst werden dürfen")

        for lang in self.langs:
            data = self._load(lang)
            self.assertTrue(
                data["a"].startswith(f"[{lang}]"),
                f"'{lang}.a' hätte neu übersetzt werden müssen, ist aber: {data['a']!r}",
            )
            self.assertEqual(
                data["b"], f"{lang}-B (old)",
                f"'{lang}.b' hätte trotz Hash-Drift NICHT angefasst werden dürfen",
            )

    def test_force_key_does_not_silently_heal_unrelated_drift(self):
        self._run_force_key("testns.a")

        man_en = self._load_manifest("en_from_de.json")
        self.assertEqual(
            man_en["testns.a"], usd._sha256("Wert A"),
            "Manifest für 'a' hätte auf den aktuellen Hash aktualisiert werden müssen",
        )
        self.assertEqual(
            man_en["testns.b"], "stale-hash-does-not-match-current-content",
            "Manifest für 'b' darf NICHT still auf 'passend' gesetzt werden, ohne dass 'b' "
            "tatsächlich neu übersetzt wurde - sonst erkennt ein späterer normaler Lauf die "
            "echte Drift von 'b' nie mehr.",
        )

        for lang in self.langs:
            man_lang = self._load_manifest(f"{lang}_from_en.json")
            self.assertEqual(man_lang["testns.b"], "stale-hash-does-not-match-current-content")

    def test_normal_run_without_force_key_still_catches_real_drift(self):
        # Gegenprobe: OHNE --force-key muss die normale inkrementelle Drift-Erkennung
        # weiterhin greifen (sonst hätten wir den Bug nur verschoben, nicht behoben).
        argv = [
            "UpdateSprachdateienBasierendAufDE.py",
            "--provider", "deepl",
            "--base-path", self.base_path,
        ]

        def fake_translate_text_deepl(text, target_lang, api_key, api_url=None):
            return f"[{target_lang}] {text}"

        test_hash_dir = os.path.join(self.base_path, ".i18n_hash")
        with mock.patch.object(usd, "translate_text_deepl", side_effect=fake_translate_text_deepl), \
             mock.patch.object(usd, "HASH_DIR", test_hash_dir), \
             mock.patch.object(sys, "argv", argv):
            usd.main()

        en_data = self._load("en")
        self.assertEqual(en_data["b"], "[en] Wert B", "Echte Drift bei 'b' hätte ohne --force-key erkannt werden müssen")


class CrossNamespaceScopingTests(unittest.TestCase):
    """Bug 1 (eigentliche Ursache): --force-key für Namespace A darf Namespace B mit
    vorbestehender, unabhängiger Manifest-Drift NICHT anfassen. ForceKeyScopingTests
    oben deckt nur Drift INNERHALB desselben Namespace ab (dort war forced_paths für
    diesen Namespace nie leer) - dieser Test bildet zwei getrennte Namespace-Dateien
    nach, wie sie im echten Repo vorkommen (z.B. "common" vs. "trading"), und ist damit
    der erste Test, der die eigentliche Lücke reproduziert."""

    def setUp(self):
        self._real_hash_dir = usd.HASH_DIR
        self._real_hash_snapshot = self._snapshot_dir(self._real_hash_dir)

        self.tmp = tempfile.TemporaryDirectory()
        self.base_path = self.tmp.name
        self.langs = [l for l in usd.TARGET_LANGS if l != "en"]

        de_dir = os.path.join(self.base_path, "de")
        os.makedirs(de_dir, exist_ok=True)
        # Namespace, der per --force-key angefragt wird.
        with open(os.path.join(de_dir, "targetns.json"), "w", encoding="utf-8") as f:
            json.dump({"a": "Wert A"}, f)
        # Völlig unbeteiligter zweiter Namespace mit bereits VORHANDENER, unabhängiger
        # Manifest-Drift (z.B. weil er früher per Hand-Edit an der Pipeline vorbei
        # aktualisiert wurde) - genau das Muster, das trading.json betraf.
        with open(os.path.join(de_dir, "otherns.json"), "w", encoding="utf-8") as f:
            json.dump({"x": "Anderer Wert X"}, f)

        en_dir = os.path.join(self.base_path, "en")
        os.makedirs(en_dir, exist_ok=True)
        with open(os.path.join(en_dir, "targetns.json"), "w", encoding="utf-8") as f:
            json.dump({"a": "Value A (old)"}, f)
        with open(os.path.join(en_dir, "otherns.json"), "w", encoding="utf-8") as f:
            json.dump({"x": "Other Value X (already correct, just not hashed)"}, f)

        for lang in self.langs:
            lang_dir = os.path.join(self.base_path, lang)
            os.makedirs(lang_dir, exist_ok=True)
            with open(os.path.join(lang_dir, "targetns.json"), "w", encoding="utf-8") as f:
                json.dump({"a": f"{lang}-A (old)"}, f)
            with open(os.path.join(lang_dir, "otherns.json"), "w", encoding="utf-8") as f:
                json.dump({"x": f"{lang}-X (already correct, just not hashed)"}, f)

        hash_dir = os.path.join(self.base_path, ".i18n_hash")
        os.makedirs(hash_dir, exist_ok=True)
        man_en_from_de = {
            "targetns.a": "stale",
            "otherns.x": "stale-drift-unrelated-to-this-run",
        }
        with open(os.path.join(hash_dir, "en_from_de.json"), "w", encoding="utf-8") as f:
            json.dump(man_en_from_de, f)
        for lang in self.langs:
            man_lang = {
                "targetns.a": "stale",
                "otherns.x": "stale-drift-unrelated-to-this-run",
            }
            with open(os.path.join(hash_dir, f"{lang}_from_en.json"), "w", encoding="utf-8") as f:
                json.dump(man_lang, f)

        os.environ["DEEPL_API_KEY"] = "test-key-not-used"

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("DEEPL_API_KEY", None)
        after = self._snapshot_dir(self._real_hash_dir)
        self.assertEqual(
            self._real_hash_snapshot, after,
            "Das echte Repo-.i18n_hash-Verzeichnis wurde von diesem Test verändert!",
        )

    @staticmethod
    def _snapshot_dir(path: str) -> dict:
        if not os.path.isdir(path):
            return {}
        snap = {}
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            if os.path.isfile(full):
                with open(full, "rb") as f:
                    snap[name] = f.read()
        return snap

    def _load(self, lang, ns):
        with open(os.path.join(self.base_path, lang, f"{ns}.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_force_key_for_one_namespace_leaves_other_namespaces_untouched(self):
        def fake_translate_text_deepl(text, target_lang, api_key, api_url=None):
            return f"[{target_lang}] {text}"

        argv = [
            "UpdateSprachdateienBasierendAufDE.py",
            "--provider", "deepl",
            "--base-path", self.base_path,
            "--force-key", "targetns.a",
        ]
        test_hash_dir = os.path.join(self.base_path, ".i18n_hash")
        with mock.patch.object(usd, "translate_text_deepl", side_effect=fake_translate_text_deepl), \
             mock.patch.object(usd, "HASH_DIR", test_hash_dir), \
             mock.patch.object(sys, "argv", argv):
            usd.main()

        # Der angefragte Namespace/Key wurde übersetzt.
        self.assertEqual(self._load("en", "targetns")["a"], "[en] Wert A")

        # Der unbeteiligte Namespace bleibt in JEDER Sprache byte-identisch, obwohl sein
        # Manifest ebenfalls eine (vorbestehende, unabhängige) Drift aufwies.
        self.assertEqual(
            self._load("en", "otherns"),
            {"x": "Other Value X (already correct, just not hashed)"},
            "Unbeteiligter Namespace 'otherns' wurde durch --force-key 'targetns.a' angefasst",
        )
        for lang in self.langs:
            self.assertEqual(
                self._load(lang, "otherns"),
                {"x": f"{lang}-X (already correct, just not hashed)"},
                f"Unbeteiligter Namespace 'otherns' wurde für {lang} durch --force-key 'targetns.a' angefasst",
            )


class ParenthesizedEnglishPhaseTests(unittest.TestCase):
    """Bekannter Nebenbefund: protect_parenthesized_english() darf nur in Phase A
    (DE -> EN) greifen. In Phase B (EN-Pivot -> andere Sprache) ist der Quelltext
    bereits Englisch - jedes kurze ASCII-Klammer-Wort (z.B. "(empty)") wurde dort
    fälschlich als zu erhaltender Fachbegriff maskiert und kam unübersetzt zurück."""

    def test_phase_a_still_protects_deliberate_english_terms(self):
        protected, placeholders = usd.protect_parenthesized_english_for_target(
            "Mehrfachsignatur (Multi-Signature) schützt dein Konto.", "en"
        )
        self.assertIn("Multi-Signature", placeholders.values())
        self.assertNotIn("Multi-Signature", protected)

    def test_phase_a_does_not_protect_plain_german_words_or_phrases(self):
        # Zweite Bug-Ebene, unabhängig von der Phase-B-Beschränkung oben: reines
        # ASCII-Alphabet allein reicht nicht, um "Englisch" von "Deutsch ohne Umlaute"
        # zu unterscheiden. Konkret beobachtet: "(leer)" wurde SELBST in Phase A
        # (DE -> EN, wo die Maskierung grundsätzlich greifen soll) fälschlich als
        # Fachbegriff maskiert - die Übersetzung "empty" kam nie an, EN blieb
        # buchstäblich "(leer)" stehen.
        cases = [
            "(leer)",
            "(einmalig beim ersten Aktivieren)",
            "(zum Aktivieren)",
            "(schnell)",
        ]
        for text in cases:
            with self.subTest(text=text):
                protected, placeholders = usd.protect_parenthesized_english_for_target(text, "en")
                self.assertEqual(placeholders, {}, f"{text!r} sollte in Phase A nicht maskiert werden")
                self.assertEqual(protected, text)

    def test_phase_a_still_protects_technical_tokens(self):
        # Gegenprobe: kurze, eindeutig technische/Marken-Begriffe müssen weiterhin
        # geschützt bleiben, damit die Verschärfung nicht zu weit geht.
        cases = ["Testnet", "uint64", "MEMO_RETURN", "CODE:ISSUER", "ed25519", "S-Key"]
        for term in cases:
            with self.subTest(term=term):
                text = f"Wert ({term}) im Kontext."
                protected, placeholders = usd.protect_parenthesized_english_for_target(text, "en")
                self.assertIn(term, placeholders.values(), f"{term!r} sollte weiterhin geschützt werden")

    def test_phase_a_does_not_protect_hyphenated_german_compounds(self):
        # Dritte Bug-Ebene, unabhängig von den beiden obigen: ein Bindestrich-Kompositum
        # (kein Leerzeichen!) mit einem gewöhnlichen deutschen Wortteil rutschte bisher
        # trotzdem durch, weil IRGENDEIN Großbuchstabe im gesamten String reichte - und
        # deutsche Substantive sind immer großgeschrieben. Konkret zweimal beobachtet:
        # "hashX (Hash-Vorlage)" und "(M-Adresse)" blieben unübersetzt stehen.
        cases = ["Hash-Vorlage", "M-Adresse", "G-Adresse"]
        for term in cases:
            with self.subTest(term=term):
                text = f"Wert ({term}) im Kontext."
                protected, placeholders = usd.protect_parenthesized_english_for_target(text, "en")
                self.assertEqual(placeholders, {}, f"{term!r} sollte NICHT mehr geschützt werden")
                self.assertEqual(protected, text)

    def test_phase_a_still_protects_hyphenated_english_terms(self):
        # Gegenprobe zur vorigen Ergänzung: "S-Key" (bereits oben abgedeckt) und
        # "Multi-Signature" haben exakt dieselbe Form wie die jetzt freigegebenen
        # Fälle (Großbuchstabe/Wort + Bindestrich + großgeschriebenes Wort) - der Fix
        # unterscheidet gezielt über den Wortteil nach dem Bindestrich, nicht über die
        # Form, damit genau diese weiterhin geschützt bleiben.
        cases = ["Multi-Signature", "S-Key"]
        for term in cases:
            with self.subTest(term=term):
                text = f"Wert ({term}) im Kontext."
                protected, placeholders = usd.protect_parenthesized_english_for_target(text, "en")
                self.assertIn(term, placeholders.values(), f"{term!r} sollte weiterhin geschützt werden")

    def test_hyphenated_german_compound_denylist_is_documented_and_limited(self):
        # Dokumentiert bewusst die Abwägung: Form allein (Großschreibung, Bindestrich-
        # Position, Länge) kann Deutsch nicht zuverlässig von Englisch unterscheiden -
        # "S-Key" (schützen) und "M-Adresse" (nicht schützen) haben identische Form.
        # Der Fix verwendet daher eine kleine, kuratierte Denylist statt einer
        # allgemeinen Regel. Das hat eine bekannte, akzeptierte Grenze: ein noch nicht
        # gelisteter deutscher Wortteil bleibt weiterhin (fälschlich) geschützt, bis er
        # auffällt und ergänzt wird - sicherer Default (bewahrt den Text unverändert)
        # statt eines Blindfluges in die andere Richtung.
        self.assertFalse(usd._looks_like_kept_english_term("Hash-Vorlage"))
        self.assertFalse(usd._looks_like_kept_english_term("M-Adresse"))
        # Noch nicht in der Denylist -> bleibt (bekanntermaßen) geschützt, keine Regression:
        self.assertTrue(usd._looks_like_kept_english_term("Bild-Vorschau"))

    def test_phase_b_does_not_mask_short_english_words(self):
        protected, placeholders = usd.protect_parenthesized_english_for_target("(empty)", "es")
        self.assertEqual(placeholders, {}, "Phase B darf keine Platzhalter erzeugen")
        self.assertEqual(protected, "(empty)")

    def test_empty_placeholder_word_gets_translated_end_to_end(self):
        # Regressionstest für den konkreten Vorfall: merge_keys_missing_or_changed (der
        # tatsächliche Phase-B-Codepfad) muss "(empty)" ins Spanische übersetzen, statt
        # am selbstgebauten Platzhalter-Token hängen zu bleiben. protect/restore laufen
        # nur innerhalb von merge_keys_missing_or_changed/translate_full - translate_text
        # selbst kennt sie nicht, daher hier bewusst über den echten Merge-Codepfad testen.
        def fake_translate_es(text, target_lang, api_key, api_url=None):
            self.assertNotIn("__KEEP_EN_TERM_", text, "Phase B darf DeepL keinen Platzhalter-Token schicken")
            return "(vacío)"

        counters: dict = {}
        failed_paths: set = set()
        with mock.patch.object(usd, "translate_text_deepl", side_effect=fake_translate_es):
            result = usd.merge_keys_missing_or_changed(
                {"empty": "(empty)"},
                {},
                "es",
                "deepl",
                None,
                "fake-key",
                changed_paths=set(),
                forced_paths=set(),
                counters=counters,
                failed_paths=failed_paths,
            )
        self.assertEqual(result["empty"], "(vacío)")
        self.assertEqual(failed_paths, set())


class DeepLSourceLangTests(unittest.TestCase):
    """Bug 5: DeepL-Aufrufe müssen die Quellsprache explizit setzen statt sich auf
    Auto-Detection zu verlassen (siehe Modul-Docstring). Reine HTTP-Mocking-Tests,
    kein echter Netzwerkzugriff."""

    @staticmethod
    def _fake_urlopen_capturing(captured, translated_text):
        def _urlopen(req, timeout=60):
            captured["body"] = json.loads(req.data.decode("utf-8"))

            class _Resp:
                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, *exc_info):
                    return False

                def read(self_inner):
                    return json.dumps({"translations": [{"text": translated_text}]}).encode("utf-8")

            return _Resp()

        return _urlopen

    def test_phase_a_pins_source_lang_de(self):
        captured: dict = {}
        with mock.patch("urllib.request.urlopen", side_effect=self._fake_urlopen_capturing(captured, "(blank)")):
            result = usd.translate_text_deepl("(leer)", "en", "fake-key")
        self.assertEqual(captured["body"].get("source_lang"), "DE")
        self.assertEqual(captured["body"].get("target_lang"), "EN")
        self.assertEqual(result, "(blank)")

    def test_phase_b_pins_source_lang_en(self):
        captured: dict = {}
        with mock.patch("urllib.request.urlopen", side_effect=self._fake_urlopen_capturing(captured, "(vacío)")):
            result = usd.translate_text_deepl("(empty)", "es", "fake-key")
        self.assertEqual(captured["body"].get("source_lang"), "EN")
        self.assertEqual(captured["body"].get("target_lang"), "ES")
        self.assertEqual(result, "(vacío)")


if __name__ == "__main__":
    unittest.main()
