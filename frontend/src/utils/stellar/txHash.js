// Transaktions-Hash als Hex, unabhaengig von der SDK-Version.
//
// Bis stellar-sdk v16 liefert tx.hash() einen Node-Buffer, ab v17 ein reines Uint8Array.
// Uint8Array.prototype.toString ignoriert das 'hex'-Argument und liefert "12,34,..." - ein
// tx.hash().toString('hex') wuerde nach dem SDK-Update ohne Fehlermeldung falsche Hashes
// erzeugen. Diese Umwandlung funktioniert fuer beide, da Buffer ein Uint8Array ist.

/** @param {Uint8Array} bytes @returns {string} */
export function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytesToHex: Uint8Array erwartet');
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** @param {{ hash(): Uint8Array }} tx @returns {string} 64 Zeichen Hex, klein */
export function txHashHex(tx) {
  return bytesToHex(tx.hash());
}
