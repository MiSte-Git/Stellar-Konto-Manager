import os
import json
from openai import OpenAI

# 🔐 API-Client vorbereiten
client = OpenAI(api_key="sk-proj-weLAXUPtBjREBQGYC7MZT3BlbkFJPQqYgKybvMfrLQGRWnfR")  # <-- Deinen API-Key hier einfügen

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_LANG = "de"
BASE_FILE = os.path.join(SCRIPT_DIR, f"{BASE_LANG}.json")

def load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        content = f.read().strip()
        return json.loads(content) if content else {}

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def translate_text(text, target_lang):
    print(f"🌍 Übersetze → {target_lang}: {text[:60]}...")
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": f"Übersetze den folgenden UI-Text möglichst präzise ins {target_lang}. Gib nur den übersetzten Text zurück, ohne Anführungszeichen oder Formatierung."
            },
            {"role": "user", "content": text}
        ],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()

def merge_translations(base_dict, target_dict, lang):
    for key, base_value in base_dict.items():
        if isinstance(base_value, dict):
            target_sub = target_dict.get(key, {})
            target_dict[key] = merge_translations(base_value, target_sub, lang)
        else:
            if key not in target_dict or not target_dict[key]:
                target_dict[key] = translate_text(base_value, lang)
    return target_dict

# 🧩 Lade Basisdatei (de.json)
print(f"📁 Lade {BASE_FILE}")
base_dict = load_json(BASE_FILE)

# 🔍 Alle Zielsprachen automatisch erkennen
all_files = os.listdir(SCRIPT_DIR)
target_langs = [
    f.replace(".json", "") for f in all_files
    if f.endswith(".json") and f != f"{BASE_LANG}.json"
]

# 🔁 Verarbeite alle Zielsprachen
for lang in target_langs:
    lang_path = os.path.join(SCRIPT_DIR, f"{lang}.json")
    print(f"\n🔁 Sprache {lang} wird bearbeitet…")

    target_dict = load_json(lang_path)
    updated = merge_translations(base_dict, target_dict, lang)
    save_json(lang_path, updated)

    print(f"✅ {lang}.json wurde aktualisiert.")

print("\n🎉 Alle Sprachdateien sind auf dem neuesten Stand.")
