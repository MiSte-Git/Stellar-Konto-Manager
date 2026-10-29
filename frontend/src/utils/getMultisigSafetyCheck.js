import { StrKey } from '@stellar/stellar-sdk';

function clampByte(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.trunc(v)));
}

export function getMultisigSafetyCheck({
  t,
  currentAccount,
  defaultPublicKey,
  masterWeight,
  signers,
  thresholds,
}) {
  const plannedMaster = clampByte(masterWeight);
  const plannedThresholds = {
    low: clampByte(thresholds?.low),
    med: clampByte(thresholds?.med),
    high: clampByte(thresholds?.high),
  };
  const plannedEd25519 = [
    ...(defaultPublicKey ? [{ key: String(defaultPublicKey).trim(), weight: plannedMaster }] : []),
    ...(signers || []).map((s) => ({
      key: (s?.key || '').trim(),
      weight: clampByte(s?.weight || 0),
    })),
  ].filter((s) => s.key && StrKey.isValidEd25519PublicKey(s.key) && s.weight > 0);
  const plannedEd25519Weight = plannedEd25519.reduce((acc, s) => acc + s.weight, 0);
  const plannedEd25519Count = plannedEd25519.length;
  const specialSigners = (currentAccount?.signers || [])
    .filter((s) => s?.type && String(s.type) !== 'ed25519_public_key' && Number(s.weight || 0) > 0)
    .map((s) => ({ type: s.type, weight: clampByte(s.weight || 0) }));
  const specialWeight = specialSigners.reduce((acc, s) => acc + s.weight, 0);
  const totalWeightAll = plannedEd25519Weight + specialWeight;
  const errors = [];
  if (totalWeightAll < 1) {
    errors.push(t('common:multisigEdit.error.noActiveSigners'));
  }
  if (plannedEd25519Count < 1) {
    errors.push(t('common:multisigEdit.error.noEd25519Signers'));
  }
  if (plannedMaster === 0 && totalWeightAll < plannedThresholds.high) {
    errors.push(t('common:multisigEdit.error.masterZeroInsufficientHigh', { sum: totalWeightAll, high: plannedThresholds.high }));
  }
  if (totalWeightAll < plannedThresholds.high) {
    errors.push(t('common:multisigEdit.error.thresholdHighUnreachable', { sum: totalWeightAll, high: plannedThresholds.high }));
  }
  if (totalWeightAll < plannedThresholds.med) {
    errors.push(t('common:multisigEdit.error.thresholdMedUnreachable', { sum: totalWeightAll, med: plannedThresholds.med }));
  }
  if (specialSigners.length > 0 && plannedEd25519Weight < plannedThresholds.high) {
    errors.push(t('common:multisigEdit.error.specialSignerLastHigh', { sum: plannedEd25519Weight, high: plannedThresholds.high }));
  }
  if (plannedEd25519Weight < plannedThresholds.high) {
    errors.push(t('common:multisigEdit.error.setOptionsNotSignable', { sum: plannedEd25519Weight, high: plannedThresholds.high }));
  }
  // Warnungen erst, wenn zusätzliche Signer konfiguriert sind - ein reines
  // Einzelkonto (nur Master) hat naturgemäss nur einen Signer, das ist kein Befund.
  const hasAdditionalSigners = (signers || []).length > 0;
  const warnings = [];
  if (hasAdditionalSigners && plannedThresholds.high > 0 && plannedEd25519Count === 1) {
    warnings.push(t('common:multisigEdit.warning.highSingleSigner'));
  }
  if (hasAdditionalSigners && plannedThresholds.med > 0 && plannedEd25519Count === 1) {
    warnings.push(t('common:multisigEdit.warning.medSingleSigner'));
  }
  if (hasAdditionalSigners && plannedEd25519Count > 1 && plannedEd25519.some((s) => s.weight >= plannedThresholds.high)) {
    warnings.push(t('common:multisigEdit.warning.singleSignerReachesHigh'));
  }

  // Risiken: nicht blockierend (Konfiguration ist gültig), aber vor dem Speichern
  // explizit zu bestätigen, weil sie zu einer Selbstaussperrung führen können.
  const risks = [];
  if (errors.length === 0) {
    const pk = defaultPublicKey ? String(defaultPublicKey).trim() : '';
    const currentMasterEntry = (currentAccount?.signers || []).find((s) => s?.key === pk);
    const currentMaster = currentMasterEntry ? clampByte(currentMasterEntry.weight) : 1;
    if (pk && plannedMaster === 0 && currentMaster > 0) {
      risks.push(t('common:multisigEdit.risk.masterDisabled'));
    }
    if (
      hasAdditionalSigners
      && plannedEd25519Count > 1
      && plannedThresholds.high > 0
      && plannedEd25519.some((s) => plannedEd25519Weight - s.weight < plannedThresholds.high)
    ) {
      risks.push(t('common:multisigEdit.risk.noRedundancy'));
    }
  }
  return { errors, warnings, risks };
}
