import json
import os
import argparse
from typing import Dict, Any

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


def merge_keys_missing(
    base_dict: Dict[str, Any],
    target_dict: Dict[str, Any],
    lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
) -> Dict[str, Any]:
    """Füge nur fehlende Schlüssel aus base_dict zu target_dict hinzu und übersetze sie."""
    for key, value in base_dict.items():
        if isinstance(value, dict):
            target_dict[key] = merge_keys_missing(
                value, target_dict.get(key, {}), lang, provider, openai_key, deepl_key
            )
        elif key not in target_dict:
            translated = translate_text(value, lang, provider, openai_key, deepl_key)
            target_dict[key] = translated
    return target_dict


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
    parser = argparse.ArgumentParser(description="Übersetze Sprachdateien basierend auf de.json")
    parser.add_argument(
        "--mode",
        choices=["missing", "full"],
        default="missing",
        help="Modus: 'missing' (nur fehlende Einträge übersetzen) oder 'full' (alle neu übersetzen)",
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
    args = parser.parse_args()

    base_path = args.base_path
    provider = args.provider

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

    # Verarbeite jede Zielsprache
    for lang in TARGET_LANGS:
        path = f"{base_path}/{lang}.json"
        print(f"\n🔁 Verarbeite {lang} im Modus '{args.mode}' mit Provider '{provider}'...")
        try:
            if args.mode == "missing":
                if not os.path.exists(path):
                    print(f"⚠️ Datei fehlt: {path}. Erstelle neue Datei mit allen Übersetzungen.")
                    translated_dict = translate_full(base_dict, lang, provider, openai_key, deepl_key)
                else:
                    target_dict = load_json(path)
                    translated_dict = merge_keys_missing(
                        base_dict, target_dict, lang, provider, openai_key, deepl_key
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
