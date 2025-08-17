#!/usr/bin/env python3
import os, re, json, sys, time
from typing import Dict, Set, List, Tuple

# ==== KONFIG ====
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LOCALES_DIR = os.path.join(PROJECT_ROOT, "frontend")
DE_FILE = os.path.join(LOCALES_DIR, "src/locales/de.json")

SRC_ROOT = os.path.join(PROJECT_ROOT, "frontend")

# Dynamische Präfixe, die bewusst zur Laufzeit ergänzt werden (werden NICHT als missing gezählt)
DYNAMIC_PREFIX_WHITELIST = {
    "submitTransaction.failed:",
    "investedTokens.error.",   # falls ihr z. B. 'investedTokens.error.' + something nutzt
    "fetchInvestedTokens.failed:",
    # weitere Präfixe hier eintragen …
}

# Pfade/Ordner die wir ignorieren wollen
IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", ".vercel", ".cache",
    ".idea", ".vscode", ".venv", "__pycache__", "coverage"
}
# Dateiendungen, die wir prüfen
CODE_EXTS = {".js", ".jsx", ".ts", ".tsx"}

PRUNE_DE = "--prune-de" in sys.argv
PRUNE_ALL = "--prune-all" in sys.argv


# ==== Helper ====
def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def delete_path(d: dict, dotted: str) -> bool:
    """Löscht einen verschachtelten Key nach Pfad 'a.b.c'. Gibt True zurück, wenn er existierte."""
    parts = dotted.split(".")
    cur = d
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            return False
        cur = cur[p]
    return cur.pop(parts[-1], None) is not None

def prune_empty_dicts(d: dict):
    """Entfernt leere Objekte rekursiv."""
    if not isinstance(d, dict):
        return
    for k in list(d.keys()):
        if isinstance(d[k], dict):
            prune_empty_dicts(d[k])
            if not d[k]:
                del d[k]

def rel_frontend(path: str) -> str:
    """Gibt Pfad relativ zu .../frontend/ zurück."""
    try:
        return os.path.relpath(path, SRC_ROOT)
    except Exception:
        return path
    
def load_json(path: str) -> Dict:
    if not os.path.exists(path):
        print(f"❌ de.json nicht gefunden: {path}")
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        s = f.read().strip()
        return json.loads(s) if s else {}

def flatten_dict(d: Dict, prefix: str = "") -> Dict[str, str]:
    out = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten_dict(v, p))
        else:
            out[p] = v
    return out

def flatten_i18n(d, prefix=""):
    """
    Flattet ein verschachteltes JSON-Objekt zu punkt-getrennten Keys.
    - NUR String-Blätter werden gelistet (andere Typen ignorieren wir bewusst).
    - Dicts werden rekursiv aufgelöst.
    Ergebnis: dict { "a.b.c": "…", ... }
    """
    out = {}
    if not isinstance(d, dict):
        return out

    for k, v in d.items():
        # Schlüssel immer als String behandeln
        k = str(k)
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten_i18n(v, p))
        else:
            if isinstance(v, str):
                out[p] = v
            else:
                # Nicht-String-Blatt: optional melden/überspringen
                # print(f"⚠️ Ignoriere Nicht-String-Leaf in de.json: {p} ({type(v).__name__})")
                pass
    return out

def iter_code_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        # Ordner filtern
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fn in filenames:
            _, ext = os.path.splitext(fn)
            if ext.lower() in CODE_EXTS:
                yield os.path.join(dirpath, fn)

# Regexe für i18n-Keys:
#  - t('path.to.key'), t("path.to.key"), t(`path.to.key`)
#  - <Trans i18nKey="path.to.key">
#  - i18nKey={'path.to.key'} / i18nKey={`path.to.key`}
# t('...'), t("..."), t(`...`)
# erlaubt: foo, foo.bar, foo_bar, foo1.bar2 (mind. 2 Zeichen insgesamt)
VALID_KEY = r"[A-Za-z][A-Za-z0-9_.]{1,}"

RE_T_SINGLE = re.compile(rf"""(?<![A-Za-z0-9_])t\s*\(\s*'({VALID_KEY})'\s*\)""")
RE_T_DOUBLE = re.compile(rf"""(?<![A-Za-z0-9_])t\s*\(\s*"({VALID_KEY})"\s*\)""")
RE_T_BACK   = re.compile(rf"""(?<![A-Za-z0-9_])t\s*\(\s*`({VALID_KEY})`\s*\)""")

# i18nKey‑Attribute wie gehabt
RE_I18NKEY_DQ = re.compile(rf'''i18nKey\s*=\s*"({VALID_KEY})"''')
RE_I18NKEY_SQ = re.compile(rf"""i18nKey\s*=\s*'({VALID_KEY})'""")
RE_I18NKEY_BK = re.compile(rf"""i18nKey\s*=\s*`({VALID_KEY})`""")
RE_I18NKEY_JS = re.compile(rf'''i18nKey\s*=\s*\{{\s*["'`]({VALID_KEY})["'`]\s*\}}''')

# Dynamische Präfixe wie 'foo.bar:' + var
RE_DYNAMIC_PREFIX = re.compile(r"""['"]([A-Za-z0-9_.:-]+:)['"]\s*\+""")

def extract_keys_with_locations(path: str):
    """
    Findet Keys NUR in Zeilen mit i18n-Kontext und liefert:
      dict: key -> Liste[(datei, zeilennummer, zeileninhalt)]
    i18n-Kontext bedeutet: Zeile enthält 't(', 'i18nKey' oder '<Trans'.
    """
    key_locs = {}
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for lineno, line in enumerate(f, start=1):
                # ✅ Nur Zeilen mit echtem i18n-Kontext untersuchen
                if "t(" not in line and "i18nKey" not in line and "<Trans" not in line:
                    continue

                # t('...'), t("..."), t(`...`)
                for regex in (RE_T_SINGLE, RE_T_DOUBLE, RE_T_BACK):
                    for match in regex.findall(line):
                        k = normalize_key(match)
                        if k:
                            key_locs.setdefault(k, []).append((path, lineno, line.strip()))

                # i18nKey="...", i18nKey={'...'}, i18nKey={`...`}
                for regex in (RE_I18NKEY_DQ, RE_I18NKEY_SQ, RE_I18NKEY_BK, RE_I18NKEY_JS):
                    for match in regex.findall(line):
                        k = normalize_key(match)
                        if k:
                            key_locs.setdefault(k, []).append((path, lineno, line.strip()))
    except Exception as e:
        print(f"⚠️ Konnte Datei nicht lesen: {path} ({e})")

    return key_locs


def extract_keys_from_file(path: str) -> Tuple[Set[str], Set[str]]:
    used = set()
    dynamic = set()
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                # ✅ Nur Zeilen mit echtem i18n-Kontext untersuchen
                if "t(" not in line and "i18nKey" not in line and "<Trans" not in line:
                    continue

                for regex in (RE_T_SINGLE, RE_T_DOUBLE, RE_T_BACK):
                    used.update(regex.findall(line))
                for regex in (RE_I18NKEY_DQ, RE_I18NKEY_SQ, RE_I18NKEY_BK, RE_I18NKEY_JS):
                    used.update(regex.findall(line))
                dynamic.update(RE_DYNAMIC_PREFIX.findall(line))

    except Exception as e:
        print(f"⚠️ Konnte Datei nicht lesen: {path} ({e})")

    return used, dynamic

def normalize_key(k: str) -> str:
    # Falls Namespaces wie "common:foo.bar" verwendet werden,
    # kannst du hier optional den Namespace abschneiden:
    # if ":" in k: k = k.split(":", 1)[1]
    return k.strip()

# ==== Analyse ====
def main():
    de = load_json(DE_FILE)
    de_flat = flatten_i18n(de)
    de_keys = set(de_flat.keys())

    probe_keys = [
        "investedTokens.view.label",
        "investedTokens.view.memo",
        "investedTokens.view.token",
        "investedTokens.error.item.memo",
    ]
    for pk in probe_keys:
        print("🔍 Probe", pk, "→", "OK" if pk in de_flat else "FEHLT")

    def warn_on_top_level_dotted_keys(d: dict):
        bad = [k for k in d.keys() if isinstance(k, str) and "." in k]
        if bad:
            print("⚠️ Top-Level Keys mit Punkt gefunden (bitte in verschachtelte Form migrieren):")
            for k in bad:
                print(f"   - {k}")

    # nach de = load_json(DE_FILE)
    warn_on_top_level_dotted_keys(de)

    used_keys: Set[str] = set()
    key_locations = {}  # key -> Liste[(file, lineno, line)]
    dynamic_prefixes: Set[str] = set()
    files_scanned = 0

    for fp in iter_code_files(SRC_ROOT):
        files_scanned += 1
        # Normale Extraktion für dynamische Prefix-Erkennung
        kset, dyn = extract_keys_from_file(fp)
        used_keys.update(normalize_key(k) for k in kset if k.strip())
        dynamic_prefixes.update(dyn)

        # Neue Fundstellen-Erfassung
        file_key_locs = extract_keys_with_locations(fp)
        for k, locs in file_key_locs.items():
            key_locations.setdefault(k, []).extend(locs)

    # Keys, die mit whitelisted dynamischen Präfixen beginnen, nicht als 'missing' zählen
    def has_whitelisted_dynamic_prefix(k: str) -> bool:
        return any(k.startswith(p) for p in DYNAMIC_PREFIX_WHITELIST)

    filtered_used_keys = {k for k in used_keys if not has_whitelisted_dynamic_prefix(k)}

    # Keys, die im Code genutzt werden, aber in de.json fehlen
    missing_keys = sorted([k for k in filtered_used_keys if k not in de_keys])

    # Keys, die in de.json stehen, aber nirgends im Code auftauchen
    unused_keys = sorted([k for k in de_keys if k not in filtered_used_keys])

    # Dynamische Präfixe (Hinweis)
    dynamic_candidates = sorted(dynamic_prefixes)

    report = {
        "files_scanned": files_scanned,
        "total_de_keys": len(de_keys),
        "total_used_keys": len(used_keys),
        "missing_keys": missing_keys,
        "unused_keys": unused_keys,
        "dynamic_candidates": dynamic_candidates
    }

    # Report ausgeben
    print("\n===== i18n Usage Report =====")
    print(f"📄 Files scanned: {files_scanned}")
    print(f"🗝️  Keys in de.json: {len(de_keys)}")
    print(f"🔎 Keys used in code: {len(used_keys)}")
    print(f"❗ Missing keys (used but not in de.json): {len(missing_keys)}")
    if missing_keys:
        # --- NEU: Missing Keys nach Datei gruppieren ---
        from collections import defaultdict
        def rel_frontend(path: str) -> str:
            try:
                return os.path.relpath(path, SRC_ROOT)
            except Exception:
                return path

        # file -> [(lineno, key, text)]
        by_file = defaultdict(list)
        for key in missing_keys:
            for (f, ln, txt) in key_locations.get(key, []):
                by_file[rel_frontend(f)].append((ln, key, txt))

        # Sortierung: erst Dateiname (basename), dann kompletter relativer Pfad
        def file_sort_key(rel):
            return (os.path.basename(rel).lower(), rel.lower())

        for rel in sorted(by_file.keys(), key=file_sort_key):
            print(f"   📄 frontend/{rel}")
            for ln, key, txt in sorted(by_file[rel], key=lambda t: (t[0], t[1])):
                print(f"       {ln:>5}  {key}")
                print(f"             {txt}")
    print(f"🧹 Unused keys (in de.json but not used): {len(unused_keys)}")
    if unused_keys:
        for k in unused_keys[:200]:
            print(f"   - {k}")
        if len(unused_keys) > 200:
            print(f"   … und {len(unused_keys) - 200} weitere")
    if dynamic_candidates:
        print(f"⚠️ Dynamic key prefixes detected (manual check): {len(dynamic_candidates)}")
        for p in dynamic_candidates:
            print(f"   - {p}")
        if DYNAMIC_PREFIX_WHITELIST:
            print(f"✅ Dynamic prefix whitelist (not counted as missing): {len(DYNAMIC_PREFIX_WHITELIST)}")
            for p in sorted(DYNAMIC_PREFIX_WHITELIST):
                print(f"   - {p}")
    # --- Unused-Keys aus de.json (und optional allen Sprachen) entfernen ---
    if PRUNE_DE or PRUNE_ALL:
        # Schutz: dynamisch abgedeckte Keys nicht entfernen (falls du ALL_DYNAMIC_PREFIXES nutzt)
        def covered_by_any_dynamic(k: str) -> bool:
            try:
                return any(k.startswith(p) for p in ALL_DYNAMIC_PREFIXES)
            except NameError:
                return False  # falls du keine Dynamik nutzt

        candidates = [k for k in unused_keys if not covered_by_any_dynamic(k)]
        if not candidates:
            print("\n🧹 Nichts zu entfernen – keine ungenutzten Keys.")
        else:
            # 1) de.json laden & sichern
            de_dict = load_json(DE_FILE)
            ts = time.strftime("%Y%m%d-%H%M%S")
            backup_de = os.path.join(LOCALES_DIR, f"de.backup.{ts}.json")
            save_json(backup_de, de_dict)
            print(f"\n💾 Backup erstellt: {backup_de}")

            removed = []
            for key in candidates:
                if delete_path(de_dict, key):
                    removed.append(key)
            prune_empty_dicts(de_dict)
            save_json(DE_FILE, de_dict)

            print(f"🗑️  Aus de.json entfernt: {len(removed)} Keys")
            for k in removed[:50]:
                print(f"   - {k}")
            if len(removed) > 50:
                print(f"   … und {len(removed)-50} weitere")

            # 2) Optional alle anderen Sprachdateien synchron mit aufräumen
            if PRUNE_ALL:
                skip = {
                    os.path.basename(DE_FILE),
                    "i18n_changes_report.json",
                    "i18n_usage_report.json",
                    "de.snapshot.json",
                }
                other_jsons = [
                    f for f in os.listdir(LOCALES_DIR)
                    if f.endswith(".json") and f not in skip
                ]
                for fname in other_jsons:
                    path = os.path.join(LOCALES_DIR, fname)
                    data = load_json(path)
                    changed = False
                    for key in removed:  # gleiche Liste wie in DE entfernt
                        if delete_path(data, key):
                            changed = True
                    if changed:
                        prune_empty_dicts(data)
                        save_json(path, data)
                        print(f"   🔄 Gesäubert: {fname}")
            print("✅ Aufräumen abgeschlossen.")
    else:
        print("\n(Info) Keine Löschung durchgeführt. Starte mit --prune-de oder --prune-all, um ungenutzte Keys zu entfernen.")

    # Optional JSON speichern
    out_path = os.path.join(LOCALES_DIR, "i18n_usage_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Report gespeichert: {out_path}")

if __name__ == "__main__":
    main()
