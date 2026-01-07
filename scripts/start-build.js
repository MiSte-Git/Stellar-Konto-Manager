#!/usr/bin/env node
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const root = path.resolve(process.cwd());
const isWindows = process.platform === "win32";
const cmdExe = process.env.ComSpec || process.env.comspec || "cmd.exe";

function npmCmd() {
  return isWindows ? "npm.cmd" : "npm";
}

function quoteForCmd(value) {
  if (value === "") {
    return '""';
  }

  if (!/[ \t"&^|<>]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function spawnPortable(command, args, options = {}) {
  if (isWindows && options.shell === true) {
    const joined = [command, ...args].map(quoteForCmd).join(" ");
    return spawn(cmdExe, ["/d", "/s", "/c", joined], {
      ...options,
      windowsVerbatimArguments: true,
      shell: false,
    });
  }

  return spawn(command, args, options);
}

function spawnPortableSync(command, args, options = {}) {
  if (isWindows && options.shell === true) {
    const joined = [command, ...args].map(quoteForCmd).join(" ");
    return spawnSync(cmdExe, ["/d", "/s", "/c", joined], {
      ...options,
      windowsVerbatimArguments: true,
      shell: false,
    });
  }

  return spawnSync(command, args, options);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnPortable(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return spawnPortableSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  dotenv.config({ path: filePath });
}

function checkNodeAndNpm() {
  const expected = parseInt(process.env.NODE_VERSION, 10);
  const actual = parseInt(process.versions.node.split(".")[0], 10);

  if (!Number.isNaN(expected) && expected !== actual) {
    console.error(`Expected Node.js version ${expected}, but found ${actual}.`);
    process.exit(1);
  }

  const npmVersion = runCapture(npmCmd(), ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (npmVersion.status !== 0) {
    console.error("npm is required but was not found.");
    process.exit(1);
  }
}

function resolveEnv(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

function cleanDist(distPath) {
  if (!fs.existsSync(distPath)) {
    return;
  }

  for (const entry of fs.readdirSync(distPath)) {
    const entryPath = path.join(distPath, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function isGitRepo(cwd) {
  const result = runCapture("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && String(result.stdout).trim() === "true";
}

function countGermanLocaleChanges(cwd) {
  if (!isGitRepo(cwd)) {
    return 0;
  }

  const result = runCapture(
    "git",
    ["status", "--porcelain", "--", "frontend/src/locales/de"],
    { cwd, stdio: ["ignore", "pipe", "ignore"] }
  );
  if (result.status !== 0) {
    return 0;
  }

  return String(result.stdout)
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

async function main() {
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, "backend", ".env"));

  checkNodeAndNpm();

  if (process.env.PROD_API_URL && !process.env.VITE_BACKEND_URL) {
    process.env.VITE_BACKEND_URL = process.env.PROD_API_URL;
  }

  process.env.I18N_AUTO_SYNC = resolveEnv(process.env.I18N_AUTO_SYNC, "1");
  process.env.I18N_ENFORCE = resolveEnv(process.env.I18N_ENFORCE, "1");
  process.env.I18N_PY_SYNC = resolveEnv(process.env.I18N_PY_SYNC, "");
  process.env.BASE_REF = resolveEnv(process.env.BASE_REF, "origin/main");
  process.env.I18N_ENFORCE_FORCE = resolveEnv(
    process.env.I18N_ENFORCE_FORCE,
    "0"
  );

  const frontendDir = path.join(root, "frontend");
  if (!fs.existsSync(frontendDir)) {
    console.error(`Frontend directory not found at: ${frontendDir}`);
    process.exit(1);
  }

  const baseRef = process.env.BASE_REF;
  const deChanges = countGermanLocaleChanges(root);
  const deChangesFound = deChanges !== 0;

  if (process.env.I18N_AUTO_SYNC === "1") {
    const pySync = process.env.I18N_PY_SYNC;
    if (pySync && fs.existsSync(pySync) && deChangesFound) {
      const pyExec = spawnPortableSync("python3", ["--version"], {
        stdio: "ignore",
      }).status === 0
        ? "python3"
        : "python";
      await run(pyExec, [pySync], { cwd: root });
    }

    await run(
      npmCmd(),
      ["run", "i18n:ack"],
      {
        cwd: frontendDir,
        env: { ...process.env, BASE_REF: baseRef },
        shell: false,
      }
    );
  }

  if (
    process.env.I18N_ENFORCE === "1" &&
    (deChangesFound || process.env.I18N_ENFORCE_FORCE === "1")
  ) {
    const nodeExec = process.execPath;
    await run(nodeExec, ["scripts/i18n_stale_check.mjs"], {
      cwd: root,
      env: { ...process.env, BASE_REF: baseRef },
    });
    await run(nodeExec, ["scripts/i18n_phase2_ack.mjs"], {
      cwd: root,
      env: { ...process.env, BASE_REF: baseRef },
    });
  }

  cleanDist(path.join(frontendDir, "dist"));

  await run(npmCmd(), ["run", "build"], {
    cwd: frontendDir,
    env: process.env,
    shell: false,
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
