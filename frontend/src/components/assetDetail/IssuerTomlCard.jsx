import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Angaben des Issuers aus seiner stellar.toml (ungeprüft). Werte nur als Text, URLs nicht klickbar.
 * info kommt aus issuerTomlInfo(assetFacts).
 */
export default function IssuerTomlCard({ info, tomlUrl, cardCls }) {
  const { t } = useTranslation(['wallet']);
  const k = (key, fallback, opts) => t(`wallet:assetDetail.issuerToml.${key}`, fallback, opts);

  const fieldLabel = {
    name: k('fields.name', 'Name'),
    desc: k('fields.desc', 'Beschreibung'),
    status: k('fields.status', 'Status'),
    anchor_asset_type: k('fields.anchorAssetType', 'Art des hinterlegten Werts'),
    anchor_asset: k('fields.anchorAsset', 'Hinterlegter Wert'),
    is_asset_anchored: k('fields.isAssetAnchored', 'Durch einen Wert außerhalb von Stellar gedeckt'),
    display_decimals: k('fields.displayDecimals', 'Nachkommastellen zur Anzeige'),
    is_unlimited: k('fields.isUnlimited', 'Menge unbegrenzt'),
    fixed_number: k('fields.fixedNumber', 'Feste Menge'),
    max_number: k('fields.maxNumber', 'Höchstmenge'),
    regulated: k('fields.regulated', 'Reguliert (Issuer muss Zahlungen freigeben)'),
    conditions: k('fields.conditions', 'Bedingungen'),
    redemption_instructions: k('fields.redemption', 'Einlösung'),
    attestation_of_reserve: k('fields.attestation', 'Nachweis der Reserven (Adresse)'),
  };

  const statusLabel = {
    live: k('status.live', 'Aktiv'),
    dead: k('status.dead', 'Eingestellt'),
    test: k('status.test', 'Test'),
    private: k('status.private', 'Privat'),
  };

  const renderValue = (e) => {
    if (e.kind === 'bool') return e.value ? k('yes', 'Ja') : k('no', 'Nein');
    if (e.kind === 'status') {
      return e.known ? statusLabel[e.value] : e.value;
    }
    const suffix = e.truncated ? ' …' : '';
    if (e.kind === 'url') return <span className="break-all font-mono text-xs">{e.value}{suffix}</span>;
    if (e.kind === 'long') return <span className="whitespace-pre-line break-words">{e.value}{suffix}</span>;
    if (e.kind === 'int' || e.kind === 'decimals') return String(e.value);
    return <span className="break-words">{e.value}{suffix}</span>;
  };

  let body;
  if (info.state === 'loading') {
    body = <p className="text-sm text-gray-600 dark:text-gray-300" aria-busy="true">{k('loading', 'Angaben werden geladen …')}</p>;
  } else if (info.state === 'unavailable') {
    body = <p className="text-sm text-gray-600 dark:text-gray-300">{k('unavailable', 'Keine Angaben: Die stellar.toml des Issuers konnte nicht geladen werden oder es gibt keine.')}</p>;
  } else if (info.state === 'notListed') {
    body = <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="issuer-toml-not-listed">{k('notListed', 'Dieses Asset steht nicht in der stellar.toml des Issuers.')}</p>;
  } else if (info.state === 'empty') {
    body = <p className="text-sm text-gray-600 dark:text-gray-300">{k('empty', 'Der Eintrag in der stellar.toml enthält keine weiteren Angaben.')}</p>;
  } else {
    body = (
      <dl className="grid gap-3 sm:grid-cols-2" data-testid="issuer-toml-fields">
        {info.entries.map((e) => (
          <div key={e.key} className={e.kind === 'long' ? 'sm:col-span-2' : ''} data-testid={`issuer-toml-${e.key}`}>
            <dt className="text-xs text-gray-500 dark:text-gray-400">{fieldLabel[e.key]}</dt>
            <dd className="text-sm text-gray-900 dark:text-gray-100">{renderValue(e)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <section className={cardCls} data-testid="issuer-toml">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{k('title', 'Angaben des Issuers')}</h2>
      <p className="mb-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
        {k('unverified', 'Aus der stellar.toml des Issuers, nicht geprüft. Der Issuer kann hier alles eintragen.')}
      </p>
      {body}
      {info.multiple && (
        <p className="mt-3 text-xs text-amber-800 dark:text-amber-300" data-testid="issuer-toml-multiple">
          {k('multiple', 'Das Asset ist mehrfach eingetragen. Gezeigt wird der erste Eintrag.')}
        </p>
      )}
      {tomlUrl && info.state !== 'loading' && info.state !== 'unavailable' && (
        <p className="mt-3 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{tomlUrl}</p>
      )}
    </section>
  );
}
