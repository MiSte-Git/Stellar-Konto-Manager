// Beschreibt: Erzeugt build-info.json mit Commit/Branch/Buildzeit/ENV/Horizon/Backend.
// Datei wird in frontend/dist/build-info.json geschrieben.
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const commit = process.env.GIT_COMMIT || execSync("git rev-parse HEAD").toString().trim();
const branch = process.env.GIT_REF || execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
const date = new Date().toISOString();
const node = process.version;

const info = {
  app: "stellar-trustline-manager",
  commit,
  branch,
  builtAt: date,
  node,
  environment: process.env.VITE_ENV || "staging",
  horizonUrl: process.env.VITE_HORIZON_URL || null,
  backendUrl: process.env.VITE_BACKEND_URL || null
};

writeFileSync("frontend/dist/build-info.json", JSON.stringify(info, null, 2));
console.log("[build-info] written to frontend/dist/build-info.json");
