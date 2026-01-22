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
  const warnings = [];
  if (plannedThresholds.high > 0 && plannedEd25519Count === 1) {
    warnings.push(t('common:multisigEdit.warning.highSingleSigner'));
  }
  if (plannedThresholds.med > 0 && plannedEd25519Count === 1) {
    warnings.push(t('common:multisigEdit.warning.medSingleSigner'));
  }
  return { errors, warnings };
}
