// Local store for muxed accounts per base G-address (localStorage)
// v3 structure separates data by network to avoid mixing PUBLIC/TESTNET
// Structure v3: { [network]: { [basePublicKey]: Array<{ id: string, address: string, createdAt: string, label?: string, note?: string }> } }

import { buildMuxedAddress } from './muxed.js';

const STORAGE_KEY = 'muxedAccounts_v3';

function _getNet(explicitNet) {
  try {
    const n = explicitNet || window.localStorage.getItem('STM_NETWORK') || 'PUBLIC';
    const resolved = n === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
    try { console.debug('[muxedStore._getNet]', { explicitNet, stored: n, resolved }); } catch { /* noop */ }
    return resolved;
  } catch {
    return 'PUBLIC';
  }
}

function _loadAll() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function _saveAll(map) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore write errors
  }
}

// listMuxed(publicKey, net?)
// Returns numerically sorted list of entries for this publicKey (ascending by muxedId)
export function listMuxed(publicKey, net) {
  if (!publicKey) return [];
  const network = _getNet(net);
  const all = _loadAll();
  const perNet = all[network] || {};
  const arr = perNet[publicKey] || [];
  try { console.debug('[muxedStore.listMuxed]', { publicKey, network, count: Array.isArray(arr) ? arr.length : 0 }); } catch { /* noop */ }
  if (!Array.isArray(arr)) return [];
  return [...arr].sort((a, b) => {
    try {
      const ai = BigInt(a.id);
      const bi = BigInt(b.id);
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    } catch {
      // Fallback to string compare if BigInt fails
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
    }
    return 0;
  });
}

// addMuxed(publicKey, { id, address, label, note }, net?)
// Adds or updates an entry. If ID exists, it is overwritten but createdAt stays stable.
export function addMuxed(publicKey, { id, address, label, note }, net) {
  if (!publicKey) return;
  const network = _getNet(net);
  const all = _loadAll();
  const perNet = all[network] || {};
  const list = perNet[publicKey] || [];

  const idx = list.findIndex((e) => String(e.id) === String(id));
  const nowIso = new Date().toISOString();

  if (idx >= 0) {
    // update existing, keep createdAt stable
    list[idx] = {
      id: String(id),
      address: String(address),
      createdAt: list[idx].createdAt || nowIso,
      label: label !== undefined ? String(label) : (list[idx].label || ''),
      note: note !== undefined ? String(note) : (list[idx].note || ''),
    };
  } else {
    // add new
    list.push({
      id: String(id),
      address: String(address),
      createdAt: nowIso,
      label: label ? String(label) : '',
      note: note ? String(note) : '',
    });
  }

  perNet[publicKey] = list;
  all[network] = perNet;
  _saveAll(all);
  try { console.debug('[muxedStore.addMuxed]', { publicKey, network, id: String(id), address: String(address), label, note, total: list.length }); } catch { /* noop */ }
  return perNet[publicKey];
}

// removeMuxed(publicKey, ids[], net?)
// Delete all entries with an ID in ids
export function removeMuxed(publicKey, ids, net) {
  if (!publicKey) return { removed: 0 };
  const network = _getNet(net);
  const idSet = new Set((ids || []).map(String));
  const all = _loadAll();
  const perNet = all[network] || {};
  const list = perNet[publicKey] || [];
  const before = list.length;
  const next = list.filter((e) => !idSet.has(String(e.id)));
  perNet[publicKey] = next;
  all[network] = perNet;
  _saveAll(all);
  const removed = before - next.length;
  try { console.debug('[muxedStore.removeMuxed]', { publicKey, network, ids: Array.from(idSet), removed, totalAfter: next.length }); } catch { /* noop */ }
  return { removed };
}

// exportMuxedCsv(publicKey, filename, net?)
// Build and download a CSV for entries of this publicKey
// Columns: basePublicKey, muxedId, muxedAddress, label, note, createdAt
export function exportMuxedCsv(publicKey, filename = 'muxed_accounts.csv', net) {
  if (!publicKey) return;
  const network = _getNet(net);
  const rows = listMuxed(publicKey, network);
  try { console.debug('[muxedStore.exportMuxedCsv]', { publicKey, network, count: rows.length, filename }); } catch { /* noop */ }

  const headers = [
    'network',
    'basePublicKey',
    'muxedId',
    'muxedAddress',
    'label',
    'note',
    'createdAt',
  ];

  function esc(v) {
    if (v === undefined || v === null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = [];
  lines.push(headers.join(','));
  for (const r of rows) {
    lines.push([
      esc(network),
      esc(publicKey),
      esc(r.id),
      esc(r.address),
      esc(r.label || ''),
      esc(r.note || ''),
      esc(r.createdAt || ''),
    ].join(','));
  }

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

// importMuxedCsvText(publicKey, csvText, net?)
// Import CSV rows for the given publicKey and current network.
// Accepts the same columns as export. Only rows with matching network+basePublicKey are imported.
// Address is recomputed from basePublicKey + muxedId to ensure integrity.
export function importMuxedCsvText(publicKey, csvText, net) {
  const result = { imported: 0, skipped: 0, errors: 0 };
  if (!publicKey || !csvText) return result;
  const network = _getNet(net);
  try { console.debug('[muxedStore.importMuxedCsvText] start', { publicKey, network, size: csvText.length }); } catch { /* noop */ }

  function parseCsv(text) {
    const rows = [];
    let i = 0;
    const len = text.length;
    let cur = [];
    let field = '';
    let inQuotes = false;

    function endField() { cur.push(field); field = ''; }
    function endRow() { rows.push(cur); cur = []; }

    while (i < len) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        } else {
          field += ch; i++; continue;
        }
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { endField(); i++; continue; }
        if (ch === '\n') { endField(); endRow(); i++; continue; }
        if (ch === '\r') { i++; continue; }
        field += ch; i++;
      }
    }
    endField();
    if (cur.length > 0) endRow();
    return rows;
  }

  let data;
  try {
    data = parseCsv(csvText);
  } catch {
    result.errors += 1;
    return result;
  }
  if (!data || data.length === 0) { result.skipped += 1; return result; }

  const headers = (data[0] || []).map((h) => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);
  const iNet = idx('network');
  const iBase = idx('basePublicKey');
  const iId = idx('muxedId');
  const iLabel = idx('label');
  const iNote = idx('note');
  const iCreated = idx('createdAt');

  if (iNet < 0 || iBase < 0 || iId < 0) { result.errors += 1; return result; }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.length === 0) { result.skipped++; continue; }
    const rowNet = String(row[iNet] || '').trim();
    const rowBase = String(row[iBase] || '').trim();
    const rowId = String(row[iId] || '').trim();
    if (!rowNet || !rowBase || !rowId) { result.skipped++; continue; }
    if (rowNet !== network || rowBase !== publicKey) { result.skipped++; continue; }

    const label = iLabel >= 0 ? String(row[iLabel] || '') : '';
    const note = iNote >= 0 ? String(row[iNote] || '') : '';
    const createdAt = iCreated >= 0 ? String(row[iCreated] || '') : '';

    let address;
    try {
      address = buildMuxedAddress(publicKey, rowId);
    } catch {
      result.skipped++; continue;
    }

    try {
      const current = listMuxed(publicKey, network);
      const exists = current.find((e) => String(e.id) === rowId);
      addMuxed(publicKey, { id: rowId, address, label, note }, network);
      if (!exists && createdAt) {
        const all = _loadAll();
        const perNet = all[network] || {};
        const list = perNet[publicKey] || [];
        const idxEntry = list.findIndex((e) => String(e.id) === rowId);
        if (idxEntry >= 0) {
          list[idxEntry].createdAt = createdAt;
          perNet[publicKey] = list;
          all[network] = perNet;
          _saveAll(all);
        }
      }
      result.imported++;
    } catch {
      result.errors++;
    }
  }

  return result;
}
