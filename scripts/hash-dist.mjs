// Beschreibt: Erstellt SHA256SUMS (sha256sum-Format) für alle Dateien in frontend/dist.
import { createHash } from "crypto";
import { readdirSync, statSync, createReadStream, writeFileSync } from "fs";
import { join, relative } from "path";

const dist = "frontend/dist";
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk(dist);

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const s = createReadStream(file);
    s.on("data", (d) => hash.update(d));
    s.on("end", () => resolve(hash.digest("hex")));
    s.on("error", reject);
  });
}

const lines = await Promise.all(files.map(async (f) => {
  const h = await sha256(f);
  const rel = relative(dist, f);
  return `${h}  ${rel}`;
}));

writeFileSync(join(dist, "SHA256SUMS"), lines.join("\n") + "\n");
console.log("[hash] SHA256SUMS created with", files.length, "entries.");
