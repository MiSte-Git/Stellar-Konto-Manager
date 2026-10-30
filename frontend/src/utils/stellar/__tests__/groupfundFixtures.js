// Testdaten im Format von Horizon. Operations-IDs wie im Netz (TOID): Ledger in den oberen
// 32 Bit, darunter 20 Bit Transaktion und 12 Bit Operation.
export const G = 'GBWUWAQ26NG72VHQAM73A2FF7KRJ4HXUDHW556D2UEUGAVPMWDRBJINQ';
export const SENDER_A = 'GAA3CBTLHR6TBT7TSRIMFZV5SHH5T3IGNFG3EMPQP5TGS2BQIFCJKCKW';
export const SENDER_B = 'GCWB3T4MQEGXN6SYLRS35IRQSBA7P5GKYVGXNAJQXM6WIRVIIY6SXDJL';
export const TARGET = 'GBLQN5HQ25YCHWK4IAP5NMXFMRJQFHVFHP5UXSS6GXDLL3W4GOTV5GDG';
export const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
export const MUX_ID = '18446744073709551615'; // uint64-Maximum, als Number nicht darstellbar

export const opId = (ledger, index = 1, txIndex = 1) => ((BigInt(ledger) << 32n) + (BigInt(txIndex) << 12n) + BigInt(index)).toString();
export const effectId = (id, index = 1) => `${id.padStart(19, '0')}-${String(index).padStart(10, '0')}`;
export const timeOf = (ledger) => `2026-10-${String(10 + Math.floor(ledger / 100)).padStart(2, '0')}T${String(ledger % 24).padStart(2, '0')}:00:00Z`;

// Wie das SDK: transaction ist eine Lazy-Funktion, die Join-Daten stehen in transaction_attr.
export function payment(ledger, { transaction, ...fields } = {}, hasTx = true) {
  const id = opId(ledger, fields.index ?? 1, fields.txIndex ?? 1);
  const attr = transaction || (hasTx ? { memo: fields.memo, memo_type: fields.memo ? 'text' : 'none' } : null);
  return {
    id,
    paging_token: id,
    type: 'payment',
    from: SENDER_A,
    to: G,
    amount: '1.0000000',
    asset_type: 'native',
    created_at: timeOf(ledger),
    transaction_hash: `tx${id}`,
    transaction_successful: true,
    transaction: async () => attr,
    ...(attr ? { transaction_attr: attr } : {}),
    ...fields,
  };
}

export function effect(ledger, type, amount, fields = {}) {
  return {
    id: effectId(opId(ledger, fields.index ?? 1, fields.txIndex ?? 1), fields.effectIndex ?? 1),
    type,
    account: G,
    amount,
    asset_type: 'native',
    created_at: timeOf(ledger),
    ...fields,
  };
}
