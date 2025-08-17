// progress.js
/**
 * Kleines Hilfsobjekt für ETA-Schätzung über bewegten Durchschnitt.
 * @returns {{tick: (n: number)=>{etaMs:number}, reset: ()=>void}}
 */
export function makeEta() {
  let lastTs = Date.now(), total = 0, lastTotal = 0, speed = 0;
  return {
    reset(){ lastTs = Date.now(); total = 0; lastTotal = 0; speed = 0; },
    tick(n){
      const now = Date.now();
      total += n;
      const dt = (now - lastTs) / 1000;
      if (dt >= 0.8) { // glätten
        const inst = (total - lastTotal) / dt;
        speed = speed ? (speed*0.6 + inst*0.4) : inst;
        lastTotal = total; lastTs = now;
      }
      const etaMs = speed > 0 ? Math.max(0, (n - total) / speed) * 1000 : 0;
      return { etaMs: Math.round(etaMs) };
    }
  };
}
