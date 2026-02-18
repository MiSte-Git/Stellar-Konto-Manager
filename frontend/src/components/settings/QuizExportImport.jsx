import React from 'react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';

const LANGS = ['de', 'en', 'es', 'fi', 'fr', 'hr', 'it', 'nl', 'ru'];
const LESSON_IDS = ['l1','l2','l3','l4','l5','l6','l7','l8','l9','l10','l11','l12'];
const OPTION_LETTERS = ['a','b','c','d'];

// Non-lesson top-level keys that we preserve during import
const PRESERVED_SECTIONS = ['entry','ui','meta','landing','achievements','result','settings'];

function detectQuestionType(qData) {
  if (qData && ('true' in qData || 'false' in qData)) return 'true-false';
  return 'multiple';
}

/** Check if a row object has all values empty or whitespace-only. */
function isEmptyRow(row) {
  return Object.values(row).every(v => !String(v ?? '').trim());
}

/** Convert an ExcelJS worksheet to an array of objects (like XLSX.utils.sheet_to_json). */
function sheetToObjects(ws) {
  const rows = [];
  const headers = [];
  ws.eachRow((row, rowNumber) => {
    const values = row.values; // 1-indexed, values[0] is undefined
    if (rowNumber === 1) {
      for (let i = 1; i < values.length; i++) {
        headers.push(String(values[i] ?? ''));
      }
      return;
    }
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = values[i + 1] != null ? String(values[i + 1]) : '';
    }
    rows.push(obj);
  });
  return rows;
}

/**
 * Compare imported rows against the existing i18n bundle.
 * Returns { updated, added } counts.
 */
function classifyImportedRows(rows, bundle) {
  let updated = 0;
  let added = 0;

  for (const row of rows) {
    const lid = String(row.LektionID || '').toLowerCase();
    const qk = String(row.FrageID || '').toLowerCase();
    const existingLesson = bundle?.[lid];
    if (existingLesson && existingLesson[qk]) {
      updated++;
    } else {
      added++;
    }
  }
  return { updated, added };
}

export default function QuizExportImport() {
  const { t, i18n } = useTranslation(['settings', 'quiz']);
  const [lang, setLang] = React.useState(i18n.language?.split('-')[0] || 'de');
  const [importData, setImportData] = React.useState(null);
  const [importError, setImportError] = React.useState('');
  const [importPreview, setImportPreview] = React.useState(null);
  const fileRef = React.useRef(null);

  // ── EXPORT ──────────────────────────────────────────────────────────
  const handleExport = React.useCallback(async () => {
    try {
      const bundle = i18n.getResourceBundle(lang, 'quiz');
      if (!bundle) { setImportError(t('settings:maintenance.noData')); return; }

      const rows = [];
      for (const lid of LESSON_IDS) {
        const section = bundle[lid];
        if (!section) continue;
        const title = section.title || '';

        // Find all question keys (q1, q2, q3, ...)
        const qKeys = Object.keys(section).filter(k => /^q\d+$/.test(k)).sort((a, b) => {
          return parseInt(a.slice(1)) - parseInt(b.slice(1));
        });

        for (const qk of qKeys) {
          const qData = section[qk];
          if (!qData) continue;
          const type = detectQuestionType(qData);
          const row = {
            LektionID: lid.toUpperCase(),
            LektionTitel: title,
            FrageID: qk,
            Frage: qData.question || '',
            Typ: type,
            Hinweis: qData.hint || '',
            Antwort_A: '',
            Antwort_B: '',
            Antwort_C: '',
            Antwort_D: '',
            Korrekte_Antwort: '',
            Feedback_A: '',
            Feedback_B: '',
            Feedback_C: '',
            Feedback_D: '',
          };

          if (type === 'true-false') {
            row.Antwort_A = qData['true'] || '';
            row.Antwort_B = qData['false'] || '';
            const trueFb = (qData['true.fb'] || '').toLowerCase();
            row.Korrekte_Antwort = trueFb.startsWith('richtig') || trueFb.startsWith('correct') || trueFb.startsWith('right') || trueFb.startsWith('oikein') || trueFb.startsWith('exact') || trueFb.startsWith('točno') || trueFb.startsWith('corretto') || trueFb.startsWith('juist') || trueFb.startsWith('правильно') ? 'true' : 'false';
            row.Feedback_A = qData['true.fb'] || '';
            row.Feedback_B = qData['false.fb'] || '';
          } else {
            for (let i = 0; i < OPTION_LETTERS.length; i++) {
              const letter = OPTION_LETTERS[i];
              const colIdx = ['Antwort_A','Antwort_B','Antwort_C','Antwort_D'][i];
              const fbIdx = ['Feedback_A','Feedback_B','Feedback_C','Feedback_D'][i];
              row[colIdx] = qData[letter] || '';
              row[fbIdx] = qData[`${letter}.fb`] || '';
            }
            const fbA = (qData['a.fb'] || '').toLowerCase();
            const fbB = (qData['b.fb'] || '').toLowerCase();
            const fbC = (qData['c.fb'] || '').toLowerCase();
            const fbD = (qData['d.fb'] || '').toLowerCase();
            const positiveStarts = ['richtig', 'correct', 'right', 'ja', 'yes', 'oikein', 'exact', 'točno', 'corretto', 'juist', 'правильно', 'genau'];
            const isPositive = (fb) => positiveStarts.some(p => fb.startsWith(p));
            if (isPositive(fbA)) row.Korrekte_Antwort = 'a';
            else if (isPositive(fbB)) row.Korrekte_Antwort = 'b';
            else if (isPositive(fbC)) row.Korrekte_Antwort = 'c';
            else if (isPositive(fbD)) row.Korrekte_Antwort = 'd';
            else row.Korrekte_Antwort = 'a'; // fallback
          }

          rows.push(row);
        }
      }

      if (rows.length === 0) { setImportError(t('settings:maintenance.noData')); return; }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Quiz');
      ws.columns = [
        { header: 'LektionID', key: 'LektionID', width: 10 },
        { header: 'LektionTitel', key: 'LektionTitel', width: 30 },
        { header: 'FrageID', key: 'FrageID', width: 8 },
        { header: 'Frage', key: 'Frage', width: 50 },
        { header: 'Typ', key: 'Typ', width: 12 },
        { header: 'Hinweis', key: 'Hinweis', width: 40 },
        { header: 'Antwort_A', key: 'Antwort_A', width: 40 },
        { header: 'Antwort_B', key: 'Antwort_B', width: 40 },
        { header: 'Antwort_C', key: 'Antwort_C', width: 40 },
        { header: 'Antwort_D', key: 'Antwort_D', width: 40 },
        { header: 'Korrekte_Antwort', key: 'Korrekte_Antwort', width: 16 },
        { header: 'Feedback_A', key: 'Feedback_A', width: 40 },
        { header: 'Feedback_B', key: 'Feedback_B', width: 40 },
        { header: 'Feedback_C', key: 'Feedback_C', width: 40 },
        { header: 'Feedback_D', key: 'Feedback_D', width: 40 },
      ];
      ws.addRows(rows);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().split('T')[0];
      a.download = `quiz_${lang}_${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setImportError('');
    } catch (err) {
      setImportError(String(err?.message || err));
    }
  }, [lang, i18n, t]);

  // ── IMPORT ──────────────────────────────────────────────────────────
  const handleFile = React.useCallback((e) => {
    setImportError('');
    setImportData(null);
    setImportPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setImportError(t('settings:maintenance.invalidFile'));
      return;
    }

    // Reset so the same file can be re-selected
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(ev.target.result);
        const ws = wb.worksheets[0];
        if (!ws) { setImportError(t('settings:maintenance.noData')); return; }

        const allRows = sheetToObjects(ws);

        // Separate empty rows from data rows
        let skippedEmpty = 0;
        const dataRows = [];
        for (const row of allRows) {
          if (isEmptyRow(row)) {
            skippedEmpty++;
          } else {
            dataRows.push(row);
          }
        }

        if (dataRows.length === 0) {
          setImportError(t('settings:maintenance.noData'));
          return;
        }

        // Validate required fields on non-empty rows
        const errors = [];
        const lessonSet = new Set();

        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          const rowErrors = [];

          const lid = String(row.LektionID || '').toUpperCase().trim();
          const qid = String(row.FrageID || '').toLowerCase().trim();
          const typ = String(row.Typ || '').toLowerCase().trim();
          const korr = String(row.Korrekte_Antwort || '').toLowerCase().trim();
          const context = lid && qid ? ` (Lektion ${lid}, Frage ${qid})` : '';

          if (!lid) rowErrors.push('LektionID fehlt');
          if (!qid) rowErrors.push('FrageID fehlt');
          if (!String(row.Frage || '').trim()) rowErrors.push('Frage fehlt');

          if (typ === 'multiple') {
            // At least 2 answers required
            const filledAns = ['Antwort_A','Antwort_B','Antwort_C','Antwort_D'].filter(c => String(row[c] || '').trim());
            if (filledAns.length < 2) {
              rowErrors.push(`Multiple-Choice benötigt mindestens 2 Antworten, nur ${filledAns.length} gefunden`);
            }
            // Each filled answer must have feedback
            for (const [ansCol, fbCol] of [['Antwort_A','Feedback_A'],['Antwort_B','Feedback_B'],['Antwort_C','Feedback_C'],['Antwort_D','Feedback_D']]) {
              if (String(row[ansCol] || '').trim() && !String(row[fbCol] || '').trim()) {
                rowErrors.push(`${fbCol} fehlt (${ansCol} ist ausgefüllt)`);
              }
            }
            // Korrekte_Antwort must be a/b/c/d
            if (!['a','b','c','d'].includes(korr)) {
              rowErrors.push(`Korrekte_Antwort muss a, b, c oder d sein (gefunden: "${korr || '—'}")`);
            }
          } else if (typ === 'true-false') {
            // A and B required
            for (const c of ['Antwort_A','Antwort_B']) {
              if (!String(row[c] || '').trim()) rowErrors.push(`${c} fehlt bei True-False Frage`);
            }
            // C and D must be empty
            const extraAns = ['Antwort_C','Antwort_D'].filter(c => String(row[c] || '').trim());
            if (extraAns.length > 0) {
              rowErrors.push(`True-False darf nur 2 Antworten haben, ${2 + extraAns.length} gefunden`);
            }
            // Feedback A and B required
            for (const fb of ['Feedback_A','Feedback_B']) {
              if (!String(row[fb] || '').trim()) rowErrors.push(`${fb} fehlt bei True-False Frage`);
            }
            // Feedback C and D must be empty
            const extraFbs = ['Feedback_C','Feedback_D'].filter(c => String(row[c] || '').trim());
            if (extraFbs.length > 0) {
              rowErrors.push(`True-False darf nur 2 Feedbacks haben (${extraFbs.join(', ')} ist ausgefüllt)`);
            }
            // Korrekte_Antwort must be true/false
            if (!['true','false'].includes(korr)) {
              rowErrors.push(`Korrekte_Antwort muss "true" oder "false" sein (gefunden: "${korr || '—'}")`);
            }
          } else {
            rowErrors.push(`Unbekannter Typ "${typ || '—'}" (erwartet: multiple oder true-false)`);
          }

          if (rowErrors.length > 0) {
            const originalIdx = allRows.indexOf(row);
            const excelRow = originalIdx + 2;
            errors.push(`${t('settings:maintenance.row', { row: excelRow })}${context}: ${rowErrors.join('; ')}`);
          }
          lessonSet.add(lid || '?');
        }

        if (errors.length > 0) {
          setImportError(errors.join('\n'));
          return;
        }

        // Classify: new vs updated questions
        const bundle = i18n.getResourceBundle(lang, 'quiz') || {};
        const { updated, added } = classifyImportedRows(dataRows, bundle);

        const multipleCount = dataRows.filter(r => String(r.Typ || '').toLowerCase() === 'multiple').length;
        const tfCount = dataRows.filter(r => String(r.Typ || '').toLowerCase() === 'true-false').length;

        // Sort lesson IDs by numeric part (l1, l2, ... l12)
        const lessonIds = [...lessonSet].filter(l => l !== '?').sort((a, b) => {
          const na = parseInt(a.replace(/[^0-9]/g, '')) || 0;
          const nb = parseInt(b.replace(/[^0-9]/g, '')) || 0;
          return na - nb;
        });

        setImportData(dataRows);
        setImportPreview({
          lessons: lessonSet.size,
          lessonIds,
          questions: dataRows.length,
          multipleCount,
          tfCount,
          updated,
          added,
          skippedEmpty,
        });
      } catch (err) {
        setImportError(String(err?.message || err));
      }
    };
    reader.readAsArrayBuffer(file);
  }, [t, lang, i18n]);

  // ── BUILD JSON & DOWNLOAD ──────────────────────────────────────────
  const handleDownloadJson = React.useCallback(() => {
    if (!importData) return;
    try {
      // Get the existing bundle to preserve non-lesson sections
      const bundle = i18n.getResourceBundle(lang, 'quiz') || {};
      const result = {};

      // Copy preserved sections
      for (const key of PRESERVED_SECTIONS) {
        if (bundle[key]) result[key] = JSON.parse(JSON.stringify(bundle[key]));
      }
      // Copy entry if exists
      if (bundle.entry) result.entry = JSON.parse(JSON.stringify(bundle.entry));

      // Group imported rows by lesson
      const byLesson = {};
      for (const row of importData) {
        const lid = String(row.LektionID || '').toLowerCase();
        if (!byLesson[lid]) byLesson[lid] = { _title: '', _questions: [] };
        byLesson[lid]._title = row.LektionTitel || byLesson[lid]._title || '';
        byLesson[lid]._questions.push(row);
      }

      // Reconstruct in correct order – merge with existing
      const ordered = {};
      // entry first
      if (result.entry) { ordered.entry = result.entry; delete result.entry; }

      // lessons in order
      for (const lid of LESSON_IDS) {
        const importedLesson = byLesson[lid];
        const existingLesson = bundle[lid] ? JSON.parse(JSON.stringify(bundle[lid])) : null;

        if (!importedLesson && !existingLesson) continue;

        // Start from existing lesson data (preserves questions not in import)
        const section = existingLesson ? { ...existingLesson } : {};

        if (importedLesson) {
          // Update title if provided
          if (importedLesson._title) section.title = importedLesson._title;

          // Merge each imported question (add or update)
          for (const row of importedLesson._questions) {
            const qk = String(row.FrageID || '').toLowerCase();
            const type = String(row.Typ || '').toLowerCase();
            const q = { question: row.Frage || '', hint: row.Hinweis || '' };

            if (type === 'true-false') {
              q['true'] = row.Antwort_A || '';
              q['false'] = row.Antwort_B || '';
              q['true.fb'] = row.Feedback_A || '';
              q['false.fb'] = row.Feedback_B || '';
            } else {
              for (let i = 0; i < OPTION_LETTERS.length; i++) {
                const letter = OPTION_LETTERS[i];
                const colIdx = ['Antwort_A','Antwort_B','Antwort_C','Antwort_D'][i];
                const fbIdx = ['Feedback_A','Feedback_B','Feedback_C','Feedback_D'][i];
                const val = row[colIdx] || '';
                if (val) {
                  q[letter] = val;
                  q[`${letter}.fb`] = row[fbIdx] || '';
                }
              }
            }
            // Replace (or add) this question — full replacement of the question object
            // so old keys from a different type are removed
            section[qk] = q;
          }
        }

        // Sort question keys so they appear in order (q1, q2, q3, ...)
        const sortedSection = {};
        if (section.title !== undefined) sortedSection.title = section.title;
        const qKeys = Object.keys(section).filter(k => /^q\d+$/.test(k)).sort((a, b) =>
          parseInt(a.slice(1)) - parseInt(b.slice(1))
        );
        for (const qk of qKeys) {
          sortedSection[qk] = section[qk];
        }
        ordered[lid] = sortedSection;
      }

      // Append preserved sections
      for (const key of PRESERVED_SECTIONS) {
        if (result[key]) ordered[key] = result[key];
      }

      const blob = new Blob([JSON.stringify(ordered, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quiz_${lang}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(String(err?.message || err));
    }
  }, [importData, lang, i18n]);

  // ── BUILD LESSON JSONs & DOWNLOAD ────────────────────────────────────
  // Generates the structural lesson*.json files (options array, correct flags)
  // that the quiz renderer uses. Must be placed in frontend/src/data/learn/quiz/.
  const handleDownloadLessonJsons = React.useCallback(() => {
    if (!importData) return;
    try {
      // Group by lesson
      const byLesson = {};
      for (const row of importData) {
        const lid = String(row.LektionID || '').toLowerCase();
        if (!byLesson[lid]) byLesson[lid] = { lid, questions: [] };
        byLesson[lid].questions.push(row);
      }

      for (const [lid, lesson] of Object.entries(byLesson)) {
        const lessonNum = lid.replace(/[^0-9]/g, '') || '1';
        const questions = [];

        for (const row of lesson.questions) {
          const qk = String(row.FrageID || '').toLowerCase();
          const typ = String(row.Typ || '').toLowerCase();
          const korr = String(row.Korrekte_Antwort || '').toLowerCase();

          let options;
          let qType;

          if (typ === 'true-false') {
            qType = 'true_false';
            options = [
              { id: 'true', textKey: `quiz:${lid}.${qk}.true`, correct: korr === 'true', feedbackKey: `quiz:${lid}.${qk}.true.fb` },
              { id: 'false', textKey: `quiz:${lid}.${qk}.false`, correct: korr === 'false', feedbackKey: `quiz:${lid}.${qk}.false.fb` },
            ];
          } else {
            qType = 'single';
            options = [];
            for (const letter of OPTION_LETTERS) {
              const colIdx = ['Antwort_A','Antwort_B','Antwort_C','Antwort_D'][OPTION_LETTERS.indexOf(letter)];
              if (String(row[colIdx] || '').trim()) {
                options.push({
                  id: letter,
                  textKey: `quiz:${lid}.${qk}.${letter}`,
                  correct: korr === letter,
                  feedbackKey: `quiz:${lid}.${qk}.${letter}.fb`,
                });
              }
            }
          }

          questions.push({
            id: qk,
            type: qType,
            questionKey: `quiz:${lid}.${qk}.question`,
            hintKey: `quiz:${lid}.${qk}.hint`,
            options,
          });
        }

        // Sort questions by id (q1, q2, ...)
        questions.sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)));

        const lessonJson = {
          lessonId: lid.toUpperCase(),
          titleKey: `quiz:${lid}.title`,
          meta: { estimatedMinutes: 3, passPercent: 0.8, threeStarPercent: 0.9 },
          questions,
        };

        const blob = new Blob([JSON.stringify(lessonJson, null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lesson${lessonNum}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setImportError(String(err?.message || err));
    }
  }, [importData]);

  return (
    <div className="space-y-4">
      <hr className="border-gray-300 dark:border-gray-600" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('settings:maintenance.title')}
      </h3>

      {/* Language selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="quiz-export-lang" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings:maintenance.selectLanguage')}
        </label>
        <select
          id="quiz-export-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
        >
          {LANGS.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </div>

      {/* Export button */}
      <button
        type="button"
        onClick={handleExport}
        className="px-4 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
      >
        {t('settings:maintenance.exportExcel')}
      </button>

      {/* Import section */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings:maintenance.importFile')}
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={handleFile}
          className="block text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-200 file:text-gray-800 dark:file:bg-gray-700 dark:file:text-gray-200 hover:file:bg-gray-300 dark:hover:file:bg-gray-600"
        />
      </div>

      {/* Error display */}
      {importError && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
          {importError}
        </div>
      )}

      {/* Preview */}
      {importPreview && !importError && (
        <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300">
          <div className="font-semibold">{t('settings:maintenance.preview')}</div>
          <div>{t('settings:maintenance.lessonsFound', { count: importPreview.lessons, questions: importPreview.questions })}</div>
          <ul className="mt-1 text-xs list-none space-y-0.5">
            {importPreview.multipleCount > 0 && (
              <li>✅ {importPreview.multipleCount} Multiple-Choice-Fragen – Antworten & Feedbacks vollständig</li>
            )}
            {importPreview.tfCount > 0 && (
              <li>✅ {importPreview.tfCount} True-False-Fragen – Antworten & Feedbacks vollständig</li>
            )}
            {importPreview.updated > 0 && (
              <li>↻ {t('settings:maintenance.questionsUpdated', { count: importPreview.updated })}</li>
            )}
            {importPreview.added > 0 && (
              <li>+ {t('settings:maintenance.questionsAdded', { count: importPreview.added })}</li>
            )}
            {importPreview.skippedEmpty > 0 && (
              <li>– {t('settings:maintenance.rowsSkipped', { count: importPreview.skippedEmpty })}</li>
            )}
          </ul>
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="px-4 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors self-start"
            >
              {t('settings:maintenance.downloadJson')} (quiz_{lang}.json)
            </button>
            <button
              type="button"
              onClick={handleDownloadLessonJsons}
              className="px-4 py-2 rounded text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors self-start"
            >
              Lesson-Struktur herunterladen ({importPreview.lessons} {importPreview.lessons === 1 ? 'Datei' : 'Dateien'})
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <div>{t('settings:maintenance.replaceHint', { lang, file: 'quiz.json' })}</div>
            <div>
              Lesson-JSONs → <code>frontend/src/data/learn/quiz/</code>
              {importPreview.lessonIds?.length > 0 && (
                <span className="ml-1">
                  ({importPreview.lessonIds.map(id => `lesson${id.replace(/[^0-9]/g,'')}.json`).join(', ')})
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
