import json
import os
import argparse
from argparse import RawTextHelpFormatter
import subprocess
import sys
import re
from typing import Dict, Any, Set

# Optionaler Import nur bei Bedarf
# (vermeidet harten Import-Fehler, wenn nur DeepL genutzt wird)
try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

BASE_LANG = "de"
TARGET_LANGS = ["en", "nl", "es", "fr", "it", "fi", "hr", "ru"]
# Standard-Basispfad: Verzeichnis dieser Datei, damit Aufruf von überall funktioniert
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
# Verzeichnis für Hash-Manifeste
HASH_DIR = os.path.join(BASE_PATH, ".i18n_hash")


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


def translate_text_openai(text: str, target_lang: str, api_key: str) -> str | None:
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
        msg = response.choices[0].message if response and response.choices else None
        content = (msg.content if msg and hasattr(msg, "content") and isinstance(msg.content, str) else "")
        translated = content.strip()
        return translated if translated else text
    except Exception as e:
        print(f"❌ Fehler bei OpenAI-Übersetzung nach {target_lang}: {e}")
        return None


def translate_text_deepl(text: str, target_lang: str, api_key: str, api_url: str | None = None) -> str:
    """Übersetze via DeepL REST API ohne zusätzliche Abhängigkeiten.
    Setzt 'DEEPL_API_URL' optional, sonst api-free.deepl.com.
    Bei Fehlern wird eine Exception geworfen, damit die aktuelle Sprache abgebrochen werden kann.
    Bei 429 (Rate Limit) wird mit Backoff automatisch erneut versucht, statt sofort abzubrechen.
    """
    import time
    import urllib.request
    import urllib.error

    raw_url = api_url if api_url is not None else os.getenv("DEEPL_API_URL")
    url: str = (raw_url or "https://api-free.deepl.com/v2/translate")
    url = url.strip()
    # DeepL hat die Form-Body-Authentifizierung (auth_key als POST-Parameter) im
    # November 2025 abgeschaltet. Stattdessen: Header-basierte Auth + JSON-Body.
    #
    # source_lang: Diese Pipeline übersetzt strukturell IMMER DE -> EN (Phase A) oder
    # vom bereits geschriebenen EN-Pivot in eine der anderen 7 Sprachen (Phase B) - die
    # Quellsprache ist also nie unbekannt und lässt sich direkt aus target_lang ableiten
    # (target=EN -> Quelle ist zwingend DE; jedes andere Ziel -> Quelle ist zwingend EN).
    # Ohne source_lang verlässt sich DeepL auf Auto-Detection, die bei kurzen,
    # kontextlosen Strings (einzelne Wörter ohne Satzkontext) ambige/falsche Ergebnisse
    # liefert. Konkret beobachtet und gegen die echte API verifiziert: "(leer)" wurde
    # als Afrikaans erkannt (detected_source_language: "AF") und zu "(learn)" statt
    # "(empty)" übersetzt; mit explizitem source_lang="DE" korrekt zu "(blank)".
    body = {
        "text": [text],
        "target_lang": target_lang.upper(),  # z. B. EN, DE, FR
        "source_lang": "DE" if target_lang.upper() == "EN" else "EN",
    }
    data = json.dumps(body).encode("utf-8")

    max_retries = 5
    backoff = 2.0
    time.sleep(0.25)  # kleine, proaktive Drosselung, um 429s von vornherein seltener zu machen
    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"DeepL-Auth-Key {api_key}")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                trans_list = payload.get("translations") or []
                if trans_list:
                    return (trans_list[0].get("text") or text).strip()
                raise RuntimeError("DeepL: leere Antwort erhalten")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt < max_retries - 1:
                    print(f"INFO: DeepL 429 (Rate Limit) - warte {backoff:.0f}s und versuche erneut ({attempt + 1}/{max_retries})")
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                raise RuntimeError("DeepL: 429 Too Many Requests (Rate Limit) - auch nach mehreren Versuchen. Abbruch der aktuellen Sprache.")
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
) -> str | None:
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


# -------- Original-Key Handling (never translate, copy from de.json) --------
ORIGINAL_RE = re.compile(r'(^|\.)original$')
# Sonderzeichen-Erkennung (z.B. ★, Emojis), die wir nicht verlieren dürfen.
# Enthält bewusst KEINE gängige Interpunktion (&, Gedankenstriche, Ellipse,
# typografische Anführungszeichen, Guillemets) - ein Übersetzer/DeepL darf diese
# legitim an die Zielsprache anpassen (z.B. "&" -> "und"/"and", "–" -> ein anderer
# Strich-Stil). Wären sie hier als "special" gelistet, würde jede solche (inhaltlich
# korrekte) Abweichung _preserve_special_chars dazu bringen, die KOMPLETTE Übersetzung
# zu verwerfen und stattdessen den unübersetzten deutschen Text durchzureichen - das
# ist genau der Bug, der bei "&" und "–" beobachtet wurde. Echte Icons/Symbole wie
# ★ oder Emoji bleiben weiterhin geschützt.
SPECIAL_CHAR_RE = re.compile(
    r"[^\w\s.,;:!?'\"()\[\]{}<>\\\-\/"
    r"&–—―‐‑‒…"
    r"‘’‚‛“”„‟"
    r"«»‹›]"
)

def is_original_key(path: str) -> bool:
    return bool(ORIGINAL_RE.search(path))

def _handle_skip_original(path: str, counters: Dict[str, int] | None = None) -> None:
    # Log and increment skipped counter; raise and catch for UI-compat string
    print(f"Überspringe Übersetzung für Original-Key: {path}")
    if counters is not None:
        counters['skippedOriginalKeysCount'] = counters.get('skippedOriginalKeysCount', 0) + 1
    try:
        raise Exception('i18n.translate.skipOriginal:' + path)
    except Exception:
        # Swallow to continue processing
        pass


def _extract_special_chars(text: str) -> Set[str]:
    """Finde Sonderzeichen, die nicht zu Standard-Punktuation gehören (z.B. ★, Emojis)."""
    return set(re.findall(SPECIAL_CHAR_RE, text or ""))


def _preserve_special_chars(source: Any, translated: str, path: str, counters: Dict[str, int] | None = None) -> str:
    """
    Stellt sicher, dass Sonderzeichen (z.B. ★) aus dem Quelltext nicht verloren gehen.
    Falls Zeichen fehlen, wird der Quelltext zurückgegeben, um Layout/Ikonen zu bewahren.
    """
    if not isinstance(source, str):
        return translated
    specials = _extract_special_chars(source)
    if not specials:
        return translated
    translated_str = translated if isinstance(translated, str) else str(translated)
    missing = [ch for ch in specials if ch not in translated_str]
    if missing:
        if counters is not None:
            counters['preservedSpecialCharKeys'] = counters.get('preservedSpecialCharKeys', 0) + 1
        print(f"INFO: Bewahre Sonderzeichen für {path}: {''.join(missing)} → Originaltext übernommen")
        return source
    return translated_str


# -------- Klammer-Begriffe vor Übersetzung schützen --------
KEEP_EN_RE = re.compile(r"\(([^()]*)\)")
# ASCII_EN_ALLOWED prüft nur das ZEICHEN-Alphabet (verhindert Umlaute/Sonderzeichen),
# nicht ob der Inhalt tatsächlich Englisch ist - Deutsch ohne Umlaute ist genauso ASCII
# (z.B. "leer", "schnell", "systembedingt" oder ganze Phrasen wie "zum Aktivieren").
# ASCII_EN_ALLOWED bleibt daher bewusst als reine Zeichen-Vorprüfung bestehen; das
# eigentliche Gate unten (_looks_like_kept_english_term) verlangt zusätzlich ein
# konkretes Signal für "das ist ein bewusst beibehaltener Fachbegriff", nicht irgendein
# ASCII-Text.
ASCII_EN_ALLOWED = re.compile(r"^[A-Za-z0-9 ,._\-/:]+$")


def _looks_like_kept_english_term(inner: str) -> bool:
    """Grenzt "Mehrfachsignatur (Multi-Signature)" (schützen) von "(leer)"/"(zum
    Aktivieren)" (normal übersetzen) ab. Reines ASCII-Alphabet allein reicht nicht -
    gewöhnliche deutsche Wörter/Sätze ohne Umlaute sind ebenfalls ASCII (konkret
    beobachtet: "(leer)" wurde dadurch in Phase A/DE->EN maskiert, die Übersetzung
    "empty" kam nie an, EN blieb wörtlich "(leer)" stehen).

    Zwei Kriterien, beide müssen erfüllt sein:
    - Kein Leerzeichen: schließt mehrwortige deutsche Phrasen/Sätze aus (die absolute
      Mehrheit der falschen Treffer, z.B. "einmalig beim ersten Aktivieren").
    - Enthält eine Ziffer, einen Großbuchstaben oder eines von "_:/" - ein Signal für
      bewusst gewählte Fachbegriffe/Codes (Testnet, uint64, ed25519, MEMO_RETURN, M...,
      CODE:ISSUER, S-Key) statt eines gewöhnlichen klein geschriebenen Wortes (leer,
      optional, schnell).
    Kein Wörterbuch, keine Sprachdetektion - bewusst konservativ und mechanisch, um das
    Verhalten nachvollziehbar und testbar zu halten. Deckt nicht jeden Fall ab (z.B.
    "Alle" bliebe fälschlich geschützt, da großgeschrieben), reduziert die Falsch-
    Positiv-Rate aber drastisch gegenüber der reinen ASCII-Prüfung.
    """
    if not inner or " " in inner:
        return False
    return bool(re.search(r"[0-9A-Z_:/]", inner))


def protect_parenthesized_english(text: str) -> tuple[str, dict[str, str]]:
    """
    Maskiert englische Begriffe in Klammern, damit die Übersetzung sie nicht verändert.
    Beispiel: \"Mehrfachsignatur (Multi-Signature)\" -> \"Mehrfachsignatur (__KEEP_EN_TERM_1__)\".
    """
    placeholders: dict[str, str] = {}
    if not isinstance(text, str) or "(" not in text or ")" not in text:
        return text, placeholders

    def _repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        if not inner or not ASCII_EN_ALLOWED.fullmatch(inner) or not _looks_like_kept_english_term(inner):
            return match.group(0)
        placeholder = f"__KEEP_EN_TERM_{len(placeholders) + 1}__"
        placeholders[placeholder] = inner
        return f"({placeholder})"

    return KEEP_EN_RE.sub(_repl, text), placeholders


def restore_parenthesized_english(text: str, mapping: dict[str, str]) -> str:
    """Setzt zuvor maskierte Klammer-Begriffe wieder zurück (Platzhalter → Original)."""
    if not mapping or not isinstance(text, str):
        return text
    restored = text
    for placeholder, original in mapping.items():
        restored = restored.replace(placeholder, original)
    return restored


def protect_parenthesized_english_for_target(text: str, target_lang: str) -> tuple[str, dict[str, str]]:
    """Wendet protect_parenthesized_english() NUR für Phase A (DE -> EN, target_lang == "en")
    an. Grund: Die Maskierung soll bewusst gewählte englische Fachbegriffe in einem
    NICHT-englischen Quelltext bewahren (z.B. "Mehrfachsignatur (Multi-Signature)"). In
    Phase B (EN-Pivot -> andere Sprache) ist der Quelltext aber bereits vollständig
    Englisch - ASCII_EN_ALLOWED matcht dort JEDES kurze Klammer-Wort (nicht nur bewusst
    beibehaltene Fachbegriffe), maskiert es zu einem Platzhalter-Token, und DeepL lässt
    einen Platzhalter-Token (keine natürliche Sprache) unverändert stehen - die Übersetzung
    kommt dadurch nie an. Konkret beobachtet: "(empty)" blieb dadurch in allen 7
    Nicht-EN-Sprachen unübersetzt "(empty)" statt z.B. "(vacío)"/"(leer)"/... zu werden.
    """
    if target_lang != "en":
        return text, {}
    return protect_parenthesized_english(text)


# -------- Hash-basierte Änderungs-Erkennung --------

def _collect_leaf_paths(d: Dict[str, Any], prefix: str = "") -> Set[str]:
    paths: Set[str] = set()
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            paths |= _collect_leaf_paths(v, p)
        else:
            paths.add(p)
    return paths


def _flatten_dict(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten_dict(v, p))
        else:
            out[p] = v
    return out


def _sha256(s: str) -> str:
    import hashlib
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def check_namespace_key_collisions(de_ns_dir: str, ns_files: list[str]) -> None:
    """Warnt laut, falls zwei verschiedene Quellen denselben zusammengesetzten
    Manifest-Schlüssel "<namespace>.<relativer Key>" erzeugen würden - z.B.
    Namespace-Datei "quiz.ui.json" (ns_name="quiz.ui", Key "allDone") kollidiert
    mit einem verschachtelten "ui"-Objekt in "quiz.json" (ns_name="quiz",
    relativer Key "ui.allDone" -> ebenfalls "quiz.ui.allDone").

    Ohne diese Prüfung überschreiben sich beide Quellen gegenseitig im
    Hash-Manifest (wer zuletzt verarbeitet wird, gewinnt), und die
    Änderungserkennung wird für BEIDE Quellen dauerhaft unzuverlässig - das war
    die tatsächliche Ursache der wiederkehrenden "quiz.ui.*"-Drift bei jedem
    Lauf, unabhängig von --force-key.
    """
    key_origin: Dict[str, str] = {}
    collisions: Set[str] = set()
    for ns_file in sorted(ns_files):
        ns_name = ns_file[:-5]
        data = load_json(os.path.join(de_ns_dir, ns_file))
        if not isinstance(data, dict):
            continue
        for rel in _collect_leaf_paths(data):
            composite = f"{ns_name}.{rel}"
            origin = f"{ns_file} ({rel})"
            if composite in key_origin and key_origin[composite] != origin:
                collisions.add(f"{composite}:  {key_origin[composite]}  <->  {origin}")
            else:
                key_origin[composite] = origin
    if collisions:
        print(
            "⚠️  WARNUNG: Namespace-Key-Kollisionen im Hash-Manifest entdeckt - "
            "zwei verschiedene Quellen erzeugen denselben Manifest-Schlüssel, "
            "die Änderungserkennung wird für beide unzuverlässig:"
        )
        for c in sorted(collisions):
            print(f"   {c}")


def _missing_rel_keys(base_flat_rel: Dict[str, Any], target_dict: Dict[str, Any]) -> Set[str]:
    """Relative Keys aus base_flat_rel, die im (noch verschachtelten) target_dict fehlen.
    Wird gebraucht, um das Hash-Manifest nur für tatsächlich neu befüllte/übersetzte
    Keys zu aktualisieren (siehe merge_keys_missing_or_changed: fehlende Keys werden
    immer ergänzt, unabhängig von changed_paths/forced_paths).
    """
    existing_flat = _flatten_dict(target_dict)
    return set(base_flat_rel.keys()) - set(existing_flat.keys())


def _load_manifest(lang: str, from_pivot: str) -> Dict[str, str]:
    path = os.path.join(HASH_DIR, f"{lang}_from_{from_pivot}.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
            return {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def _save_manifest(lang: str, from_pivot: str, data: Dict[str, str]) -> None:
    os.makedirs(HASH_DIR, exist_ok=True)
    path = os.path.join(HASH_DIR, f"{lang}_from_{from_pivot}.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"💾 Manifest gespeichert: {path}")
    except Exception as e:
        print(f"❌ Fehler beim Speichern von Manifest {path}: {e}")


def _get_node_by_path(d: Dict[str, Any], path: str):
    node: Any = d
    for part in path.split('.'):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def expand_forced_paths(base_dict: Dict[str, Any], forced_list: list[str], namespace: str) -> Set[str]:
    """Löst --force-key-Pfade zu relativen Leaf-Paths innerhalb von base_dict auf.

    base_dict ist das namespace-eigene Dict OHNE Namespace-Wrapper (z.B. ns_base
    für "menu" ist direkt {"createAccount": ..., ...}, nicht {"menu": {...}}).
    forced_list-Einträge haben die dokumentierte Form "<namespace>.<key>" oder
    exakt "<namespace>" (= ganzer Namespace). Nur Einträge, deren führendes
    Segment zu DIESEM Namespace passt, werden berücksichtigt - alle anderen
    gehören zu einem anderen Namespace-File und werden still übersprungen
    (kein "nicht gefunden", das ist kein Fehler). Der Namespace-Präfix wird vor
    dem Lookup abgeschnitten, denn base_dict selbst hat diesen Präfix nicht -
    und die zurückgegebenen Pfade müssen namespace-RELATIV sein, weil
    changed_rel/de_flat_rel/en_flat_rel ebenfalls relative (unpräfixierte)
    Keys verwenden.

    Vorher (Bug): der volle "<namespace>.<key>"-Pfad wurde direkt gegen das
    unpräfixierte base_dict aufgelöst -> _get_node_by_path fand nie etwas (das
    erste Pfadsegment war ja der Namespace-Name, kein echter Top-Level-Key),
    --force-key griff für JEDEN Namespace ins Leere und hatte de facto NIE
    eine Wirkung auf bereits vorhandene Keys.
    """
    out: Set[str] = set()
    for p in forced_list:
        if not p:
            continue
        if p == namespace:
            rel = ""
        elif p.startswith(f"{namespace}."):
            rel = p[len(namespace) + 1:]
        else:
            continue

        if rel == "":
            out |= _collect_leaf_paths(base_dict, "")
            continue

        node = _get_node_by_path(base_dict, rel)
        if node is None:
            print(f"INFO: Warnung: erzwungener Schlüssel nicht gefunden: {p}")
            continue
        if isinstance(node, dict):
            out |= _collect_leaf_paths(node, rel)
        else:
            out.add(rel)
    return out


def merge_keys_missing_or_changed(
    base_dict: Dict[str, Any],
    target_dict: Dict[str, Any],
    lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
    changed_paths: Set[str],
    forced_paths: Set[str],
    counters: Dict[str, int],
    failed_paths: Set[str],
    prefix: str = "",
) -> Dict[str, Any]:
    """Füge fehlende Schlüssel hinzu ODER aktualisiere gezielt geänderte Leaf-Pfade aus de.json.
    - Wenn ein Pfad in changed_paths liegt, wird er neu übersetzt (überschreibt bestehende Werte).
    - Fehlende Keys werden wie zuvor ergänzt.
    - Keys, die auf '.original' enden, werden nie übersetzt. Sie werden aus de.json kopiert;
      vorhandene Werte werden nur überschrieben, wenn der Pfad in forced_paths liegt.
    """
    out = dict(target_dict)
    for key, value in base_dict.items():
        cur_path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            # Achtung Signatur: failed_paths kommt VOR prefix. Der rekursive
            # Aufruf hatte hier lange ein Argument zu wenig - cur_path rutschte
            # in den failed_paths-Slot und prefix blieb leer, wodurch
            # verschachtelte Keys mit nacktem Blattnamen (statt dot-Pfad) gegen
            # changed_paths/forced_paths geprüft wurden: geänderte oder per
            # --force-key erzwungene verschachtelte Keys wurden nie neu
            # übersetzt (nur komplett fehlende ergänzt).
            out[key] = merge_keys_missing_or_changed(
                value,
                out.get(key, {}),
                lang,
                provider,
                openai_key,
                deepl_key,
                changed_paths,
                forced_paths,
                counters,
                failed_paths,
                cur_path,
            )
        else:
            if is_original_key(cur_path):
                # Skip translation, copy from base; overwrite only if forced
                _handle_skip_original(cur_path, counters)
                if key not in out:
                    out[key] = value
                    counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                else:
                    if cur_path in forced_paths and out.get(key) != value:
                        out[key] = value
                        counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                continue
            needs_update = (key not in out) or (cur_path in changed_paths)
            if needs_update:
                protected, placeholders = protect_parenthesized_english_for_target(value if isinstance(value, str) else "", lang)
                translated_raw = translate_text(protected, lang, provider, openai_key, deepl_key)
                if translated_raw is None:
                    failed_paths.add(cur_path)
                    out[key] = out.get(key, value)
                else:
                    translated = restore_parenthesized_english(translated_raw, placeholders)
                    translated = _preserve_special_chars(value, translated, cur_path, counters)
                    out[key] = translated
    return out


def translate_full(
    base_dict: Dict[str, Any],
    lang: str,
    provider: str,
    openai_key: str | None,
    deepl_key: str | None,
    target_existing: Dict[str, Any] | None = None,
    forced_paths: Set[str] | None = None,
    counters: Dict[str, int] | None = None,
    failed_paths: Set[str] | None = None,
    prefix: str = "",
) -> Dict[str, Any]:
    """Übersetze alle Schlüssel aus base_dict neu in die Zielsprache.
    Für Keys, die auf '.original' enden, wird niemals übersetzt; sie werden aus der Basis kopiert.
    Bereits bestehende Werte werden nur überschrieben, wenn der Pfad in forced_paths liegt.
    """
    target_dict: Dict[str, Any] = {}
    target_existing = target_existing or {}
    forced_paths = forced_paths or set()
    for key, value in base_dict.items():
        cur_path = f"{prefix}.{key}" if prefix else key
        existing_val = target_existing.get(key)
        if isinstance(value, dict):
            target_dict[key] = translate_full(
                value,
                lang,
                provider,
                openai_key,
                deepl_key,
                (existing_val if isinstance(existing_val, dict) else {}),
                forced_paths,
                counters,
                failed_paths,
                cur_path,
            )
        else:
            if is_original_key(cur_path):
                _handle_skip_original(cur_path, counters)
                if existing_val is None or cur_path in forced_paths:
                    target_dict[key] = value
                    if counters is not None:
                        counters['copiedOriginalKeysCount'] = counters.get('copiedOriginalKeysCount', 0) + 1
                else:
                    # bestehenden Wert behalten
                    target_dict[key] = existing_val
            else:
                # Bestehende Übersetzungen nur überschreiben, wenn erzwungen
                if existing_val is None or cur_path in forced_paths:
                    protected, placeholders = protect_parenthesized_english_for_target(value if isinstance(value, str) else "", lang)
                    translated_raw = translate_text(protected, lang, provider, openai_key, deepl_key)
                    if translated_raw is None:
                        if failed_paths is not None:
                            failed_paths.add(cur_path)
                        target_dict[key] = existing_val if existing_val is not None else value
                    else:
                        translated = restore_parenthesized_english(translated_raw, placeholders)
                        translated = _preserve_special_chars(value, translated, cur_path, counters)
                        target_dict[key] = translated
                else:
                    target_dict[key] = existing_val
    return target_dict


def prune_extra_keys(base_dict: Dict[str, Any], target_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Entfernt Keys aus target_dict, die in base_dict nicht existieren (rekursiv)."""
    pruned: Dict[str, Any] = {}
    for key, base_val in base_dict.items():
        if key not in target_dict:
            continue
        tgt_val = target_dict[key]
        if isinstance(base_val, dict) and isinstance(tgt_val, dict):
            pruned[key] = prune_extra_keys(base_val, tgt_val)
        else:
            pruned[key] = tgt_val
    return pruned


# -------- Learn-Namespace: fehlende Keys aus lessons.json ergänzen + Spiegel erzeugen --------

def deep_merge_missing(target: Dict[str, Any], source: Dict[str, Any], diffs: list[str] | None = None, prefix: str = "") -> None:
    """Fügt nur fehlende Keys aus source in target ein. Bei unterschiedlichen vorhandenen Werten wird NICHT überschrieben,
    sondern der Pfad in diffs vermerkt.
    """
    for k, v in (source or {}).items():
        cur = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            if k not in target or not isinstance(target.get(k), dict):
                target[k] = {}
            deep_merge_missing(target[k], v, diffs, cur)
        else:
            if k not in target:
                target[k] = v
            else:
                if target[k] != v and diffs is not None:
                    diffs.append(cur)


def main():
    # Argumente parsen
    parser = argparse.ArgumentParser(
        description=(
            "Aktualisiert Sprachdateien auf Basis der Namespace-Struktur.\n"
            "Standard: de/<ns>.json → en/<ns>.json → andere/<ns>.json (inkrementell: nur fehlende/ geänderte Keys laut Hash-Manifest).\n"
            "\n"
            "Optionen:\n"
            "  --force-key <pfad>   Erzwingt Neuübersetzung einzelner Schlüssel (dot-Pfade).\n"
            "                       Mehrfach nutzbar oder komma-separiert.\n"
            "                       Beispiele: feedback.title  |  menu.feedback  |  feedback\n"
            "  --full               Vollständiger Lauf: alle Schlüssel neu übersetzen (langsamer/teurer).\n"
            "\n"
            "Beispiele:\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --force-key feedback.title --force-key menu.feedback\n"
            "  python3 UpdateSprachdateienBasierendAufDE.py --provider deepl --full\n"
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
    parser.add_argument(
        "--prune-extra",
        action="store_true",
        help="Entfernt Keys in Zielsprachen, die in der Basis nicht mehr existieren (rekursiv).",
    )
    parser.add_argument(
        "--namespaced-only",
        action="store_true",
        help="[veraltet, ohne Wirkung] Verarbeitung ist bereits ausschließlich Namespace-basiert (de/<ns>.json → en → andere).",
    )
    # Wenn ohne Argumente aufgerufen: vollständige Hilfe zeigen und beenden
    if len(sys.argv) == 1:
        parser.print_help()
        print("\nHinweis: --provider ist erforderlich (openai|deepl). Beispiele siehe oben.")
        return

    args = parser.parse_args()

    base_path = args.base_path
    # HASH_DIR war bisher fest an das Skriptverzeichnis gebunden und ignorierte
    # --base-path - ein --base-path-Lauf (z.B. Tests, alternativer Checkout) hat
    # dadurch unbemerkt die Manifeste im ECHTEN Repo mitverändert. HASH_DIR folgt
    # jetzt konsistent dem gewählten base_path (Default unverändert = Skriptverzeichnis).
    global HASH_DIR
    HASH_DIR = os.path.join(base_path, ".i18n_hash")
    provider = args.provider
    # --full schaltet bewusst in den Voll-Lauf; ohne Flag wird inkrementell (nur neue/geänderte Keys laut Hash) gearbeitet.
    do_full = bool(args.full)
    force_keys_raw = args.force_keys or []
    do_prune = bool(args.prune_extra)

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
        print(f"INFO: DeepL endpoint: {(os.getenv('DEEPL_API_URL') or 'https://api-free.deepl.com/v2/translate')}")

    # Standard: Namespaces verarbeiten (de/<ns>.json → en/<ns>.json → andere/<ns>.json)
    de_ns_dir = os.path.join(base_path, BASE_LANG)
    if not os.path.isdir(de_ns_dir):
        print(f"❌ Namespace-Verzeichnis fehlt: {de_ns_dir}")
        return

    # Learn-Sync: lessons.json → de/learn.json (nur fehlende Keys ergänzen)
    try:
        lessons_path = os.path.normpath(os.path.join(base_path, "..", "data", "learn", "lessons.json"))
        lessons_raw = load_json(lessons_path)
        if isinstance(lessons_raw, list):
            learn_from_lessons: Dict[str, Any] = {}
            for l in lessons_raw:
                if not isinstance(l, dict):
                    continue
                lid = l.get("id")
                if not isinstance(lid, str) or not lid:
                    continue
                learn_from_lessons[lid] = {
                    "title": l.get("title", ""),
                    "goal": l.get("goal", ""),
                    "task": l.get("task", ""),
                    "learningOutcome": l.get("learningOutcome", ""),
                    "reward": l.get("reward", ""),
                }
            de_learn_file = os.path.join(de_ns_dir, "learn.json")
            existing_learn = load_json(de_learn_file)
            next_learn = json.loads(json.dumps(existing_learn)) if existing_learn else {}
            diffs_ns_de: list[str] = []
            deep_merge_missing(next_learn, learn_from_lessons, diffs_ns_de)
            if json.dumps(existing_learn, ensure_ascii=False, sort_keys=True) != json.dumps(next_learn, ensure_ascii=False, sort_keys=True):
                os.makedirs(os.path.dirname(de_learn_file), exist_ok=True)
                save_json(de_learn_file, next_learn)
            if diffs_ns_de:
                print(f"INFO: de/learn.json ergänzt. Abweichende bestehende Werte nicht überschrieben: {len(diffs_ns_de)}")
        else:
            print("INFO: Keine gültige lessons.json-Liste gefunden; Überspringe Learn-Sync.")
    except Exception as e:
        print(f"INFO: Learn-Sync (de/learn.json) übersprungen: {e}")

    # API-Keys aus Umgebungsvariablen lesen (bereits oben geprüft, hier nur Variablen verwenden)
    openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
    deepl_key = os.getenv("DEEPL_API_KEY") or os.getenv("DEEPL_AUTH_KEY")
    counters: Dict[str, int] = {"skippedOriginalKeysCount": 0, "copiedOriginalKeysCount": 0}

    # Force-Keys einsammeln (dot-Pfade, können Subtrees sein)
    force_keys_raw = args.force_keys or []
    forced_list: list[str] = []
    for raw in force_keys_raw:
        forced_list.extend([s.strip() for s in raw.split(',') if s and s.strip()])
    # True, sobald IRGENDEIN --force-key übergeben wurde - unabhängig davon, ob er zum
    # gerade verarbeiteten Namespace gehört. Siehe Kommentar bei changed_rel unten:
    # ein scoped --force-key-Lauf darf für Namespaces AUSSERHALB seines Ziels keine
    # generische Hash-Drift-Erkennung mehr auslösen.
    any_force_key = bool(forced_list)

    ns_files = [f for f in os.listdir(de_ns_dir) if f.endswith('.json')]
    if not ns_files:
        print(f"INFO: Keine Namespaces in {de_ns_dir} gefunden. Nichts zu tun.")
        return

    check_namespace_key_collisions(de_ns_dir, ns_files)

    for ns_file in sorted(ns_files):
        ns_name = ns_file[:-5]
        ns_base_path = os.path.join(de_ns_dir, ns_file)
        ns_base = load_json(ns_base_path)
        if not isinstance(ns_base, dict):
            print(f"INFO: Überspringe ungültigen Namespace {ns_name} ({ns_file})")
            continue

        print(f"\n🧩 Namespace '{ns_name}':")

        # Force-Keys für diesen Namespace
        forced_paths = expand_forced_paths(ns_base, forced_list, namespace=ns_name) if forced_list else set()

        # Phase A: de -> en (hash-basiert)
        try:
            en_dir = os.path.join(base_path, "en")
            os.makedirs(en_dir, exist_ok=True)
            en_out = os.path.join(en_dir, f"{ns_name}.json")
            en_existing = load_json(en_out)
            failed_paths_en: Set[str] = set()

            # Flatten DE-NS (relativ) und bilde Präfix für Manifest
            de_flat_rel = _flatten_dict(ns_base, prefix="")
            de_flat_pref = {f"{ns_name}.{k}": v for k, v in de_flat_rel.items()}
            man_en = _load_manifest("en", "de")

            # Inkrementell: nur Keys mit geändertem Hash übersetzen; Full-Lauf übersetzt alles.
            # Ein gezielter --force-key-Lauf (ohne --full) rührt NUR die erzwungenen Pfade an -
            # keine generelle Hash-Drift-Erkennung über den ganzen Namespace, damit unabhängige,
            # längst übersetzte Keys nicht durch einen zufällig abweichenden Hash (z.B. History-
            # bedingte Manifest/Content-Drift) erneut angefasst werden.
            #
            # Bug (reproduziert u.a. an trading.json während eines --force-key
            # common.accountMode-Laufs): war forced_paths für DIESEN Namespace leer (der
            # Force-Key gehörte zu einem ANDEREN Namespace), fiel der Code in den
            # generischen Hash-Drift-Zweig - und jede vorbestehende, unabhängige
            # Manifest/Content-Drift (typischerweise von Hand-Edits an Sprachdateien vorbei
            # am Skript) wurde bei diesem völlig unbeteiligten Lauf "gratis" mitübersetzt.
            # any_force_key unterscheidet jetzt "kein --force-key angegeben" (normaler
            # inkrementeller Lauf, Hash-Drift-Erkennung soll greifen) von "--force-key
            # angegeben, aber nicht für DIESEN Namespace" (dieser Namespace bleibt komplett
            # unangetastet - nur echte Lücken werden weiterhin gefüllt, siehe
            # merge_keys_missing_or_changed: "key not in out" ist unabhängig von changed_rel).
            if do_full:
                changed_rel = set(de_flat_rel.keys())
            elif forced_paths:
                changed_rel = set(forced_paths)
            elif any_force_key:
                changed_rel = set()
            else:
                changed_rel = set(
                    k for k, v in de_flat_rel.items()
                    if man_en.get(f"{ns_name}.{k}") != _sha256(str(v))
                )

            if do_full:
                en_translated = translate_full(
                    ns_base,
                    "en",
                    provider,
                    openai_key,
                    deepl_key,
                    target_existing={},
                    forced_paths=forced_paths,
                    counters=counters,
                    failed_paths=failed_paths_en,
                )
            else:
                en_translated = merge_keys_missing_or_changed(
                    ns_base,
                    en_existing,
                    "en",
                    provider,
                    openai_key,
                    deepl_key,
                    changed_paths=changed_rel,
                    forced_paths=forced_paths,
                    counters=counters,
                    failed_paths=failed_paths_en,
                )
            if do_prune:
                en_translated = prune_extra_keys(ns_base, en_translated)
            save_json(en_out, en_translated)
            print(f"   → en/{ns_name}.json aktualisiert")

            # Manifest aktualisieren (EN from DE) - NUR für Keys, die dieser Lauf
            # tatsächlich übersetzt/ergänzt hat (do_full: alle; sonst: fehlende + changed_rel).
            # Alle anderen Keys behalten ihren bisherigen Manifest-Eintrag unangetastet, damit
            # echte, noch nicht nachgezogene Drift nicht durch einen unbeteiligten --force-key-
            # Lauf still als "erledigt" markiert wird, ohne je neu übersetzt worden zu sein.
            touched_rel_en = set(de_flat_rel.keys()) if do_full else (_missing_rel_keys(de_flat_rel, en_existing) | changed_rel)
            for k, v in de_flat_pref.items():
                rel = k.split(f"{ns_name}.", 1)[-1]
                if rel in failed_paths_en or rel not in touched_rel_en:
                    continue
                man_en[k] = _sha256(str(v))
            _save_manifest("en", "de", man_en)
        except Exception as e:
            print(f"❌ Abbruch für Sprache en / Namespace {ns_name}: {e}")
            continue

        # Phase B: en -> andere (hash-basiert, Pivot EN-NS)
        en_ns = load_json(en_out) or {}
        en_flat_rel = _flatten_dict(en_ns, prefix="")
        en_flat_pref = {f"{ns_name}.{k}": v for k, v in en_flat_rel.items()}

        for lang in TARGET_LANGS:
            if lang == "en":
                continue
            try:
                out_dir = os.path.join(base_path, lang)
                os.makedirs(out_dir, exist_ok=True)
                out_file = os.path.join(out_dir, f"{ns_name}.json")
                existing = load_json(out_file)
                failed_paths_lang: Set[str] = set()

                man_lang = _load_manifest(lang, "en")

                # Gleiche Begründung wie bei changed_rel in Phase A oben: ein --force-key
                # für einen anderen Namespace darf hier keine generische Hash-Drift-
                # Erkennung auslösen.
                if do_full:
                    changed_rel_lang = set(en_flat_rel.keys())
                elif forced_paths:
                    changed_rel_lang = set(forced_paths)
                elif any_force_key:
                    changed_rel_lang = set()
                else:
                    changed_rel_lang = set(
                        k for k, v in en_flat_rel.items()
                        if man_lang.get(f"{ns_name}.{k}") != _sha256(str(v))
                    )

                if do_full:
                    translated = translate_full(
                        en_ns,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        target_existing={},
                        forced_paths=set(),
                        counters=counters,
                        failed_paths=failed_paths_lang,
                    )
                else:
                    translated = merge_keys_missing_or_changed(
                        en_ns,
                        existing,
                        lang,
                        provider,
                        openai_key,
                        deepl_key,
                        changed_paths=changed_rel_lang,
                        forced_paths=forced_paths,
                        counters=counters,
                        failed_paths=failed_paths_lang,
                    )
                if do_prune:
                    translated = prune_extra_keys(en_ns, translated)
                save_json(out_file, translated)
                print(f"   → {lang}/{ns_name}.json aktualisiert")

                # Manifest aktualisieren (lang from EN) - NUR für tatsächlich verarbeitete Keys
                # (siehe Kommentar bei Phase A oben - gleiche Begründung).
                touched_rel_lang = set(en_flat_rel.keys()) if do_full else (_missing_rel_keys(en_flat_rel, existing) | changed_rel_lang)
                for k, v in en_flat_pref.items():
                    rel = k.split(f"{ns_name}.", 1)[-1]
                    if rel in failed_paths_lang or rel not in touched_rel_lang:
                        continue
                    man_lang[k] = _sha256(str(v))
                _save_manifest(lang, "en", man_lang)
            except Exception as e:
                print(f"❌ Abbruch für Sprache {lang} / Namespace {ns_name}: {e}")
                continue

    print(f"\nZusammenfassung Namespaces: {{'skippedOriginalKeysCount': {counters.get('skippedOriginalKeysCount', 0)}, 'copiedOriginalKeysCount': {counters.get('copiedOriginalKeysCount', 0)}}}")
    print("\n✅ Namespaced-Verarbeitung abgeschlossen.")


if __name__ == "__main__":
    main()

# Mini-Selbsttest (gedanklich):
# Input: "Mehrfachsignatur (Multi-Signature) schützt dein Konto."
# Erwartung nach protect_parenthesized_english: "Mehrfachsignatur (__KEEP_EN_TERM_1__) schützt dein Konto."
# Erwartung nach restore_parenthesized_english: Klammerteil bleibt exakt "Multi-Signature".
