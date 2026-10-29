// Gemeinsame Fehlerklassifizierung fuer die Liquidity-Pool-Hooks:
// 404 bedeutet "gibt es nicht" (neutraler Hinweis), alles andere ist ein
// Lade-/Netzwerkfehler (erneut versuchen).
export function isHorizonNotFound(err) {
  return err?.response?.status === 404 || err?.name === 'NotFoundError';
}
