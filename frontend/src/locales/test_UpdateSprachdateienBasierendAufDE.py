"""
Regressionstests für UpdateSprachdateienBasierendAufDE.py.

Deckt zwei konkret aufgetretene Pipeline-Bugs ab:

1. Sonderzeichen-Schutz ("&" und "–" haben faelschlich die komplette
   Uebersetzung verworfen und den deutschen Text unuebersetzt durchgereicht).
2. Change-Detection-Leck (`--force-key` hat unabhaengige, nicht angefragte
   Keys mit ohnehin schon abweichendem Manifest-Hash "gratis" mitgenommen).

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


if __name__ == "__main__":
    unittest.main()
