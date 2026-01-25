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
# Standard-Basispfad: Verzeichnis dieser Datei, damit Aufruf von überall funktioniert
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
# Verzeichnis für Hash-Manifeste
HASH_DIR = os.path.join(BASE_PATH, ".i18n_hash")


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


def translate_text_openai(text: str, target_lang: str, api_key: str) -> str | None:
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
        msg = response.choices[0].message if response and response.choices else None
        content = (msg.content if msg and hasattr(msg, "content") and isinstance(msg.content, str) else "")
        translated = content.strip()
        return translated if translated else text
    except Exception as e:
        print(f"❌ Fehler bei OpenAI-Übersetzung nach {target_lang}: {e}")
        return None


def translate_text_deepl(text: str, target_lang: str, api_key: str, api_url: str | None = None) -> str:
    """Übersetze via DeepL REST API ohne zusätzliche Abhängigkeiten.
    Setzt 'DEEPL_API_URL' optional, sonst api-free.deepl.com.
    Bei Fehlern wird eine Exception geworfen, damit die aktuelle Sprache abgebrochen werden kann.
    """
    import urllib.parse
    import urllib.request
    import urllib.error

    raw_url = api_url if api_url is not None else os.getenv("DEEPL_API_URL")
    url: str = (raw_url or "https://api-free.deepl.com/v2/translate")
    url = url.strip()
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
) -> str | None:
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
# Sonderzeichen-Erkennung (z.B. ★, Emojis), die wir nicht verlieren dürfen
SPECIAL_CHAR_RE = re.compile(r"[^\w\s.,;:!?'\"()\[\]{}<>\\\-\/]")

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


def _extract_special_chars(text: str) -> Set[str]:
    """Finde Sonderzeichen, die nicht zu Standard-Punktuation gehören (z.B. ★, Emojis)."""
    return set(re.findall(SPECIAL_CHAR_RE, text or ""))


def _preserve_special_chars(source: Any, translated: str, path: str, counters: Dict[str, int] | None = None) -> str:
    """
    Stellt sicher, dass Sonderzeichen (z.B. ★) aus dem Quelltext nicht verloren gehen.
    Falls Zeichen fehlen, wird der Quelltext zurückgegeben, um Layout/Ikonen zu bewahren.
    """
    if not isinstance(source, str):
        return translated
    specials = _extract_special_chars(source)
    if not specials:
        return translated
    translated_str = translated if isinstance(translated, str) else str(translated)
    missing = [ch for ch in specials if ch not in translated_str]
    if missing:
        if counters is not None:
            counters['preservedSpecialCharKeys'] = counters.get('preservedSpecialCharKeys', 0) + 1
        print(f"INFO: Bewahre Sonderzeichen für {path}: {''.join(missing)} → Originaltext übernommen")
        return source
    return translated_str


# -------- Klammer-Begriffe vor Übersetzung schützen --------
KEEP_EN_RE = re.compile(r"\(([^()]*)\)")
ASCII_EN_ALLOWED = re.compile(r"^[A-Za-z0-9 ,._\-/:]+$")


def protect_parenthesized_english(text: str) -> tuple[str, dict[str, str]]:
    """
    Maskiert englische Begriffe in Klammern, damit die Übersetzung sie nicht verändert.
    Beispiel: \"Mehrfachsignatur (Multi-Signature)\" -> \"Mehrfachsignatur (__KEEP_EN_TERM_1__)\".
    """
    placeholders: dict[str, str] = {}
    if not isinstance(text, str) or "(" not in text or ")" not in text:
        return text, placeholders

    def _repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        if not inner or not ASCII_EN_ALLOWED.fullmatch(inner):
            return match.group(0)
        placeholder = f"__KEEP_EN_TERM_{len(placeholders) + 1}__"
        placeholders[placeholder] = inner
        return f"({placeholder})"

    return KEEP_EN_RE.sub(_repl, text), placeholders


def restore_parenthesized_english(text: str, mapping: dict[str, str]) -> str:
    """Setzt zuvor maskierte Klammer-Begriffe wieder zurück (Platzhalter → Original)."""
    if not mapping or not isinstance(text, str):
        return text
    restored = text
    for placeholder, original in mapping.items():
        restored = restored.replace(placeholder, original)
    return restored


# -------- Hash-basierte Änderungs-Erkennung --------

def _collect_leaf_paths(d: Dict[str, Any], prefix: str = "") -> Set[str]:
    paths: Set[str] = set()
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            paths |= _collect_leaf_paths(v, p)
        else:
            paths.add(p)
    return paths


def _flatten_dict(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten_dict(v, p))
        else:
            out[p] = v
    return out


def _sha256(s: str) -> str:
    import hashlib
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _load_manifest(lang: str, from_pivot: str) -> Dict[str, str]:
    path = os.path.join(HASH_DIR, f"{lang}_from_{from_pivot}.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
            return {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def _save_manifest(lang: str, from_pivot: str, data: Dict[str, str]) -> None:
    os.makedirs(HASH_DIR, exist_ok=True)
    path = os.path.join(HASH_DIR, f"{lang}_from_{from_pivot}.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"💾 Manifest gespeichert: {path}")
    except Exception as e:
        print(f"❌ Fehler beim Speichern von Manifest {path}: {e}")


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
            print(f"INFO: Warnung: erzwungener Schlüssel nicht gefunden: {p}")
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
    failed_paths: Set[str],
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
                protected, placeholders = protect_parenthesized_english(value if isinstance(value, str) else "")
                translated_raw = translate_text(protected, lang, provider, openai_key, deepl_key)
                if translated_raw is None:
                    failed_paths.add(cur_path)
                    out[key] = out.get(key, value)
                else:
                    translated = restore_parenthesized_english(translated_raw, placeholders)
                    translated = _preserve_special_chars(value, translated, cur_path, counters)
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
    failed_paths: Set[str] | None = None,
    prefix: str = "",
) -> Dict[str, Any]:
    """Übersetze alle Schlüssel aus base_dict neu in die Zielsprache.
    Für Keys, die auf '.original' enden, wird niemals übersetzt; sie werden aus der Basis kopiert.
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
                failed_paths,
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
                    # bestehenden Wert behalten
                    target_dict[key] = existing_val
            else:
                # Bestehende Übersetzungen nur überschreiben, wenn erzwungen
                if existing_val is None or cur_path in forced_paths:
                    protected, placeholders = protect_parenthesized_english(value if isinstance(value, str) else "")
                    translated_raw = translate_text(protected, lang, provider, openai_key, deepl_key)
                    if translated_raw is None:
                        if failed_paths is not None:
                            failed_paths.add(cur_path)
                        target_dict[key] = existing_val if existing_val is not None else value
                    else:
                        translated = restore_parenthesized_english(translated_raw, placeholders)
                        translated = _preserve_special_chars(value, translated, cur_path, counters)
                        target_dict[key] = translated
                else:
                    target_dict[key] = existing_val
    return target_dict


def prune_extra_keys(base_dict: Dict[str, Any], target_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Entfernt Keys aus target_dict, die in base_dict nicht existieren (rekursiv)."""
    pruned: Dict[str, Any] = {}
    for key, base_val in base_dict.items():
        if key not in target_dict:
            continue
        tgt_val = target_dict[key]
        if isinstance(base_val, dict) and isinstance(tgt_val, dict):
            pruned[key] = prune_extra_keys(base_val, tgt_val)
        else:
            pruned[key] = tgt_val
    return pruned


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
            "Aktualisiert Sprachdateien auf Basis der Namespace-Struktur.\n"
            "Standard: de/<ns>.json → en/<ns>.json → andere/<ns>.json (inkrementell: nur fehlende/ geänderte Keys laut Hash-Manifest).\n"
            "\n"
            "Optionen:\n"
            "  --force-key <pfad>   Erzwingt Neuübersetzung einzelner Schlüssel (dot-Pfade).\n"
            "                       Mehrfach nutzbar oder komma-separiert.\n"
            "                       Beispiele: feedback.title  |  menu.feedback  |  feedback\n"
            "  --full               Vollständiger Lauf: alle Schlüssel neu übersetzen (langsamer/teurer).\n"
            "  --legacy-root        Verarbeite die alte Legacy-Struktur (de.json). Nicht empfohlen.\n"
            "\n"
            "Beispiele:\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --force-key feedback.title --force-key menu.feedback\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --full\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --legacy-root\n"
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
    parser.add_argument(
        "--prune-extra",
        action="store_true",
        help="Entfernt Keys in Zielsprachen, die in der Basis nicht mehr existieren (rekursiv).",
    )
    parser.add_argument(
        "--namespaced-only",
        action="store_true",
        help="[veraltet] Namespaces verarbeiten. Standard ist bereits Namespaces; für Legacy de.json siehe --legacy-root.",
    )
    parser.add_argument(
        "--legacy-root",
        action="store_true",
        help="Verarbeite die alte Legacy-Struktur (de.json). Standard ist Namespaces de/<ns>.json → en → andere.",
    )
    # Wenn ohne Argumente aufgerufen: vollständige Hilfe zeigen und beenden
    if len(sys.argv) == 1:
        parser.print_help()
        print("\nHinweis: --provider ist erforderlich (openai|deepl). Beispiele siehe oben.")
        return

    args = parser.parse_args()

    base_path = args.base_path
    provider = args.provider
    # --full schaltet bewusst in den Voll-Lauf; ohne Flag wird inkrementell (nur neue/geänderte Keys laut Hash) gearbeitet.
    do_full = bool(args.full)
    force_keys_raw = args.force_keys or []
    do_prune = bool(args.prune_extra)

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
        print(f"INFO: DeepL endpoint: {(os.getenv('DEEPL_API_URL') or 'https://api-free.deepl.com/v2/translate')}")

    # Standard: Namespaces verarbeiten (de/<ns>.json → en/<ns>.json → andere/<ns>.json)
    if not args.legacy_root:
        de_ns_dir = os.path.join(base_path, BASE_LANG)
        if not os.path.isdir(de_ns_dir):
            print(f"❌ Namespace-Verzeichnis fehlt: {de_ns_dir}")
            return

        # Learn-Sync: lessons.json → de/learn.json (nur fehlende Keys ergänzen)
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
                de_learn_file = os.path.join(de_ns_dir, "learn.json")
                existing_learn = load_json(de_learn_file)
                next_learn = json.loads(json.dumps(existing_learn)) if existing_learn else {}
                diffs_ns_de: list[str] = []
                deep_merge_missing(next_learn, learn_from_lessons, diffs_ns_de)
                if json.dumps(existing_learn, ensure_ascii=False, sort_keys=True) != json.dumps(next_learn, ensure_ascii=False, sort_keys=True):
                    os.makedirs(os.path.dirname(de_learn_file), exist_ok=True)
                    save_json(de_learn_file, next_learn)
                if diffs_ns_de:
                    print(f"INFO: de/learn.json ergänzt. Abweichende bestehende Werte nicht überschrieben: {len(diffs_ns_de)}")
            else:
                print("INFO: Keine gültige lessons.json-Liste gefunden; Überspringe Learn-Sync.")
        except Exception as e:
            print(f"INFO: Learn-Sync (de/learn.json) übersprungen: {e}")

        # API-Keys aus Umgebungsvariablen lesen (bereits oben geprüft, hier nur Variablen verwenden)
        openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
        deepl_key = os.getenv("DEEPL_API_KEY") or os.getenv("DEEPL_AUTH_KEY")
        counters: Dict[str, int] = {"skippedOriginalKeysCount": 0, "copiedOriginalKeysCount": 0}

        # Force-Keys einsammeln (dot-Pfade, können Subtrees sein)
        force_keys_raw = args.force_keys or []
        forced_list: list[str] = []
        for raw in force_keys_raw:
            forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])

        ns_files = [f for f in os.listdir(de_ns_dir) if f.endswith('.json')]
        if not ns_files:
            print(f"INFO: Keine Namespaces in {de_ns_dir} gefunden. Nichts zu tun.")
            return

        for ns_file in sorted(ns_files):
            ns_name = ns_file[:-5]
            ns_base_path = os.path.join(de_ns_dir, ns_file)
            ns_base = load_json(ns_base_path)
            if not isinstance(ns_base, dict):
                print(f"INFO: Überspringe ungültigen Namespace {ns_name} ({ns_file})")
                continue

            print(f"\n🧩 Namespace '{ns_name}':")

            # Force-Keys für diesen Namespace
            forced_paths = expand_forced_paths(ns_base, forced_list) if forced_list else set()

            # Phase A: de -> en (hash-basiert)
            try:
                en_dir = os.path.join(base_path, "en")
                os.makedirs(en_dir, exist_ok=True)
                en_out = os.path.join(en_dir, f"{ns_name}.json")
                en_existing = load_json(en_out)
                failed_paths_en: Set[str] = set()

                # Flatten DE-NS (relativ) und bilde Präfix für Manifest
                de_flat_rel = _flatten_dict(ns_base, prefix="")
                de_flat_pref = {f"{ns_name}.{k}": v for k, v in de_flat_rel.items()}
                man_en = _load_manifest("en", "de")

                # Inkrementell: nur Keys mit geändertem Hash (oder erzwungene) übersetzen; Full-Lauf übersetzt alles.
                if do_full:
                    changed_rel = set(de_flat_rel.keys())
                else:
                    changed_rel = set(
                        k for k, v in de_flat_rel.items()
                        if man_en.get(f"{ns_name}.{k}") != _sha256(str(v))
                    )
                    changed_rel |= forced_paths

                if do_full:
                    en_translated = translate_full(
                        ns_base,
                        "en",
                        provider,
                        openai_key,
                        deepl_key,
                        target_existing={},
                        forced_paths=forced_paths,
                        counters=counters,
                        failed_paths=failed_paths_en,
                    )
                else:
                    en_translated = merge_keys_missing_or_changed(
                        ns_base,
                        en_existing,
                        "en",
                        provider,
                        openai_key,
                        deepl_key,
                        changed_paths=changed_rel,
                        forced_paths=forced_paths,
                        counters=counters,
                        failed_paths=failed_paths_en,
                    )
                if do_prune:
                    en_translated = prune_extra_keys(ns_base, en_translated)
                save_json(en_out, en_translated)
                print(f"   → en/{ns_name}.json aktualisiert")

                # Manifest aktualisieren (EN from DE)
                for k, v in de_flat_pref.items():
                    rel = k.split(f"{ns_name}.", 1)[-1]
                    if rel in failed_paths_en:
                        continue
                    man_en[k] = _sha256(str(v))
                _save_manifest("en", "de", man_en)
            except Exception as e:
                print(f"❌ Abbruch für Sprache en / Namespace {ns_name}: {e}")
                continue

            # Phase B: en -> andere (hash-basiert, Pivot EN-NS)
            en_ns = load_json(en_out) or {}
            en_flat_rel = _flatten_dict(en_ns, prefix="")
            en_flat_pref = {f"{ns_name}.{k}": v for k, v in en_flat_rel.items()}

            for lang in TARGET_LANGS:
                if lang == "en":
                    continue
                try:
                    out_dir = os.path.join(base_path, lang)
                    os.makedirs(out_dir, exist_ok=True)
                    out_file = os.path.join(out_dir, f"{ns_name}.json")
                    existing = load_json(out_file)
                    failed_paths_lang: Set[str] = set()

                    man_lang = _load_manifest(lang, "en")

                    if do_full:
                        changed_rel_lang = set(en_flat_rel.keys())
                    else:
                        changed_rel_lang = set(
                            k for k, v in en_flat_rel.items()
                            if man_lang.get(f"{ns_name}.{k}") != _sha256(str(v))
                        )
                        changed_rel_lang |= forced_paths

                    if do_full:
                        translated = translate_full(
                            en_ns,
                            lang,
                            provider,
                            openai_key,
                            deepl_key,
                            target_existing={},
                            forced_paths=set(),
                            counters=counters,
                            failed_paths=failed_paths_lang,
                        )
                    else:
                        translated = merge_keys_missing_or_changed(
                            en_ns,
                            existing,
                            lang,
                            provider,
                            openai_key,
                            deepl_key,
                            changed_paths=changed_rel_lang,
                            forced_paths=forced_paths,
                            counters=counters,
                            failed_paths=failed_paths_lang,
                        )
                    if do_prune:
                        translated = prune_extra_keys(en_ns, translated)
                    save_json(out_file, translated)
                    print(f"   → {lang}/{ns_name}.json aktualisiert")

                    # Manifest aktualisieren (lang from EN)
                    for k, v in en_flat_pref.items():
                        rel = k.split(f"{ns_name}.", 1)[-1]
                        if rel in failed_paths_lang:
                            continue
                        man_lang[k] = _sha256(str(v))
                    _save_manifest(lang, "en", man_lang)
                except Exception as e:
                    print(f"❌ Abbruch für Sprache {lang} / Namespace {ns_name}: {e}")
                    continue

        print(f"\nZusammenfassung Namespaces: {{'skippedOriginalKeysCount': {counters.get('skippedOriginalKeysCount', 0)}, 'copiedOriginalKeysCount': {counters.get('copiedOriginalKeysCount', 0)}}}")
        print("\n✅ Namespaced-Verarbeitung abgeschlossen.")
        return

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
                print(f"INFO: de.json um fehlende learn.*-Keys aus lessons.json ergänzt ({len(diffs_learn_de)} Konflikte ohne Überschreiben)")
            if diffs_learn_de:
                for p in diffs_learn_de:
                    print(f"   ~ Bestehender Wert abweichend, nicht überschrieben: {p}")
        else:
            print("INFO: Keine gültige lessons.json-Liste gefunden; Überspringe Learn-Sync.")
    except Exception as e:
        print(f"INFO: Learn-Sync übersprungen (Fehler): {e}")

    # 2) Spiegel-Datei für de/learn.json erstellen/aktualisieren (nur fehlende Keys ergänzen)
    try:
        de_ns_file = f"{base_path}/{BASE_LANG}/learn.json"
        existing = load_json(de_ns_file)
        next_obj = json.loads(json.dumps(existing)) if existing else {}
        diffs_ns_de: list[str] = []
        learn_any = base_dict.get("learn")
        learn_subtree: Dict[str, Any] = learn_any if isinstance(learn_any, dict) else {}
        deep_merge_missing(next_obj, learn_subtree, diffs_ns_de)
        if json.dumps(existing, ensure_ascii=False, sort_keys=True) != json.dumps(next_obj, ensure_ascii=False, sort_keys=True):
            save_json(de_ns_file, next_obj)
        if diffs_ns_de:
            print(f"INFO: de/learn.json ergänzt. Abweichende bestehende Werte nicht überschrieben: {len(diffs_ns_de)}")
    except Exception as e:
        print(f"INFO: Spiegel-Erstellung de/learn.json übersprungen (Fehler): {e}")

    # Hash-basierte Trigger auch im Legacy-Root-Modus verwenden

    # Erzwungene Keys (per Argument)
    forced_list: list[str] = []
    for raw in force_keys_raw:
        forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])
    forced_paths: Set[str] = expand_forced_paths(base_dict, forced_list) if forced_list else set()

    # Zähler für Original-Keys
    counters: Dict[str, int] = {"skippedOriginalKeysCount": 0, "copiedOriginalKeysCount": 0}

    # Phase A (Legacy): DE → EN anhand Hash-Manifest
    en_path = f"{base_path}/en.json"
    en_existing = load_json(en_path) if os.path.exists(en_path) else {}
    de_flat = _flatten_dict(base_dict)
    man_en = _load_manifest("en", "de")
    failed_paths_en: Set[str] = set()

    if do_full:
        changed_paths_en = set(de_flat.keys())
    else:
        changed_paths_en = set(k for k, v in de_flat.items() if man_en.get(k) != _sha256(str(v))) | forced_paths

    try:
        if not do_full and not os.path.exists(en_path):
            print(f"⚠️ Datei fehlt: {en_path}. Erstelle neue Datei mit allen Übersetzungen.")
            en_translated = translate_full(
                base_dict,
                "en",
                provider,
                openai_key,
                deepl_key,
                target_existing={},
                forced_paths=forced_paths,
                counters=counters,
                failed_paths=failed_paths_en,
            )
        else:
            if do_full:
                en_translated = translate_full(
                    base_dict,
                    "en",
                    provider,
                    openai_key,
                    deepl_key,
                    target_existing={},
                    forced_paths=forced_paths,
                    counters=counters,
                    failed_paths=failed_paths_en,
                )
            else:
                en_translated = merge_keys_missing_or_changed(
                    base_dict,
                    en_existing,
                    "en",
                    provider,
                    openai_key,
                    deepl_key,
                    changed_paths=changed_paths_en,
                    forced_paths=forced_paths,
                    counters=counters,
                    failed_paths=failed_paths_en,
                )
        if do_prune:
            en_translated = prune_extra_keys(base_dict, en_translated)
        save_json(en_path, en_translated)
        # Manifest aktualisieren (EN from DE)
        for k, v in de_flat.items():
            if k in failed_paths_en:
                continue
            man_en[k] = _sha256(str(v))
        _save_manifest("en", "de", man_en)
    except Exception as e:
        print(f"❌ Abbruch für Sprache en (legacy): {e}")

    # Phase B (Legacy): EN → andere anhand Hash-Manifest
    en_flat_after = _flatten_dict(load_json(en_path) or {})

    for lang in TARGET_LANGS:
        if lang == "en":
            continue
        out_path = f"{base_path}/{lang}.json"
        existing = load_json(out_path) if os.path.exists(out_path) else {}
        man_lang = _load_manifest(lang, "en")
        failed_paths_lang: Set[str] = set()

    if do_full:
        changed_paths_lang = set(en_flat_after.keys())
    else:
        changed_paths_lang = set(k for k, v in en_flat_after.items() if man_lang.get(k) != _sha256(str(v)))
        changed_paths_lang |= forced_paths

        try:
            if not do_full and not os.path.exists(out_path):
                print(f"⚠️ Datei fehlt: {out_path}. Erstelle neue Datei mit allen Übersetzungen.")
                translated = translate_full(
                    load_json(en_path) or {},
                    lang,
                    provider,
                    openai_key,
                    deepl_key,
                    target_existing={},
                    forced_paths=set(),
                    counters=counters,
                    failed_paths=failed_paths_lang,
                )
            else:
                if do_full:
                    translated = translate_full(
                        load_json(en_path) or {},
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        target_existing={},
                        forced_paths=set(),
                        counters=counters,
                        failed_paths=failed_paths_lang,
                    )
                else:
                    translated = merge_keys_missing_or_changed(
                        load_json(en_path) or {},
                        existing,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        changed_paths=changed_paths_lang,
                        forced_paths=set(),
                        counters=counters,
                        failed_paths=failed_paths_lang,
                    )
            if do_prune:
                translated = prune_extra_keys(load_json(en_path) or {}, translated)
            save_json(out_path, translated)
            # Manifest aktualisieren (lang from EN)
            for k, v in en_flat_after.items():
                if k in failed_paths_lang:
                    continue
                man_lang[k] = _sha256(str(v))
            _save_manifest(lang, "en", man_lang)
        except Exception as e:
            print(f"❌ Abbruch für Sprache {lang} (legacy): {e}")

    print(f"\nZusammenfassung: {{'skippedOriginalKeysCount': {counters.get('skippedOriginalKeysCount', 0)}, 'copiedOriginalKeysCount': {counters.get('copiedOriginalKeysCount', 0)}}}")
    print("\n✅ Alle Sprachdateien aktualisiert.")


if __name__ == "__main__":
    main()

# Mini-Selbsttest (gedanklich):
# Input: "Mehrfachsignatur (Multi-Signature) schützt dein Konto."
# Erwartung nach protect_parenthesized_english: "Mehrfachsignatur (__KEEP_EN_TERM_1__) schützt dein Konto."
# Erwartung nach restore_parenthesized_english: Klammerteil bleibt exakt "Multi-Signature".
