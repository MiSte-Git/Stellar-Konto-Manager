# update_translations.py
import os, json, time, re
from typing import Any, Dict, Tuple
from openai import OpenAI

# -----------------------------
# Konfiguration
# -----------------------------
BASE_LANG = "de"
PIVOT_LANG = "en"   # zuerst DE -> EN (Pivot), dann EN -> andere
TARGET_LANGS = ["nl", "es", "fr", "it", "fi", "hr", "ru"]
BASE_PATH = "."     # Pfad zu deinen JSONs
MODEL = "gpt-4"     # passt gern an; temperature niedrig für Konsistenz
TEMP = 0.2
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 2.0

# -----------------------------
# OpenAI Client
# -----------------------------
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("Bitte setze OPENAI_API_KEY in der Umgebung.")
client = OpenAI(api_key=api_key)

# -----------------------------
# Utils
# -----------------------------
PLACEHOLDER_PATTERN = re.compile(r"(\{\{[^{}]+\}\})")
HTML_TAG_PATTERN = re.compile(r"(</?[\w\-]+(?:\s+[^>]*?)?>)")
# Wir schützen placeholders/tags mit Token, damit sie unangetastet bleiben
def protect_tokens(s: str) -> Tuple[str, Dict[str, str]]:
    idx = 0
    mapping = {}

    def _substitute(pattern, text):
        nonlocal idx, mapping
        def _repl(m):
            nonlocal idx, mapping
            token = f"@@TOKEN_{idx}@@"
            mapping[token] = m.group(0)
            idx += 1
            return token
        return pattern.sub(_repl, text)

    s2 = _substitute(PLACEHOLDER_PATTERN, s)
    s3 = _substitute(HTML_TAG_PATTERN, s2)
    return s3, mapping

def restore_tokens(s: str, mapping: Dict[str, str]) -> str:
    for token, original in mapping.items():
        s = s.replace(token, original)
    return s

def load_json(path: str) -> Dict[str, Any]:
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: str, data: Dict[str, Any]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# Cache: {(text, src, tgt): translation}
_memory_cache: Dict[Tuple[str, str, str], str] = {}

def _translate(text: str, source_lang: str, target_lang: str) -> str:
    """
    Übersetzt einen einzelnen UI-String mit Schutz von {{placeholders}} und HTML-Tags.
    """
    if not isinstance(text, str):
        return text

    key = (text, source_lang, target_lang)
    if key in _memory_cache:
        return _memory_cache[key]

    protected, mapping = protect_tokens(text)

    sys_prompt = (
        "You are a professional UI/localization translator. "
        "Translate the user's text from {src} to {tgt} for software UI.\n"
        "- KEEP ICU placeholders unchanged (e.g., {{amount}}, {{name}})\n"
        "- KEEP HTML tags unchanged (e.g., <b>, <i>, <br/>)\n"
        "- Preserve punctuation and capitalization style\n"
        "- Return ONLY the translated text, no quotes, no explanations."
    ).format(src=source_lang, tgt=target_lang)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=TEMP,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": protected},
                ],
            )
            out = resp.choices[0].message.content.strip()
            out = restore_tokens(out, mapping)
            _memory_cache[key] = out
            return out
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            time.sleep(RETRY_BACKOFF_SEC * attempt)

def merge_translate(
    base_dict: Dict[str, Any],
    existing: Dict[str, Any],
    source_lang: str,
    target_lang: str,
) -> Dict[str, Any]:
    """
    Geht rekursiv durch base_dict und füllt fehlende Keys in existing
    mit Übersetzungen von source_lang -> target_lang.
    Keys bleiben unverändert, nur string-Werte werden übersetzt.
    """
    out = dict(existing) if isinstance(existing, dict) else {}
    for k, v in base_dict.items():
        if isinstance(v, dict):
            out[k] = merge_translate(v, out.get(k, {}), source_lang, target_lang)
        else:
            if k in out:
                continue
            if isinstance(v, str):
                out[k] = _translate(v, source_lang, target_lang)
            else:
                out[k] = v
    return out

# -----------------------------
# Hauptlogik
# -----------------------------
if __name__ == "__main__":
    # 1) de.json laden
    de_path = os.path.join(BASE_PATH, f"{BASE_LANG}.json")
    de_dict = load_json(de_path)

    # 2) Pivot EN erzeugen/ergänzen: de -> en
    en_path = os.path.join(BASE_PATH, f"{PIVOT_LANG}.json")
    en_existing = load_json(en_path)
    en_merged = merge_translate(de_dict, en_existing, source_lang="German", target_lang="English")
    save_json(en_path, en_merged)
    print(f"✅ {PIVOT_LANG}.json aktualisiert (Pivot aus {BASE_LANG}.json).")

    # 3) Alle weiteren Sprachen: EN -> Zielsprache
    for lang in TARGET_LANGS:
        path = os.path.join(BASE_PATH, f"{lang}.json")
        target_existing = load_json(path)

        # Wichtig: jetzt vom EN-Pivot übersetzen (bessere Qualität)
        merged = merge_translate(en_merged, target_existing, source_lang="English", target_lang=lang)
        save_json(path, merged)
        print(f"✅ {lang}.json aktualisiert (Pivot EN → {lang}).")

    print("🎉 Alle Sprachdateien sind synchronisiert.")
