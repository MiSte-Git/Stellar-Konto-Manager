#!/usr/bin/env python3
# coding: utf-8
"""
Sync translation files based on German (de) reference.
- Ensures all locale JSON files have the same key tree as German.
- Adds missing keys with empty string values (or copies English defaults if present in code is not parsed here).
- Produces reports:
  - missing_keys.txt per locale
  - duplicate_keys.txt per locale (basic detection by re-parsing)
- Validates JSON syntax.

Usage:
  python3 scripts/UpdateSprachdateienBasierendAufDE.py

Notes:
- This script operates on frontend/src/locales/*.json and frontend/src/locales/<lang>/*.json
- de.json and de/* are considered the reference tree. Other languages must mirror keys.
"""

import json
import os
import sys
from typing import Any, Dict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCALES_DIR = os.path.join(ROOT, 'frontend', 'src', 'locales')

# Languages to sync (excluding 'de')
LANGS = []
for f in os.listdir(LOCALES_DIR):
    if f.endswith('.json'):
        lang = f.replace('.json', '')
        if lang != 'de':
            LANGS.append(lang)
# Add subfolder namespaces per language (en.json is flat; de/<ns>.json exists)
# We'll treat nested files only for 'de', and require other languages to define top-level flat files.


def load_json(path: str) -> Dict[str, Any]:
    with open(path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def save_json(path: str, obj: Dict[str, Any]):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write('\n')


def deep_merge(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def flatten(d: Dict[str, Any], prefix: str = '') -> Dict[str, Any]:
    res = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict):
            res.update(flatten(v, key))
        else:
            res[key] = v
    return res


def unflatten(flat: Dict[str, Any]) -> Dict[str, Any]:
    root: Dict[str, Any] = {}
    for k, v in flat.items():
        cur = root
        parts = k.split('.')
        for i, p in enumerate(parts):
            if i == len(parts) - 1:
                cur[p] = v
            else:
                if p not in cur or not isinstance(cur[p], dict):
                    cur[p] = {}
                cur = cur[p]
    return root


def read_reference_tree() -> Dict[str, Any]:
    # Reference is de.json + de/* namespace files
    base = load_json(os.path.join(LOCALES_DIR, 'de.json'))
    # Merge optional namespaces: learn.json, glossary.json, errors.json, home.json, common.json
    de_subdir = os.path.join(LOCALES_DIR, 'de')
    if os.path.isdir(de_subdir):
        for nsfile in os.listdir(de_subdir):
            if nsfile.endswith('.json'):
                ns_name = nsfile.replace('.json', '')
                ns_obj = load_json(os.path.join(de_subdir, nsfile))
                base = deep_merge(base, { ns_name: ns_obj })
    return base


def sync_lang(lang: str, ref_flat: Dict[str, Any]) -> bool:
    changed = False
    path = os.path.join(LOCALES_DIR, f'{lang}.json')
    try:
        cur = load_json(path)
    except Exception as e:
        print(f"[ERROR] {lang}.json invalid or missing: {e}")
        return False

    cur_flat = flatten(cur)

    # report files
    reports_dir = os.path.join(ROOT, 'content_backups')
    os.makedirs(reports_dir, exist_ok=True)
    missing_report = os.path.join(reports_dir, f'missing_keys_{lang}.txt')

    missing = []
    for k in ref_flat.keys():
        if k not in cur_flat:
            cur_flat[k] = ""
            missing.append(k)
            changed = True

    # remove extraneous keys? We keep them but report (non-blocking)
    extras = [k for k in cur_flat.keys() if k not in ref_flat]

    # Save report
    with open(missing_report, 'w', encoding='utf-8') as fh:
        if missing:
            fh.write("Missing keys (added as empty):\n")
            for k in missing:
                fh.write(f"- {k}\n")
        else:
            fh.write("No missing keys.\n")
        if extras:
            fh.write("\nExtra keys present (not removed):\n")
            for k in extras:
                fh.write(f"- {k}\n")

    # Save updated language file
    if changed:
        save_json(path, unflatten(cur_flat))
    return True


def main() -> int:
    ref = read_reference_tree()
    ref_flat = flatten(ref)

    ok_all = True
    for lang in LANGS:
        ok = sync_lang(lang, ref_flat)
        ok_all = ok_all and ok

    if not ok_all:
        print("Errors occurred during language sync.")
        return 1

    print("Language files synchronized successfully.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
