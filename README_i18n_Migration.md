> **Historisch (Juli 2025).** Beschreibt die damalige Migration mit OpenAI. Der aktuelle Stand der Pipeline steht in [docs/i18n-pipeline.md](docs/i18n-pipeline.md).

# 🌍 Migrations-Dokumentation: Internationalisierung (i18n)

## ✅ Ziel der Migration
Die bestehende flache Struktur der Übersetzungs-Keys wurde vollständig überarbeitet und durch eine verschachtelte, logisch gruppierte Struktur ersetzt. Ziel ist eine bessere Wartbarkeit, Klarheit und Erweiterbarkeit bei der Übersetzung der Webanwendung.

---

## 📦 Was wurde gemacht (Juli 2025)

### 🔁 Quellcode-Migration (`t('...')`)
- Alle `t('originalKey')` Aufrufe im gesamten Code rekursiv durch `t('suggestedKey')` ersetzt.
- Grundlage war die Datei `mapping_combined.csv`, die alle alten und neuen Schlüssel enthielt.
- Duplikate wurden manuell markiert und später bereinigt (`mapping_combined_bereinigt.csv`).

### 🧼 Aufräumen
- Alte, unbenutzte Keys aus `de.json` entfernt (basierend auf Codeanalyse).
- CSV-Dateien dokumentieren alle ersetzten und entfernten Schlüssel.

### 🛠 Neue Struktur
- Aus der bereinigten CSV wurde eine neue, verschachtelte `de.json` generiert.
  - Beispiel:
    ```json
    {
      "menu": {
        "listAll": "Alle Trustlines auflisten"
      },
      "secret": {
        "key": {
          "invalid": "Ungültiger Geheimschlüssel"
        }
      }
    }
    ```

## ⚙️ Anforderungen für das Übersetzungs-Skript
- Python 3 mit `pip` sowie das Paket `openai` installiert (z. B. `pip install openai` oder unter Windows `python -m pip install openai`).
- Umgebungvariable `OPENAI_API_KEY` muss gesetzt sein, damit Übersetzungen online erzeugt werden können.
- Aufrufbeispiel: `python3 frontend/src/locales/UpdateSprachdateienBasierendAufDE.py --provider openai --full`
