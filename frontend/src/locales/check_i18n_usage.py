#!/usr/bin/env python3
import os, re, json, sys, time
from typing import Dict, Set, List, Tuple

# ==== KONFIG ====
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LOCALES_DIR = os.path.join(PROJECT_ROOT, "frontend", "src", "locales")
DE_DIR = os.path.join(LOCALES_DIR, "de")

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
        print(f"⚠️ JSON nicht gefunden: {path}")
        return {}
    with open(path, encoding="utf-8") as f:
        s = f.read().strip()
        return json.loads(s) if s else {}

def deep_merge_dict(dst: Dict, src: Dict) -> Dict:
    """Rekursiv src in dst mergen (Dicts werden tief zusammengeführt)."""
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge_dict(dst[k], v)
        else:
            dst[k] = v
    return dst

def flatten_keys(data: Dict, prefix: str = "") -> Dict[str, str]:
    """Flacht verschachtelte Schlüssel zu Punkt-Pfaden ab (z. B. a.b.c)."""
    out: Dict[str, str] = {}
    if not isinstance(data, dict):
        return out
    for k, v in data.items():
        p = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, dict):
            out.update(flatten_keys(v, p))
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

# Namespace-Mapping: Code-Namespaces (case-insensitiv) -> echte Namespaces
ns_map: Dict[str, str] = {}

# Regexe für i18n-Keys:
#  - t('path.to.key'), t("path.to.key"), t(`path.to.key`)
#  - <Trans i18nKey="path.to.key">
#  - i18nKey={'path.to.key'} / i18nKey={`path.to.key`}
# t('...'), t("..."), t(`...`)
# erlaubt: foo, foo.bar, foo_bar, foo1.bar2 (mind. 2 Zeichen insgesamt)
VALID_KEY = r"[A-Za-z][A-Za-z0-9_.:]{1,}"

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

# ==== Erkennung mit Namespace-Aufloesung ====
# i18n.js: defaultNS 'common', fallbackNS ['common', 'menu']
DEFAULT_NS = "common"
FALLBACK_NS = ["common", "menu"]
PLURAL_SUFFIXES = ("_zero", "_one", "_two", "_few", "_many", "_other")

# t('key'), t('key', 'Fallback'), t('key', { ... }), i18n.t(...), auch ueber Zeilenumbrueche
RE_T_CALL = re.compile(rf"""(?<![A-Za-z0-9_$])t\s*\(\s*(['"`])({VALID_KEY})\1\s*(?=[,)])""")
RE_I18NKEY_ANY = re.compile(rf"""i18nKey\s*=\s*\{{?\s*(['"`])({VALID_KEY})\1""")
# useTranslation('ns') oder useTranslation(['ns1', 'ns2']): erster Eintrag ist der Default
RE_USE_TRANSLATION = re.compile(r"""useTranslation\s*\(\s*\[?\s*['"]([A-Za-z0-9_]+)['"]""")
# Beliebige String-Literale, fuer indirekt genutzte Keys (z. B. labelKey: 'menu:foo')
RE_STRING_LITERAL = re.compile(r"""(['"`])([A-Za-z][A-Za-z0-9_.:-]*[A-Za-z0-9_])\1""")


def key_exists(full: str, de_keys: Set[str]) -> bool:
    if full in de_keys:
        return True
    return any(f"{full}{suf}" in de_keys for suf in PLURAL_SUFFIXES)


def resolve_key(raw: str, candidates: List[str], de_keys: Set[str]):
    """Liefert (voller Key, gefunden?). Ohne ':' werden Datei-Namespace und Fallbacks probiert."""
    raw = raw.strip()
    if ":" in raw:
        full = normalize_key(raw)
        return full, key_exists(full, de_keys)
    for ns in candidates:
        full = f"{ns_map.get(ns.lower(), ns)}.{raw}"
        if key_exists(full, de_keys):
            return full, True
    return f"{ns_map.get(candidates[0].lower(), candidates[0])}.{raw}", False


def scan_file(path: str, de_keys: Set[str]):
    """Liefert (direkt genutzte Keys mit Fundstellen, indirekt genutzte Keys, dynamische Praefixe)."""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception as e:
        print(f"⚠️ Konnte Datei nicht lesen: {path} ({e})")
        return {}, set(), set()

    m = RE_USE_TRANSLATION.search(content)
    if m:
        first_ns = m.group(1)
        candidates = [first_ns] + [ns for ns in FALLBACK_NS if ns != first_ns]
    else:
        # Kein useTranslation: Hilfsdatei, die t() uebergeben bekommt (Namespace des
        # Aufrufers unbekannt). Default und Fallbacks zuerst, dann alle Namespaces.
        candidates = [DEFAULT_NS] + [ns for ns in FALLBACK_NS if ns != DEFAULT_NS]
        candidates += sorted(ns for ns in set(ns_map.values()) if ns not in candidates)
    lines = content.splitlines()

    direct = {}  # full key -> [(path, lineno, line), ...] (gefunden oder nicht)
    for regex in (RE_T_CALL, RE_I18NKEY_ANY):
        for match in regex.finditer(content):
            full, _found = resolve_key(match.group(2), candidates, de_keys)
            lineno = content.count("\n", 0, match.start()) + 1
            text = lines[lineno - 1].strip() if lineno - 1 < len(lines) else ""
            direct.setdefault(full, []).append((path, lineno, text))

    indirect = set()
    for match in RE_STRING_LITERAL.finditer(content):
        full, found = resolve_key(match.group(2), candidates, de_keys)
        if found:
            indirect.add(full)

    dynamic = set(RE_DYNAMIC_PREFIX.findall(content))
    return direct, indirect, dynamic


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
    """
    Formt einen Roh-Key in das Vergleichsformat um:
    - "ns:foo.bar" -> "ns.foo.bar" (Namespace case-insensitiv auf tatsächliche Datei mappen)
    - "ns.foo.bar" bleibt unverändert
    """
    k = k.strip()
    if ":" in k:
        ns_raw, inner = k.split(":", 1)
        ns_final = ns_map.get(ns_raw.strip().lower(), ns_raw.strip())
        return f"{ns_final}.{inner}"
    return k

def load_all_de_keys() -> Set[str]:
    """Lädt alle Namespaces unter de/*.json und liefert vollständige Keys ns.path; baut auch ein Namespace-Mapping."""
    keys: Set[str] = set()
    if not os.path.isdir(DE_DIR):
        print(f"⚠️ Verzeichnis fehlt: {DE_DIR}")
        return keys
    for fn in os.listdir(DE_DIR):
        if not fn.endswith(".json"):
            continue
        ns = os.path.splitext(fn)[0]
        ns_map[ns.lower()] = ns  # mappt Namespace-Namen aus Code auf echte Namespace-Dateien (case-insensitiv)
        data = load_json(os.path.join(DE_DIR, fn))
        flat = flatten_keys(data)
        for inner in flat.keys():
            keys.add(f"{ns}.{inner}")
    return keys

# ==== Analyse ====
def main():
    de_keys = load_all_de_keys()

    used_keys: Set[str] = set()
    key_locations = {}  # key -> Liste[(file, lineno, line)]
    dynamic_prefixes: Set[str] = set()
    files_scanned = 0

    indirect_keys: Set[str] = set()
    for fp in iter_code_files(SRC_ROOT):
        norm = fp.replace("\\", "/")
        if "/locales/" in norm:
            continue
        if re.search(r"\.(test|spec)\.(js|jsx|ts|tsx)$", os.path.basename(fp), re.IGNORECASE):
            continue
        files_scanned += 1
        direct, indirect, dyn = scan_file(fp, de_keys)
        used_keys.update(direct.keys())
        indirect_keys.update(indirect)
        dynamic_prefixes.update(dyn)
        for k, locs in direct.items():
            key_locations.setdefault(k, []).extend(locs)

    # Keys, die mit whitelisted dynamischen Präfixen beginnen, nicht als 'missing' zählen
    def has_whitelisted_dynamic_prefix(k: str) -> bool:
        return any(k.startswith(p) for p in DYNAMIC_PREFIX_WHITELIST)

    filtered_used_keys = {k for k in used_keys if not has_whitelisted_dynamic_prefix(k)}

    # Keys, die im Code per t()/i18nKey genutzt werden, aber in de/*.json fehlen
    missing_keys = sorted([k for k in filtered_used_keys if not key_exists(k, de_keys)])

    # Keys in de/*.json, die weder direkt noch indirekt (String-Literal) vorkommen.
    # Plural-Varianten (_one, _other, ...) zaehlen als genutzt, wenn der Basis-Key genutzt wird.
    all_used = used_keys | indirect_keys
    def is_used(k: str) -> bool:
        if k in all_used:
            return True
        for suf in PLURAL_SUFFIXES:
            if k.endswith(suf) and k[: -len(suf)] in all_used:
                return True
        return False
    unused_keys = sorted([k for k in de_keys if not is_used(k)])

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
    print(f"🗝️  Keys in de/*: {len(de_keys)}")
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
    print("\n(Info) Kein automatisches Pruning aktiviert; Skript analysiert nur die Namespaces unter de/*.json.")

    # Optional JSON speichern
    out_path = os.path.join(LOCALES_DIR, "i18n_usage_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Report gespeichert: {out_path}")

if __name__ == "__main__":
    main()
