import React from 'react';
import { useTranslation } from 'react-i18next';

function ResultModal({ deletedTrustlines, isSimulation = false, onClose }) {
  const { t } = useTranslation();

  if (!deletedTrustlines || deletedTrustlines.length === 0) return null;

  // Hilfsfunktion für Zeitstempel
  const getFormattedTimestamp = () => {
    const now = new Date();
    return now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  };

  // Dateiname generieren
  const getFileName = (ext) => {
    const prefix = 'STM_' + getFormattedTimestamp();
    return `${prefix}${isSimulation ? '_Simuliert' : ''}.${ext}`;
  };

  // CSV herunterladen
  const handleDownloadCSV = () => {
    const header = isSimulation
        ? ['Asset Code', 'Asset Issuer']
        : ['Asset Code', 'Asset Issuer', 'Transaction ID'];

    const csvContent = [
        header.join(','),
        ...deletedTrustlines.map(tl =>
        isSimulation
            ? `${tl.assetCode},${tl.assetIssuer}`
            : `${tl.assetCode},${tl.assetIssuer},${tl.txId || ''}`
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = getFileName('csv');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.click();
  };

  // PDF herunterladen mit optionalem Wasserzeichen
  const handleDownloadPDF = async () => {
    const jsPDF = (await import('jspdf')).default;
    const doc = new jsPDF();
    doc.setFontSize(12);
    doc.text(t('trustline:deleted.resultTitle'), 10, 10);

    deletedTrustlines.forEach((tl, index) => {
        const y = 20 + index * 10;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text(`- ${tl.assetCode} (${tl.assetIssuer})`, 10, y);

        if (!isSimulation && tl.txId) {
            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(`TX: ${tl.txId}`, 12, y + 5);
        }
    });


    if (isSimulation) {
      doc.setTextColor(255, 0, 0);
      doc.setFontSize(40);
      doc.text('SIMULATION', 35, 150, { angle: 45, opacity: 0.2 });
    }

    const fileName = getFileName('pdf');
    doc.save(fileName);
  };

  // In Zwischenablage kopieren
  const handleCopyToClipboard = () => {
    const text = deletedTrustlines.map(tl => `${tl.assetCode}, ${tl.assetIssuer}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4 text-black dark:text-white">
          {t('trustline:deleted.resultTitle')}
        </h2>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
          {t('trustline:deleted.resultText', {
            count: deletedTrustlines.length,
            mode: isSimulation
              ? t('trustline:deleted.mode.simulation')
              : t('trustline:deleted.mode.real')
          })}
        </p>

        <ul className="text-sm text-gray-800 dark:text-gray-200 list-disc pl-5 mb-4">
          {deletedTrustlines.map((tl, idx) => (
            <li key={idx}>
                {tl.assetCode} ({tl.assetIssuer})
                {!isSimulation && tl.txId && (
                    <div className="text-xs text-gray-500 break-all">
                    TX: {tl.txId}
                    </div>
                )}
            </li>
          ))}
        </ul>

        <div className="flex justify-end flex-wrap gap-3">
          <button
            onClick={handleCopyToClipboard}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            {t('common:option.copy', 'Copy')}
          </button>
          <button
            onClick={handleDownloadCSV}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('common:option.export.csv', 'Export CSV')}
          </button>
          <button
            onClick={handleDownloadPDF}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            {t('common:option.export.pdf', 'Export PDF')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
          >
            {t('common:option.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResultModal;
