// Deploy-Schritt vendor/ (scripts/deploy-cyon.js, deployVendor): Vergleich, Entscheidung
// ueberspringen/tauschen, Dry-Run ohne Schreibzugriff, Ruecktausch bei Fehler. Ohne Server: Die
// ops (Composer, ssh, rsync, Health-Check) sind Attrappen, die jeden Aufruf mitschreiben.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decideVendorAction, deployVendor, remoteCommands, vendorLogValue } = require("../scripts/deploy-cyon.js");

const LOCAL = "a".repeat(64);
const OTHER = "b".repeat(64);

// Aufrufe, die auf dem Server schreiben
const WRITE_CALLS = new Set(["rsync", "swap", "rollback", "cleanupOld"]);

function fakeOps(overrides = {}) {
  const calls = [];
  const record = (name, value) => (...args) => {
    calls.push(args.length ? `${name}:${JSON.stringify(args[0])}` : name);
    return typeof value === "function" ? value(...args) : value;
  };
  const ops = {
    composerInstall: record("composerInstall"),
    localHash: record("localHash", LOCAL),
    remoteHash: record("remoteHash", OTHER),
    rsyncVendor: (opts) => {
      calls.push(opts.dryRun ? "rsyncDryRun" : "rsync");
      return overrides.rsyncVendor ? overrides.rsyncVendor(opts) : [">f+++++++++ guzzlehttp/guzzle/src/Client.php"];
    },
    swap: record("swap"),
    checkRemote: record("checkRemote", true),
    healthCheck: record("healthCheck", async () => true),
    rollback: record("rollback"),
    cleanupOld: record("cleanupOld"),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "rsyncVendor") continue;
    ops[key] = (...args) => {
      calls.push(key);
      return value(...args);
    };
  }
  return { ops, calls };
}

test("decideVendorAction: gleich ueberspringen, abweichend oder fehlend tauschen", () => {
  assert.equal(decideVendorAction(LOCAL, LOCAL), "skip");
  assert.equal(decideVendorAction(LOCAL, OTHER), "swap");
  assert.equal(decideVendorAction(LOCAL, null), "swap");
});

test("vendorLogValue: Zustand mit gekuerztem Hash", () => {
  assert.equal(vendorLogValue("swapped", LOCAL), `swapped:${"a".repeat(12)}`);
  assert.equal(vendorLogValue("skipped", null), "skipped:?");
});

test("prepare: gleicher Hash, kein rsync, kein Schreibzugriff", async () => {
  const { ops, calls } = fakeOps({ remoteHash: () => LOCAL });
  const plan = await deployVendor(ops).prepare();
  assert.equal(plan.action, "skip");
  assert.deepEqual(calls, ["composerInstall", "localHash", "remoteHash"]);
});

test("prepare: composer install zuerst, Fehler bricht vor jedem Serverzugriff ab", async () => {
  const { ops, calls } = fakeOps({
    composerInstall: () => {
      throw new Error("[deploy] composer install beendet mit Code 1");
    },
  });
  await assert.rejects(deployVendor(ops).prepare(), /composer install/);
  assert.deepEqual(calls, ["composerInstall"]);
});

test("prepare (auch fuer --dry-run): abweichend nur Vergleich und rsync --dry-run, kein Schreibzugriff", async () => {
  const { ops, calls } = fakeOps();
  const plan = await deployVendor(ops).prepare();
  assert.equal(plan.action, "swap");
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(calls, ["composerInstall", "localHash", "remoteHash", "rsyncDryRun"]);
  assert.ok(!calls.some((c) => WRITE_CALLS.has(c)));
});

test("prepare: installed.json fehlt auf dem Server, wie abweichend", async () => {
  const { ops } = fakeOps({ remoteHash: () => null });
  const plan = await deployVendor(ops).prepare();
  assert.equal(plan.action, "swap");
  assert.equal(plan.remoteHash, null);
});

test("apply: Erfolg in fester Reihenfolge, vendor_old wird geloescht", async () => {
  const { ops, calls } = fakeOps();
  const step = deployVendor(ops);
  const plan = await step.prepare();
  calls.length = 0;
  assert.equal(await step.apply(plan), vendorLogValue("swapped", LOCAL));
  assert.deepEqual(calls, ["rsync", "swap", "checkRemote", "healthCheck", "cleanupOld"]);
});

test("apply: bei skip passiert nichts", async () => {
  const { ops, calls } = fakeOps({ remoteHash: () => LOCAL });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  calls.length = 0;
  assert.equal(await step.apply(plan), vendorLogValue("unchanged", LOCAL));
  assert.deepEqual(calls, []);
});

test("apply: PHP-CLI-Pruefung scheitert, Ruecktausch, kein Health-Check, kein Aufraeumen", async () => {
  const { ops, calls } = fakeOps({ checkRemote: () => false });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  calls.length = 0;
  await assert.rejects(step.apply(plan), (error) => {
    assert.match(error.message, /zurueckgetauscht/);
    assert.equal(error.vendorLog, vendorLogValue("rolledback", LOCAL));
    return true;
  });
  assert.deepEqual(calls, ["rsync", "swap", "checkRemote", "rollback"]);
});

test("apply: Health-Check scheitert, Ruecktausch", async () => {
  const { ops, calls } = fakeOps({ healthCheck: async () => false });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  calls.length = 0;
  await assert.rejects(step.apply(plan), /zurueckgetauscht/);
  assert.deepEqual(calls, ["rsync", "swap", "checkRemote", "healthCheck", "rollback"]);
});

test("apply: Fehler beim Pruefen selbst (ssh) zaehlt wie fehlgeschlagene Pruefung", async () => {
  const { ops, calls } = fakeOps({
    checkRemote: () => {
      throw new Error("[deploy] ssh nicht ausfuehrbar");
    },
  });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  calls.length = 0;
  await assert.rejects(step.apply(plan), /zurueckgetauscht/);
  assert.deepEqual(calls, ["rsync", "swap", "checkRemote", "rollback"]);
});

test("apply: Ruecktausch scheitert, eigene Meldung mit Hinweis auf den Server", async () => {
  const { ops } = fakeOps({
    checkRemote: () => false,
    rollback: () => {
      throw new Error("mv: cannot move");
    },
  });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  await assert.rejects(step.apply(plan), (error) => {
    assert.match(error.message, /Ruecktausch fehlgeschlagen/);
    assert.equal(error.vendorLog, vendorLogValue("rollbackFailed", LOCAL));
    return true;
  });
});

test("apply: Upload oder Tausch scheitert, kein Ruecktausch (laufendes vendor unveraendert)", async () => {
  for (const failing of ["rsync", "swap"]) {
    const { ops, calls } = fakeOps(
      failing === "rsync"
        ? { rsyncVendor: ({ dryRun }) => { if (!dryRun) throw new Error("rsync beendet mit Code 23"); return ["x"]; } }
        : { swap: () => { throw new Error("ssh beendet mit Code 1"); } }
    );
    const step = deployVendor(ops);
    const plan = await step.prepare();
    calls.length = 0;
    await assert.rejects(step.apply(plan), (error) => error.vendorLog === vendorLogValue("failed", LOCAL));
    assert.ok(!calls.includes("rollback"), failing);
    assert.ok(!calls.includes("cleanupOld"), failing);
  }
});

test("apply: Aufraeumen scheitert, Deploy bleibt erfolgreich", async () => {
  const { ops } = fakeOps({
    cleanupOld: () => {
      throw new Error("rm failed");
    },
  });
  const step = deployVendor(ops);
  const plan = await step.prepare();
  assert.equal(await step.apply(plan), vendorLogValue("swapped", LOCAL));
});

test("Serverbefehle: Tausch nie ohne vendor, Ruecktausch stellt vendor_old wieder her", () => {
  const swap = remoteCommands.swap();
  assert.match(swap, /\[ -d vendor_next \]/);
  assert.match(swap, /if ! mv vendor_next vendor; then if \[ -d vendor_old \]; then mv vendor_old vendor; fi; exit 1; fi/);
  assert.match(remoteCommands.rollback(), /mv vendor vendor_next && if \[ -d vendor_old \]; then mv vendor_old vendor; fi/);
  assert.match(remoteCommands.cleanupOld(), /rm -rf vendor_old$/);
  assert.match(remoteCommands.hash(), /vendor\/composer\/installed\.json/);
  assert.match(remoteCommands.hash(), /echo MISSING/);
});

test("Serverbefehle: PHP-CLI-Pruefung laedt autoload.php und beide Klassen", () => {
  const check = remoteCommands.check();
  assert.match(check, /require "vendor\/autoload\.php"/);
  assert.match(check, /class_exists\("Soneso\\\\StellarSDK\\\\StellarSDK"\)/);
  assert.match(check, /class_exists\("GuzzleHttp\\\\Client"\)/);
});

// Die Shell-Befehle laufen echt gegen ein Temp-Verzeichnis (sh lokal statt ssh).
test("Serverbefehle laufen: Tausch, Ruecktausch, Aufraeumen", () => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "skm-vendor-"));
  try {
    const api = path.join(base, "public_html", "SKM", "api");
    const mk = (dir, marker) => {
      fs.mkdirSync(path.join(api, dir), { recursive: true });
      fs.writeFileSync(path.join(api, dir, "marker"), marker);
    };
    const run = (cmd) => spawnSync("sh", ["-c", cmd], { cwd: base, encoding: "utf8" });
    const marker = (dir) => fs.readFileSync(path.join(api, dir, "marker"), "utf8");
    const exists = (dir) => fs.existsSync(path.join(api, dir));

    mk("vendor", "alt");
    mk("vendor_next", "neu");
    assert.equal(run(remoteCommands.swap()).status, 0);
    assert.equal(marker("vendor"), "neu");
    assert.equal(marker("vendor_old"), "alt");
    assert.ok(!exists("vendor_next"));

    assert.equal(run(remoteCommands.rollback()).status, 0);
    assert.equal(marker("vendor"), "alt");
    assert.equal(marker("vendor_next"), "neu");
    assert.ok(!exists("vendor_old"));

    // ohne vendor_next: Tausch bricht ab, vendor bleibt
    fs.rmSync(path.join(api, "vendor_next"), { recursive: true });
    assert.notEqual(run(remoteCommands.swap()).status, 0);
    assert.equal(marker("vendor"), "alt");

    // erneut tauschen und aufraeumen
    mk("vendor_next", "neu2");
    assert.equal(run(remoteCommands.swap()).status, 0);
    assert.equal(run(remoteCommands.cleanupOld()).status, 0);
    assert.equal(marker("vendor"), "neu2");
    assert.ok(!exists("vendor_old"));

    // erster Tausch ohne vorheriges vendor, Ruecktausch: wieder ohne vendor
    fs.rmSync(path.join(api, "vendor"), { recursive: true });
    mk("vendor_next", "erst");
    assert.equal(run(remoteCommands.swap()).status, 0);
    assert.equal(marker("vendor"), "erst");
    assert.equal(run(remoteCommands.rollback()).status, 0);
    assert.ok(!exists("vendor"));
    assert.equal(marker("vendor_next"), "erst");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Hash-Befehl laeuft: sha256 vorhanden, MISSING ohne Datei", () => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "skm-vendor-"));
  try {
    const run = () => spawnSync("sh", ["-c", remoteCommands.hash()], { cwd: base, encoding: "utf8" }).stdout.trim();
    assert.equal(run(), "MISSING");
    const file = path.join(base, "public_html", "SKM", "api", "vendor", "composer", "installed.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"packages":[]}');
    assert.equal(run(), crypto.createHash("sha256").update('{"packages":[]}').digest("hex"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("api.rsync-filter: vendor, vendor_next und vendor_old nie im normalen api-Upload", () => {
  const filter = fs.readFileSync(path.join(__dirname, "..", "scripts", "deploy", "api.rsync-filter"), "utf8");
  for (const dir of ["/vendor/", "/vendor_next/", "/vendor_old/"]) {
    assert.ok(filter.split("\n").includes(`- ${dir}`), dir);
  }
});
