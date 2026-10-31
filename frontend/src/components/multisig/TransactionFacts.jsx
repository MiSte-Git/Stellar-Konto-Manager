import React from 'react';

/**
 * Transaktionsweite Angaben (Modell aus describeTransaction) als Tabelle Label/Wert, im
 * Stil von OperationBlocks: Werte werden nie gekuerzt, auffaellige Zeilen sind gelb.
 */
export default function TransactionFacts({ details, title }) {
  return (
    <div className="rounded-sm border border-gray-200 p-2 text-xs dark:border-gray-700" data-testid="job-tx-details">
      <table aria-label={title} className="w-full table-fixed border-collapse text-left">
        <tbody>
          {details.rows.map((row) => (
            <tr
              key={row.key}
              data-testid={`job-tx-row-${row.key}`}
              data-warn={row.warn ? 'true' : undefined}
              className={`align-top ${row.warn ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100' : ''}`}
            >
              <th scope="row" className="w-2/5 break-words py-0.5 pr-2 font-normal">{row.label}</th>
              <td className={`py-0.5 ${row.wrap ? 'break-all font-mono' : 'break-words'} ${row.emphasis ? 'font-semibold' : ''}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
