import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Standardized dropdown for wallet/account selection showing Testnet markers.
 * Adds a "(Testnet)" suffix via i18n and highlights entries in yellow.
 */
export default function AccountSelect({ accounts = [], value, onChange, className = '', children, ...rest }) {
  const { t } = useTranslation(['common']);
  const combinedClassName = ['w-full p-2 border rounded bg-white dark:bg-gray-900', className].filter(Boolean).join(' ');

  return (
    <select value={value} onChange={onChange} className={combinedClassName} {...rest}>
      {children}
      {accounts.map((account, index) => {
        const key = account?.publicKey || account?.address || `account-${index}`;
        const labelBase = account?.name || account?.label || account?.publicKey || account?.address || '';
        const isTestnet = !!account?.isTestnet;
        const label = isTestnet ? `${labelBase} ${t('common:account.testnetLabel')}` : labelBase;
        const optionStyle = isTestnet ? { color: '#ca8a04', fontWeight: 600 } : undefined;
        return (
          <option
            key={key}
            value={account?.publicKey || account?.address || ''}
            className={isTestnet ? 'text-yellow-600 dark:text-yellow-400' : ''}
            style={optionStyle}
          >
            {label || key}
          </option>
        );
      })}
    </select>
  );
}
