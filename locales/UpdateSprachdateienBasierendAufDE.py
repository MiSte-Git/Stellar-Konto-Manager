import json, os
from openai import OpenAI

client = OpenAI(api_key="sk-proj-weLAXUPtBjREBQGYC7MZT3BlbkFJPQqYgKybvMfrLQGRWnfR")

base_file = "de.json"
languages = ["en", "nl", "es", "fr", "it", "fi", "hr", "ru"]

# Basisdatei laden
with open(base_file, "r", encoding="utf-8") as f:
    base_dict = json.load(f)

# Übersetzungsfunktion
def translate_text(text, target_lang):
    print(f"🌍 Übersetze '{text}' → {target_lang} …")
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{
            "role": "system",
            "content": f"Übersetze die folgenden UI-Texte präzise ins {target_lang}. Gib nur den übersetzten Text zurück, ohne Anführungszeichen oder Formatierung."
        }, {
            "role": "user",
            "content": text
        }],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()

# Merge und Erstellen
def merge_keys(base, existing, lang):
    updated = {}
    for key, value in base.items():
        if key in existing:
            updated[key] = existing[key]
        else:
            updated[key] = translate_text(value, lang)
    return updated

# Für alle Zielsprachen
for lang in languages:
    path = f"{lang}.json"
    print(f"🔁 {lang} ergänzen…")

    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        print(f"📁 {lang}.json nicht gefunden. Wird erstellt.")
        data = {}

    merged = merge_keys(base_dict, data, lang)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        print(f"✅ {lang}.json aktualisiert.\n")

BASE_LANG = "de"
TARGET_LANGS = ["en", "nl", "es", "fr", "it", "fi", "hr", "ru"]

def load_json(file):
    with open(file, encoding="utf-8") as f:
        return json.load(f)

def save_json(file, data):
    with open(file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def translate_text(text, target_lang):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": f"Übersetze den folgenden Text ins {target_lang}"},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content.strip()

def merge_keys(base_dict, target_dict, lang):
    for key, value in base_dict.items():
        if isinstance(value, dict):
            target_dict[key] = merge_keys(value, target_dict.get(key, {}), lang)
        elif key not in target_dict:
            translated = translate_text(value, lang)
            target_dict[key] = translated
    return target_dict

#base_path = "."
base_path = "."
base_dict = load_json(f"{base_path}/{BASE_LANG}.json")
print(f"Inhalt der Basis Datei: base_dict")

for lang in TARGET_LANGS:
    path = f"{base_path}/{lang}.json"
    if not os.path.exists(path):
        print(f"⚠️ Datei fehlt: {path} und wird erstellt")
        open(path, "w").close()
    data = load_json(path)
    print(f"🔁 {lang} ergänzen…")
    merged = merge_keys(base_dict, data, lang)
    save_json(path, merged)

print("✅ Alle Sprachdateien aktualisiert.")

