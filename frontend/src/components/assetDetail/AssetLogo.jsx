import React, { useState } from 'react';
import { apiUrl } from '../../utils/apiBase.js';

/**
 * Logo aus der stellar.toml des Issuers, immer über unser Backend (/api/trade/assets/logo).
 * Der Browser lädt nie direkt von der Domain des Issuers, CSP img-src bleibt 'self'.
 * Dekorativ (alt leer), der Code steht daneben. Fehler oder kein Logo: nichts anzeigen.
 */
export default function AssetLogo({ code, issuer, network, size = 40 }) {
  const [failed, setFailed] = useState(false);
  if (failed || !code || !issuer) return null;
  const params = new URLSearchParams({ code, issuer, network: network || '' });
  return (
    <img
      src={`${apiUrl('trade/assets/logo')}?${params.toString()}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full border border-gray-200 bg-white object-contain dark:border-gray-700"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      data-testid="asset-logo"
    />
  );
}
