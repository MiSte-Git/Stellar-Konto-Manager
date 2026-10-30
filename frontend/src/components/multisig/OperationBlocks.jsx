import React from 'react';
import { DESCRIBED_OPERATION_TYPES } from '../../utils/multisig/describeOperations.js';

const BASE = 'rounded-sm border p-2';
const NORMAL = `${BASE} border-gray-200 dark:border-gray-700`;
const WARN = `${BASE} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100`;
const UNKNOWN = `${BASE} border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100`;

function blockStyle(block) {
  if (!DESCRIBED_OPERATION_TYPES.has(block.type)) return UNKNOWN;
  return block.warnings.length ? WARN : NORMAL;
}

/**
 * Operationen einer Transaktion als nummerierte Bloecke (Modell aus
 * describeOperations), je Block Titel und Tabelle Label/Wert. Signer pruefen hier,
 * was sie signieren: Werte werden nie gekuerzt, die feste Tabellenbreite bricht
 * lange Werte um, statt die Seite breiter zu machen.
 */
export default function OperationBlocks({ blocks }) {
  return (
    <ol className="space-y-2 text-xs" data-testid="operation-blocks">
      {blocks.map((block, index) => (
        <li key={`${index}-${block.type}`} className={blockStyle(block)} data-testid="operation-block" data-operation-type={block.type}>
          <div className="mb-1 break-words font-semibold">
            <span>{index + 1}.</span>{' '}
            <span>{block.title}</span>
          </div>
          <table aria-label={block.title} className="w-full table-fixed border-collapse text-left">
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <th scope="row" className="w-2/5 break-words py-0.5 pr-2 font-normal">{row.label}</th>
                  <td className={`py-0.5 ${row.wrap ? 'break-all font-mono' : 'break-words'} ${row.emphasis ? 'font-semibold' : ''}`}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {block.warnings.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-medium" data-testid="operation-block-warnings">
              {block.warnings.map((warning, warningIndex) => <li key={`${warningIndex}-${warning}`}>{warning}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
