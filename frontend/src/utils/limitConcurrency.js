// Fuehrt worker(item) fuer alle items aus, hoechstens `limit` gleichzeitig.
// isCancelled() wird vor jedem neuen Eintrag geprueft (laufende Aufrufe laufen zu Ende).
export async function runLimited(items, worker, { limit = 4, isCancelled = () => false } = {}) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length && !isCancelled()) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}
