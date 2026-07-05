#!/usr/bin/env python3
"""
Synchronisiert die Hash-Manifeste unter .i18n_hash/ mit dem AKTUELLEN Inhalt
der de/*.json (Pivot fuer en) bzw. en/*.json (Pivot fuer alle anderen 7
Sprachen) - ohne jede Uebersetzung und ohne API-Aufruf.

Hintergrund: Nach manuellen Direktbearbeitungen der JSON-Dateien (am
Uebersetzungsskript vorbei) kennen die Manifeste diese Aenderungen nicht mehr.
UpdateSprachdateienBasierendAufDE.py wuerde beim naechsten Lauf die
betroffenen Keys faelschlich als "geaendert" erkennen und per API neu
uebersetzen - und damit bereits korrekte manuelle Uebersetzungen ueberschreiben.

Nutzt _flatten_dict/_sha256/load_json/_save_manifest direkt aus
UpdateSprachdateienBasierendAufDE.py (Import, kein Copy-Paste), damit die
Hashes garantiert byte-identisch zu dem sind, was das Original-Skript selbst
berechnen wuerde.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import UpdateSprachdateienBasierendAufDE as usd  # noqa: E402

BASE_PATH = usd.BASE_PATH
TARGET_LANGS = usd.TARGET_LANGS


def sync_manifest(ns_dir: str, lang: str, pivot: str) -> int:
    """Baut <lang>_from_<pivot>.json komplett aus dem aktuellen Inhalt von ns_dir neu auf."""
    manifest: dict[str, str] = {}
    ns_files = sorted(f for f in os.listdir(ns_dir) if f.endswith(".json"))
    for ns_file in ns_files:
        ns_name = ns_file[:-5]
        data = usd.load_json(os.path.join(ns_dir, ns_file))
        if not isinstance(data, dict):
            continue
        flat = usd._flatten_dict(data)
        for k, v in flat.items():
            manifest[f"{ns_name}.{k}"] = usd._sha256(str(v))
    usd._save_manifest(lang, pivot, manifest)
    return len(manifest)


def main():
    de_dir = os.path.join(BASE_PATH, usd.BASE_LANG)
    en_dir = os.path.join(BASE_PATH, "en")

    print("== Sync en_from_de (Pivot: de/*.json) ==")
    count = sync_manifest(de_dir, "en", "de")
    print(f"   {count} Keys gehasht aus de/*.json")

    for lang in TARGET_LANGS:
        if lang == "en":
            continue
        print(f"== Sync {lang}_from_en (Pivot: en/*.json) ==")
        count = sync_manifest(en_dir, lang, "en")
        print(f"   {count} Keys gehasht aus en/*.json")

    print("\nFertig. Keine Uebersetzung, kein API-Call, keine JSON-Inhalte veraendert - nur Manifeste.")


if __name__ == "__main__":
    main()
