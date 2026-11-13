import React from 'react';
import { useTranslation } from 'react-i18next';
import { ADDRESS_KINDS, classifyStellarAddress } from '../utils/stellar/addressType.js';

// Kennzeichnet eine Contract-Adresse (C oder W), damit sie nie wie ein normales Konto wirkt
// (ADR 0012, C-Konten vorbereiten, Korrektur K6). Fuer G, M und ungueltige Eingaben wird nichts
// gerendert, die Anzeige bleibt dort unveraendert.
// Reine Typangabe ohne Bewertung (AGENTS.md Regel 4): neutrale Farbe, kein Warntext.

const tagCls =
  'rounded-sm bg-gray-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300';

/**
 * @param {{ address?: string, kind?: string, className?: string }} props
 *   kind: bereits bestimmter Typ (z. B. counterpartyKind aus normalizeActivity), sonst aus address abgeleitet.
 */
export default function AddressKindTag({ address, kind, className = '' }) {
  const { t } = useTranslation(['common']);
  const resolved = kind || classifyStellarAddress(address);
  if (resolved !== ADDRESS_KINDS.CONTRACT && resolved !== ADDRESS_KINDS.MUXED_CONTRACT) return null;
  const hint = t(
    'common:addressKind.contractHint',
    'Contract-Adresse (C oder W): gehört zu einem Smart Contract, nicht zu einem normalen Stellar-Konto.'
  );
  return (
    <span className={`${tagCls} ${className}`.trim()} title={hint} aria-label={hint} data-testid="address-kind-contract">
      {t('common:addressKind.contractTag', 'Contract')}
    </span>
  );
}
