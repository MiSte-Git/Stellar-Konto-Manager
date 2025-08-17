# 🔐 API-Client vorbereiten
"""
Dieses Skript nutzt den OpenAI API-Key aus einer Umgebungsvariablen,
um zu vermeiden, dass der Key im Code hinterlegt wird.

🔹 Umgebungsvariable setzen:

Linux / macOS (Bash/Zsh):
    export OPENAI_API_KEY="dein_api_key_hier"
    python3 dein_script.py

Dauerhaft unter Linux/macOS:
    In ~/.bashrc oder ~/.zshrc einfügen:
        export OPENAI_API_KEY="dein_api_key_hier"
    Danach:
        source ~/.bashrc   # oder ~/.zshrc

Windows (PowerShell, temporär):
    $env:OPENAI_API_KEY="dein_api_key_hier"
    python .\dein_script.py

Windows (dauerhaft):
    Systemsteuerung → „Umgebungsvariablen für mein Konto“ →
    Benutzervariablen → Neu:
        Name: OPENAI_API_KEY
        Wert: dein_api_key_hier
    Terminal neu starten.

Prüfen:
    echo $OPENAI_API_KEY         # Linux/macOS
    echo $env:OPENAI_API_KEY     # Windows PowerShell
"""
import os
import json
from openai import OpenAI
from copy import deepcopy

# 🔐 OpenAI-Client initialisieren (API-Key hier einsetzen oder via ENV)
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("❌ OPENAI_API_KEY ist nicht gesetzt. Bitte Umgebungsvariable anlegen.")
client = OpenAI(api_key=api_key)

# ⚙️ Grundkonfiguration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_LANG = "de"
BASE_FILE = os.path.join(SCRIPT_DIR, f"{BASE_LANG}.json")
EN_FILE = os.path.join(SCRIPT_DIR, "en.json")
DE_SNAPSHOT_FILE = os.path.join(SCRIPT_DIR, "de.snapshot.json")
REPORT_FILE = os.path.join(SCRIPT_DIR, "i18n_changes_report.json")

MODEL = "gpt-4o-mini"
TEMPERATURE = 0.2

# Hilfsfunktion: Rekursive Sortierung eines Dictionaries
def sort_dict_recursive(d):
    """Sortiert Dict rekursiv alphabetisch nach Keys."""
    if isinstance(d, dict):
        return {k: sort_dict_recursive(d[k]) for k in sorted(d)}
    return d

# ---------- Helper: IO ----------
def load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        s = f.read().strip()
        return json.loads(s) if s else {}

def save_json(path, data):
    """Speichert dict als JSON mit UTF-8 und Einrückung, alphabetisch sortiert."""
    data = sort_dict_recursive(data)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ---------- Helper: Dict flatten / set ----------
def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, p))
        else:
            out[p] = v
    return out

def set_by_path(d, path, value):
    parts = path.split(".")
    cur = d
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value

def get_by_path(d, path):
    cur = d
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur

# ---------- Übersetzung ----------
def translate_text(text, target_lang, source_lang):
    preview = text.replace("\n", " ")[:80]
    print(f"🌍 {source_lang.upper()} → {target_lang.upper()}: {preview}...")
    system_prompt = (
        f"Übersetze präzise vom {source_lang.upper()} ins {target_lang.upper()} für UI-Texte. "
        f"Bewahre Platzhalter/Variablen exakt ({{name}}, {{count}}, {{0}}, {{1}}, %s, %d, {{value}}). "
        f"Ändere keine Markdown/HTML-Tags oder Format-Token. "
        f"Gib NUR den übersetzten Text aus – ohne Anführungszeichen oder Zusatz."
    )
    resp = client.chat.completions.create(
        model=MODEL,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
    )
    return resp.choices[0].message.content.strip()

# ---------- Change Detection ----------
def compute_changed_keys(prev_de, curr_de):
    """
    Liefert:
      - new_keys: Keys, die es vorher nicht gab
      - changed_keys: Keys, deren Stringwert sich geändert hat
    Nur String-Leafs werden betrachtet (andere Typen werden ignoriert).
    """
    prev_flat = flatten(prev_de) if prev_de else {}
    curr_flat = flatten(curr_de) if curr_de else {}

    new_keys = []
    changed_keys = []

    for k, v in curr_flat.items():
        if isinstance(v, dict):
            continue
        if k not in prev_flat:
            new_keys.append(k)
        else:
            prev_v = prev_flat[k]
            if isinstance(prev_v, str) and isinstance(v, str):
                if prev_v != v:
                    changed_keys.append(k)
            # wenn Typ sich ändert, behandeln wie geändert:
            elif type(prev_v) != type(v):
                changed_keys.append(k)

    return new_keys, changed_keys

# ---------- Merge-Strategie ----------
def ensure_en_up_to_date(de_dict, en_dict, keys_to_update):
    """
    Übersetzt DE→EN für alle Keys in keys_to_update (dotted paths),
    setzt EN-Wert entsprechend. Existierendes EN bleibt sonst unverändert.
    """
    updated = deepcopy(en_dict)
    for path in keys_to_update:
        de_val = get_by_path(de_dict, path)
        if isinstance(de_val, str):
            en_val = translate_text(de_val, target_lang="en", source_lang="de")
            set_by_path(updated, path, en_val)
    return updated

def ensure_lang_from_en(en_dict, lang_dict, keys_to_update, lang_code):
    """
    Übersetzt EN→lang_code für alle Keys in keys_to_update (dotted paths),
    setzt Zielwert entsprechend. Existierendes bleibt sonst unverändert.
    """
    updated = deepcopy(lang_dict)
    for path in keys_to_update:
        en_val = get_by_path(en_dict, path)
        if isinstance(en_val, str):
            tr_val = translate_text(en_val, target_lang=lang_code, source_lang="en")
            set_by_path(updated, path, tr_val)
    return updated

# ============ MAIN ============
print(f"📁 Lade {BASE_FILE}")
de_dict = load_json(BASE_FILE)
de_dict = sort_dict_recursive(de_dict)  # 🔹 Alphabetisch sortieren
save_json(BASE_FILE, de_dict)           # 🔹 Sofort zurückspeichern
prev_de_snapshot = load_json(DE_SNAPSHOT_FILE)

# 1) Änderungen ermitteln
new_keys, changed_keys = compute_changed_keys(prev_de_snapshot, de_dict)
keys_to_update = sorted(set(new_keys + changed_keys))
print(f"🔎 Neue Keys: {len(new_keys)}, geänderte Keys: {len(changed_keys)}")

# 🧠 2) Erzeuge/Aktualisiere EN zuerst (DE → EN)
print("\n🔁 Aktualisiere Englisch (de → en)…")
en_exists_before = os.path.exists(EN_FILE)
en_dict_existing = load_json(EN_FILE)

# Welche EN-Keys sind aktuell leer/fehlend?
en_flat = flatten(en_dict_existing)
de_flat = flatten(de_dict)
missing_in_en = [k for k in de_flat.keys() if k not in en_flat or not isinstance(en_flat[k], str) or en_flat[k] == ""]

# EN-Update-Liste = fehlende_in_en ∪ keys_to_update
en_update_keys = sorted(set(missing_in_en).union(keys_to_update))

if not en_exists_before:
    print("🆕 en.json nicht gefunden – wird neu erstellt (vollständige Erstübersetzung).")

if en_update_keys:
    print(f"📝 Aktualisiere EN für {len(en_update_keys)} Keys …")
    en_dict_updated = ensure_en_up_to_date(de_dict, en_dict_existing, en_update_keys)
    save_json(EN_FILE, en_dict_updated)
else:
    en_dict_updated = en_dict_existing
    print("✅ en.json ist bereits vollständig & aktuell.")

# 3) Weitere Sprachen aus EN aktualisieren (nur neue/geänderte Keys ODER fehlende Keys)
all_files = [f for f in os.listdir(SCRIPT_DIR) if f.endswith(".json")]
target_langs = [
    f.replace(".json", "")
    for f in all_files
    if f not in (
        f"{BASE_LANG}.json", 
        "en.json", 
        os.path.basename(DE_SNAPSHOT_FILE), 
        os.path.basename(REPORT_FILE) # Bericht ausschließen
    )  
]

report = {
    "new_keys": new_keys,
    "changed_keys": changed_keys,
    "per_language": {}
}

for lang in target_langs:
    lang_path = os.path.join(SCRIPT_DIR, f"{lang}.json")
    lang_exists_before = os.path.exists(lang_path)

    print(f"\n🔁 Sprache {lang}: prüfe fehlende & geänderte Keys …")
    lang_dict = load_json(lang_path)
    lang_flat = flatten(lang_dict)

    # fehlende in lang
    missing_in_lang = [
        k for k in de_flat.keys() 
        if k not in lang_flat 
            or not isinstance(lang_flat[k], str) 
            or lang_flat[k] == ""
    
    ]

     # 🔹 Debug-Ausgabe der fehlenden Keys
    if missing_in_lang:
        print(f"⚠️ {lang}: {len(missing_in_lang)} Keys fehlen:")
        for k in missing_in_lang:
            print(f"   - {k}")
            
    # Update-Liste = fehlende ∪ geänderte
    lang_update_keys = sorted(set(missing_in_lang).union(keys_to_update))

    if not lang_exists_before:
        print(f"🆕 {lang}.json nicht gefunden – wird neu erstellt (vollständige Erstübersetzung).")

    if lang_update_keys:
        print(f"📝 Aktualisiere {lang} für {len(lang_update_keys)} Keys …")
        lang_updated = ensure_lang_from_en(en_dict_updated, lang_dict, lang_update_keys, lang)
        save_json(lang_path, lang_updated)
    else:
        print(f"✅ {lang}.json ist bereits vollständig & aktuell.")

    report["per_language"][lang] = {
        "missing_now_filled": [k for k in missing_in_lang if k in lang_update_keys],
        "updated_due_to_de_change": [k for k in changed_keys if k in lang_update_keys]
    }

# 4) Report speichern & neuen Snapshot schreiben
save_json(REPORT_FILE, report)
save_json(DE_SNAPSHOT_FILE, de_dict)

print("\n📄 Änderungsreport geschrieben:", os.path.basename(REPORT_FILE))
print("📌 DE-Snapshot aktualisiert:", os.path.basename(DE_SNAPSHOT_FILE))
print("🎉 Fertig: Nur neue/geänderte Keys wurden neu übersetzt (DE→EN→andere).")
