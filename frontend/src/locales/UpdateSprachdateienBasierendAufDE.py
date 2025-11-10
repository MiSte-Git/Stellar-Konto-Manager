import json
import os
import argparse
from argparse import RawTextHelpFormatter
import subprocess
import sys
import re
from typing import Dict, Any, Set

# Optionaler Import nur bei Bedarf
# (vermeidet harten Import-Fehler, wenn nur DeepL genutzt wird)
try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

BASE_LANG = "de"
TARGET_LANGS = ["en", "nl", "es", "fr", "it", "fi", "hr", "ru"]
BASE_PATH = "."  # Anpassen, falls nötig, z. B. "./src/lib/i18n"


def load_json(file: str) -> Dict[str, Any]:
    """Lade eine JSON-Datei."""
    try:
        with open(file, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"⚠️ Datei nicht gefunden: {file}")
        return {}
    except json.JSONDecodeError:
        print(f"⚠️ Ungültiges JSON in: {file}")
        return {}


def save_json(file: str, data: Dict[str, Any]) -> None:
    """Speichere eine JSON-Datei."""
    try:
        with open(file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"💾 Datei gespeichert: {file}")
    except Exception as e:
        print(f"❌ Fehler beim Speichern von {file}: {e}")


def translate_text_openai(text: str, target_lang: str, api_key: str) -> str:
    """Übersetze via OpenAI Chat Completions."""
    if not OpenAI:
        raise RuntimeError(
            "openai-Paket ist nicht installiert. Bitte 'pip install openai' ausführen oder Provider 'deepl' verwenden."
        )
    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"Übersetze den folgenden Text präzise ins {target_lang}. Behalte den Kontext und die Bedeutung bei.",
                },
                {"role": "user", "content": text},
            ],
        )
        translated = response.choices[0].message.content.strip()
        return translated if translated else text
    except Exception as e:
        print(f"❌ Fehler bei OpenAI-Übersetzung nach {target_lang}: {e}")
        return text


def translate_text_deepl(text: str, target_lang: str, api_key: str, api_url: str | None = None) -> str:
    """Übersetze via DeepL REST API ohne zusätzliche Abhängigkeiten.
    Setzt 'DEEPL_API_URL' optional, sonst api-free.deepl.com.
    Bei Fehlern wird eine Exception geworfen, damit die aktuelle Sprache abgebrochen werden kann.
    """
    import urllib.parse
    import urllib.request
    import urllib.error

    url = (api_url or os.getenv("DEEPL_API_URL") or "https://api-free.deepl.com/v2/translate").strip()
    params = {
        "auth_key": api_key,
        "text": text,
        "target_lang": target_lang.upper(),  # z. B. EN, DE, FR
    }
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            trans_list = payload.get("translations") or []
            if trans_list:
                return (trans_list[0].get("text") or text).strip()
            # Unerwartete Antwort -> Fehler werfen
            raise RuntimeError("DeepL: leere Antwort erhalten")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RuntimeError("DeepL: 429 Too Many Requests (Rate Limit). Abbruch der aktuellen Sprache.")
        else:
            raise RuntimeError(f"DeepL: HTTP {e.code} {e.reason}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"DeepL: Netzwerkfehler: {e.reason}")
    except Exception as e:
        raise RuntimeError(f"DeepL: unbekannter Fehler: {e}")


def translate_text(
    text: str,
    target_lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
) -> str:
    if provider == "openai":
        if not openai_key:
            raise RuntimeError("OPENAI_API_KEY fehlt in der Umgebung.")
        return translate_text_openai(text, target_lang, openai_key)
    elif provider == "deepl":
        if not deepl_key:
            raise RuntimeError("DEEPL_API_KEY (oder DEEPL_AUTH_KEY) fehlt in der Umgebung.")
        return translate_text_deepl(text, target_lang, deepl_key)
    else:
        raise RuntimeError(f"Unbekannter Provider: {provider}")


# -------- Original-Key Handling (never translate, copy from de.json) --------
ORIGINAL_RE = re.compile(r'(^|\.)original$')

def is_original_key(path: str) -> bool:
    return bool(ORIGINAL_RE.search(path))

def _handle_skip_original(path: str, counters: Dict[str, int] | None = None) -> None:
    # Log and increment skipped counter; raise and catch for UI-compat string
    print(f"Überspringe Übersetzung für Original-Key: {path}")
    if counters is not None:
        counters['skippedOriginalKeysCount'] = counters.get('skippedOriginalKeysCount', 0) + 1
    try:
        raise Exception('i18n.translate.skipOriginal:' + path)
    except Exception:
        # Swallow to continue processing
        pass


# -------- Git-Diff-gestützte Änderungs-Erkennung --------

def _collect_leaf_paths(d: Dict[str, Any], prefix: str = "") -> Set[str]:
    paths: Set[str] = set()
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            paths |= _collect_leaf_paths(v, p)
        else:
            paths.add(p)
    return paths


def _diff_changed_paths(old: Dict[str, Any], new: Dict[str, Any], prefix: str = "") -> tuple[Set[str], Set[str]]:
    """Gibt zwei Sets zurück: (neu_hinzugefügt, geändert)"""
    added: Set[str] = set()
    changed: Set[str] = set()
    # Keys added or changed
    for k, v_new in new.items():
        p = f"{prefix}.{k}" if prefix else k
        if k not in old:
            # Alle Blätter unter k neu
            if isinstance(v_new, dict):
                added |= _collect_leaf_paths(v_new, p)
            else:
                added.add(p)
        else:
            v_old = old[k]
            if isinstance(v_new, dict) and isinstance(v_old, dict):
                sub_added, sub_changed = _diff_changed_paths(v_old, v_new, p)
                added |= sub_added
                changed |= sub_changed
            elif v_new != v_old:
                # Wert geändert
                changed.add(p)
    # Entfernte Keys ignorieren (für Übersetzung irrelevant)
    return added, changed


def compute_changed_paths_with_git(base_file: str) -> tuple[Set[str], Set[str]]:
    """Vergleicht de.json gegen HEAD-Version und liefert (neu_hinzugefügt, geändert).
    Fällt bei fehlendem Git oder fehlender HEAD-Version auf leere Mengen zurück.
    """
    try:
        # Hol die HEAD-Version der Basisdatei
        res = subprocess.run(
            ["git", "show", f"HEAD:{base_file}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode != 0 or not res.stdout.strip():
            # Kein HEAD (z. B. initial) oder Datei nicht im HEAD → keine Zwangs-Updates
            return set(), set()
        old_dict = json.loads(res.stdout)
        new_dict = load_json(base_file)
        if not isinstance(old_dict, dict) or not isinstance(new_dict, dict):
            return set(), set()
        return _diff_changed_paths(old_dict, new_dict)
    except Exception as e:
        print(f"ℹ️ Git-Diff für {base_file} nicht verfügbar: {e}")
        return set(), set()


def _get_node_by_path(d: Dict[str, Any], path: str):
    node: Any = d
    for part in path.split('.'):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def expand_forced_paths(base_dict: Dict[str, Any], forced_list: list[str]) -> Set[str]:
    out: Set[str] = set()
    for p in forced_list:
        if not p:
            continue
        node = _get_node_by_path(base_dict, p)
        if node is None:
            print(f"ℹ️ Warnung: erzwungener Schlüssel nicht gefunden: {p}")
            continue
        if isinstance(node, dict):
            out |= _collect_leaf_paths(node, p)
        else:
            out.add(p)
    return out


def merge_keys_missing_or_changed(
    base_dict: Dict[str, Any],
    target_dict: Dict[str, Any],
    lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
    changed_paths: Set[str],
    forced_paths: Set[str],
    counters: Dict[str, int],
    prefix: str = "",
) -> Dict[str, Any]:
    """Füge fehlende Schlüssel hinzu ODER aktualisiere gezielt geänderte Leaf-Pfade aus de.json.
    - Wenn ein Pfad in changed_paths liegt, wird er neu übersetzt (überschreibt bestehende Werte).
    - Fehlende Keys werden wie zuvor ergänzt.
    - Keys, die auf '.original' enden, werden nie übersetzt. Sie werden aus de.json kopiert;
      vorhandene Werte werden nur überschrieben, wenn der Pfad in forced_paths liegt.
    """
    out = dict(target_dict)
    for key, value in base_dict.items():
        cur_path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out[key] = merge_keys_missing_or_changed(
                value,
                out.get(key, {}),
                lang,
                provider,
                openai_key,
                deepl_key,
                changed_paths,
                forced_paths,
                counters,
                cur_path,
            )
        else:
            if is_original_key(cur_path):
                # Skip translation, copy from base; overwrite only if forced
                _handle_skip_original(cur_path, counters)
                if key not in out:
                    out[key] = value
                    counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                else:
                    if cur_path in forced_paths and out.get(key) != value:
                        out[key] = value
                        counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                continue
            needs_update = (key not in out) or (cur_path in changed_paths)
            if needs_update:
                translated = translate_text(value, lang, provider, openai_key, deepl_key)
                out[key] = translated
    return out


def translate_full(
    base_dict: Dict[str, Any],
    lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
    target_existing: Dict[str, Any] | None = None,
    forced_paths: Set[str] | None = None,
    counters: Dict[str, int] | None = None,
    prefix: str = "",
) -> Dict[str, Any]:
    """Übersetze alle Schlüssel aus base_dict neu in die Zielsprache.
    Für Keys, die auf '.original' enden, wird niemals übersetzt; sie werden aus de.json kopiert.
    Bereits bestehende Werte werden nur überschrieben, wenn der Pfad in forced_paths liegt.
    """
    target_dict: Dict[str, Any] = {}
    target_existing = target_existing or {}
    forced_paths = forced_paths or set()
    for key, value in base_dict.items():
        cur_path = f"{prefix}.{key}" if prefix else key
        existing_val = target_existing.get(key)
        if isinstance(value, dict):
            target_dict[key] = translate_full(
                value,
                lang,
                provider,
                openai_key,
                deepl_key,
                (existing_val if isinstance(existing_val, dict) else {}),
                forced_paths,
                counters,
                cur_path,
            )
        else:
            if is_original_key(cur_path):
                _handle_skip_original(cur_path, counters)
                if existing_val is None or cur_path in forced_paths:
                    target_dict[key] = value
                    if counters is not None:
                        counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                else:
                    # keep existing value, do not overwrite
                    target_dict[key] = existing_val
            else:
                translated = translate_text(value, lang, provider, openai_key, deepl_key)
                target_dict[key] = translated
    return target_dict


# -------- Learn-Namespace: fehlende Keys aus lessons.json ergänzen + Spiegel erzeugen --------

def deep_merge_missing(target: Dict[str, Any], source: Dict[str, Any], diffs: list[str] | None = None, prefix: str = "") -> None:
    """Fügt nur fehlende Keys aus source in target ein. Bei unterschiedlichen vorhandenen Werten wird NICHT überschrieben,
    sondern der Pfad in diffs vermerkt.
    """
    for k, v in (source or {}).items():
        cur = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            if k not in target or not isinstance(target.get(k), dict):
                target[k] = {}
            deep_merge_missing(target[k], v, diffs, cur)
        else:
            if k not in target:
                target[k] = v
            else:
                if target[k] != v and diffs is not None:
                    diffs.append(cur)


def main():
    # Argumente parsen
    parser = argparse.ArgumentParser(
        description=(
            "Aktualisiert Sprachdateien basierend auf de.json.\n"
            "\n"
            "Standard (ohne Zusatz-Flags):\n"
            "  • Fehlende Schlüssel werden ergänzt.\n"
            "  • Geänderte Schlüssel in de.json seit HEAD (Git-Diff) werden gezielt neu übersetzt.\n"
            "\n"
            "Optionen:\n"
            "  --force-key <pfad>   Erzwingt Neuübersetzung einzelner Schlüssel (dot-Pfade).\n"
            "                       Mehrfach nutzbar oder komma-separiert.\n"
            "                       Beispiele: feedback.title  |  menu.feedback  |  feedback\n"
            "  --full               Übersetzt alle Schlüssel komplett neu.\n"
            "\n"
            "Beispiele:\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --force-key feedback.title --force-key menu.feedback\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --force-key feedback,menu.feedback\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider openai --full\n"
        ),
        formatter_class=RawTextHelpFormatter,
    )
    # Kein --mode mehr nötig; Standard ist 'missing+changed'. Optional kann vollständig neu übersetzt werden.
    parser.add_argument(
        "--full",
        action="store_true",
        help="Alle Schlüssel vollständig neu übersetzen (anstatt nur fehlende/geänderte)",
    )
    parser.add_argument(
        "--provider",
        choices=["openai", "deepl"],
        required=True,
        help="Welcher Übersetzungsdienst genutzt werden soll: 'openai' oder 'deepl'",
    )
    parser.add_argument(
        "--base-path",
        default=BASE_PATH,
        help="Pfad zum Verzeichnis mit Sprachdateien (Standard: aktuelles Verzeichnis)",
    )
    parser.add_argument(
        "--force-key",
        dest="force_keys",
        action="append",
        help="Erzwingt Neuübersetzung für bestimmte Schlüssel (dot-Pfade, mehrfach nutzbar oder komma-separiert)",
    )
    # Wenn ohne Argumente aufgerufen: vollständige Hilfe zeigen und beenden
    if len(sys.argv) == 1:
        parser.print_help()
        print("\nHinweis: --provider ist erforderlich (openai|deepl). Beispiele siehe oben.")
        return

    args = parser.parse_args()

    base_path = args.base_path
    provider = args.provider
    do_full = bool(args.full)
    force_keys_raw = args.force_keys or []

    # API-Keys aus Umgebungsvariablen lesen
    openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
    deepl_key = os.getenv("DEEPL_API_KEY") or os.getenv("DEEPL_AUTH_KEY")

    # Frühzeitige Validierung + Debug-Hinweis (ohne Secrets)
    if provider == "openai" and not openai_key:
        print("❌ OPENAI_API_KEY nicht gesetzt. Abbruch.")
        return
    if provider == "deepl":
        if not deepl_key:
            print("❌ DEEPL_API_KEY/DEEPL_AUTH_KEY nicht gesetzt. Abbruch.")
            return
        print(f"ℹ️ DeepL endpoint: {(os.getenv('DEEPL_API_URL') or 'https://api-free.deepl.com/v2/translate')}")

    # Lade die Basisdatei (de.json)
    base_file = f"{base_path}/{BASE_LANG}.json"
    base_dict = load_json(base_file)
    if not base_dict:
        print(f"❌ Basisdatei {base_file} konnte nicht geladen werden. Abbruch.")
        return

    # 1) Lerninhalte aus lessons.json als learn.* in de.json sicherstellen (nur fehlende Keys ergänzen)
    try:
        lessons_path = os.path.normpath(os.path.join(base_path, "..", "data", "learn", "lessons.json"))
        lessons_raw = load_json(lessons_path)
        if isinstance(lessons_raw, list):
            learn_from_lessons: Dict[str, Any] = {}
            for l in lessons_raw:
                if not isinstance(l, dict):
                    continue
                lid = l.get("id")
                if not isinstance(lid, str) or not lid:
                    continue
                learn_from_lessons[lid] = {
                    "title": l.get("title", ""),
                    "goal": l.get("goal", ""),
                    "task": l.get("task", ""),
                    "learningOutcome": l.get("learningOutcome", ""),
                    "reward": l.get("reward", ""),
                }
            before = json.dumps(base_dict, ensure_ascii=False, sort_keys=True)
            if not isinstance(base_dict.get("learn"), dict):
                base_dict["learn"] = {}
            diffs_learn_de: list[str] = []
            deep_merge_missing(base_dict["learn"], learn_from_lessons, diffs_learn_de, prefix="learn")
            after = json.dumps(base_dict, ensure_ascii=False, sort_keys=True)
            if before != after:
                save_json(base_file, base_dict)
                print(f"ℹ️ de.json um fehlende learn.*-Keys aus lessons.json ergänzt ({len(diffs_learn_de)} Konflikte ohne Überschreiben)")
            if diffs_learn_de:
                for p in diffs_learn_de:
                    print(f"   ~ Bestehender Wert abweichend, nicht überschrieben: {p}")
        else:
            print("ℹ️ Keine gültige lessons.json-Liste gefunden; Überspringe Learn-Sync.")
    except Exception as e:
        print(f"ℹ️ Learn-Sync übersprungen (Fehler): {e}")

    # 2) Spiegel-Datei für de/learn.json erstellen/aktualisieren (nur fehlende Keys ergänzen)
    try:
        de_ns_file = f"{base_path}/{BASE_LANG}/learn.json"
        existing = load_json(de_ns_file)
        next_obj = json.loads(json.dumps(existing)) if existing else {}
        diffs_ns_de: list[str] = []
        learn_subtree = base_dict.get("learn") if isinstance(base_dict.get("learn"), dict) else {}
        deep_merge_missing(next_obj, learn_subtree, diffs_ns_de)
        if json.dumps(existing, ensure_ascii=False, sort_keys=True) != json.dumps(next_obj, ensure_ascii=False, sort_keys=True):
            save_json(de_ns_file, next_obj)
        if diffs_ns_de:
            print(f"ℹ️ de/learn.json ergänzt. Abweichende bestehende Werte nicht überschrieben: {len(diffs_ns_de)}")
    except Exception as e:
        print(f"ℹ️ Spiegel-Erstellung de/learn.json übersprungen (Fehler): {e}")

    # Ermittele gezielt neue und geänderte Leaf-Pfade gegenüber HEAD
    added_paths, changed_paths = compute_changed_paths_with_git(base_file)
    
    if not do_full:
        if added_paths:
            print(f"ℹ️ Neu hinzugefügte Schlüssel in {BASE_LANG}.json seit HEAD: {len(added_paths)}")
            for p in sorted(added_paths):
                print(f"   + {p}")
        if changed_paths:
            print(f"ℹ️ Geänderte Schlüssel in {BASE_LANG}.json seit HEAD: {len(changed_paths)}")
            for p in sorted(changed_paths):
                print(f"   ~ {p}")

        # Erzwungene Keys (per Argument) zur Änderungsmenge hinzufügen
        forced_list: list[str] = []
        for raw in force_keys_raw:
            forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])
        forced_paths: Set[str] = set()
        if forced_list:
            forced_paths = expand_forced_paths(base_dict, forced_list)
            if forced_paths:
                print(f"ℹ️ Erzwungene Schlüssel (Neuübersetzung): {len(forced_paths)}")
                for p in sorted(forced_paths):
                    print(f"   ! {p}")
                changed_paths |= forced_paths
        else:
            forced_paths = set()
    else:
        # Auch im Full-Mode: forced_paths aus --force-key ermitteln
        forced_list: list[str] = []
        for raw in force_keys_raw:
            forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])
        forced_paths: Set[str] = expand_forced_paths(base_dict, forced_list) if forced_list else set()
    
    # Kombiniere für Übersetzung
    all_changed = added_paths | changed_paths

    # Zähler für Original-Keys
    counters: Dict[str, int] = {"skippedOriginalKeysCount": 0, "copiedOriginalKeysCount": 0}

    # Verarbeite jede Zielsprache
    for lang in TARGET_LANGS:
        path = f"{base_path}/{lang}.json"
        if do_full:
            print(f"\n🔁 Verarbeite {lang} im Modus 'full' mit Provider '{provider}'...")
            total_keys = len(_collect_leaf_paths(base_dict))
            print(f"   Übersetze alle {total_keys} Schlüssel neu (Original-Keys werden nicht übersetzt)...")
        else:
            print(f"\n🔁 Verarbeite {lang} im Modus 'missing+changed' mit Provider '{provider}'...")
        try:
            if not do_full:
                if not os.path.exists(path):
                    print(f"⚠️ Datei fehlt: {path}. Erstelle neue Datei mit allen Übersetzungen.")
                    translated_dict = translate_full(
                        base_dict,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        target_existing={},
                        forced_paths=forced_paths,
                        counters=counters,
                    )
                else:
                    target_dict = load_json(path)
                    translated_dict = merge_keys_missing_or_changed(
                        base_dict,
                        target_dict,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        all_changed,
                        forced_paths,
                        counters,
                    )
            else:
                # Full-Mode: vorhandene Datei ggf. einlesen, damit Original-Keys nicht überschrieben werden
                target_existing = load_json(path) if os.path.exists(path) else {}
                translated_dict = translate_full(
                    base_dict,
                    lang,
                    provider,
                    openai_key,
                    deepl_key,
                    target_existing=target_existing,
                    forced_paths=forced_paths,
                    counters=counters,
                )

            save_json(path, translated_dict)

            # Nach dem Speichern: learn-Teil in locales/<lang>/learn.json spiegeln (nur fehlende Keys erg czen)
            try:
                learn_subtree = base_dict.get("learn") if isinstance(base_dict.get("learn"), dict) else {}
                ns_file = f"{base_path}/{lang}/learn.json"
                existing_ns = load_json(ns_file)
                next_ns = json.loads(json.dumps(existing_ns)) if existing_ns else {}
                diffs_lang_ns: list[str] = []
                deep_merge_missing(next_ns, learn_subtree, diffs_lang_ns)
                if json.dumps(existing_ns, ensure_ascii=False, sort_keys=True) != json.dumps(next_ns, ensure_ascii=False, sort_keys=True):
                    save_json(ns_file, next_ns)
                if diffs_lang_ns:
                    print(f"ℹ️ {lang}/learn.json ergänzt. Abweichende bestehende Werte nicht  cberschrieben: {len(diffs_lang_ns)}")
            except Exception as e:
                print(f"ℹ️ Spiegel-Erstellung {lang}/learn.json übersprungen (Fehler): {e}")
        except Exception as e:
            print(f"❌ Abbruch für Sprache {lang}: {e}")
            continue

    print(f"\nZusammenfassung: {{'skippedOriginalKeysCount': {counters.get('skippedOriginalKeysCount', 0)}, 'copiedOriginalKeysCount': {counters.get('copiedOriginalKeysCount', 0)}}}")
    print("\n✅ Alle Sprachdateien aktualisiert.")


if __name__ == "__main__":
    main()
