import json
import os
import argparse
from argparse import RawTextHelpFormatter
import subprocess
import sys
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


def _diff_changed_paths(old: Dict[str, Any], new: Dict[str, Any], prefix: str = "") -> Set[str]:
    changed: Set[str] = set()
    # Keys added or changed
    for k, v_new in new.items():
        p = f"{prefix}.{k}" if prefix else k
        if k not in old:
            # Alle Blätter unter k neu
            if isinstance(v_new, dict):
                changed |= _collect_leaf_paths(v_new, p)
            else:
                changed.add(p)
        else:
            v_old = old[k]
            if isinstance(v_new, dict) and isinstance(v_old, dict):
                changed |= _diff_changed_paths(v_old, v_new, p)
            elif v_new != v_old:
                # Wert geändert
                changed.add(p)
    # Entfernte Keys ignorieren (für Übersetzung irrelevant)
    return changed


def compute_changed_paths_with_git(base_file: str) -> Set[str]:
    """Vergleicht de.json gegen HEAD-Version und liefert geänderte/neue Leaf-Pfade.
    Fällt bei fehlendem Git oder fehlender HEAD-Version auf leere Menge zurück.
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
            return set()
        old_dict = json.loads(res.stdout)
        new_dict = load_json(base_file)
        if not isinstance(old_dict, dict) or not isinstance(new_dict, dict):
            return set()
        return _diff_changed_paths(old_dict, new_dict)
    except Exception as e:
        print(f"ℹ️ Git-Diff für {base_file} nicht verfügbar: {e}")
        return set()


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
    prefix: str = "",
) -> Dict[str, Any]:
    """Füge fehlende Schlüssel hinzu ODER aktualisiere gezielt geänderte Leaf-Pfade aus de.json.
    - Wenn ein Pfad in changed_paths liegt, wird er neu übersetzt (überschreibt bestehende Werte).
    - Fehlende Keys werden wie zuvor ergänzt.
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
                cur_path,
            )
        else:
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
) -> Dict[str, Any]:
    """Übersetze alle Schlüssel aus base_dict neu in die Zielsprache."""
    target_dict = {}
    for key, value in base_dict.items():
        if isinstance(value, dict):
            target_dict[key] = translate_full(value, lang, provider, openai_key, deepl_key)
        else:
            translated = translate_text(value, lang, provider, openai_key, deepl_key)
            target_dict[key] = translated
    return target_dict


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

    # Ermittele gezielt geänderte Leaf-Pfade gegenüber HEAD
    changed_paths = compute_changed_paths_with_git(base_file)
    if changed_paths:
        print(f"ℹ️ Geänderte Schlüssel in {BASE_LANG}.json seit HEAD: {len(changed_paths)}")
        for p in sorted(changed_paths):
            print(f"   • {p}")

    # Erzwungene Keys (per Argument) zur Änderungsmenge hinzufügen
    forced_list: list[str] = []
    for raw in force_keys_raw:
        forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])
    if forced_list:
        forced_paths = expand_forced_paths(base_dict, forced_list)
        if forced_paths:
            print(f"ℹ️ Erzwungene Schlüssel (Neuübersetzung): {len(forced_paths)}")
            for p in sorted(forced_paths):
                print(f"   • {p}")
            changed_paths |= forced_paths

    # Verarbeite jede Zielsprache
    for lang in TARGET_LANGS:
        path = f"{base_path}/{lang}.json"
        print(f"\n🔁 Verarbeite {lang} im Modus '{'full' if do_full else 'missing+changed'}' mit Provider '{provider}'...")
        try:
            if not do_full:
                if not os.path.exists(path):
                    print(f"⚠️ Datei fehlt: {path}. Erstelle neue Datei mit allen Übersetzungen.")
                    translated_dict = translate_full(base_dict, lang, provider, openai_key, deepl_key)
                else:
                    target_dict = load_json(path)
                    translated_dict = merge_keys_missing_or_changed(
                        base_dict,
                        target_dict,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        changed_paths,
                    )
            else:
                translated_dict = translate_full(base_dict, lang, provider, openai_key, deepl_key)

            save_json(path, translated_dict)
        except Exception as e:
            print(f"❌ Abbruch für Sprache {lang}: {e}")
            continue

    print("\n✅ Alle Sprachdateien aktualisiert.")


if __name__ == "__main__":
    main()
