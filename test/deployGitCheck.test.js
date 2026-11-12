// Deploy-Guard: Abbruch bei HEAD != origin/main nennt die naechste Handlung (git push, git pull, auseinandergelaufen).
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkGit, describeHeadMismatch } = require("../scripts/deploy-cyon.js");

const H = "a".repeat(40);
const R = "b".repeat(40);

test("nur lokal voraus: Hinweis git push mit Anzahl", () => {
  const one = describeHeadMismatch({ head: H, remote: R, ahead: 1, behind: 0 });
  assert.match(one, /Noch nicht gepusht/);
  assert.match(one, /1 Commit liegt nur lokal/);
  assert.match(one, /git push/);
  assert.match(describeHeadMismatch({ head: H, remote: R, ahead: 3, behind: 0 }), /3 Commits liegen nur lokal/);
});

test("nur origin voraus: Hinweis git pull", () => {
  const msg = describeHeadMismatch({ head: H, remote: R, ahead: 0, behind: 2 });
  assert.match(msg, /Lokal veraltet/);
  assert.match(msg, /2 neuere Commits/);
  assert.match(msg, /git pull/);
  assert.doesNotMatch(msg, /git push/);
});

test("auseinandergelaufen: beide Zahlen und pull --rebase", () => {
  const msg = describeHeadMismatch({ head: H, remote: R, ahead: 2, behind: 1 });
  assert.match(msg, /auseinandergelaufen/);
  assert.match(msg, /2 Commits nur lokal, 1 nur auf origin/);
  assert.match(msg, /git pull --rebase/);
});

test("Meldung enthaelt beide Kurz-Hashes", () => {
  const msg = describeHeadMismatch({ head: H, remote: R, ahead: 1, behind: 0 });
  assert.match(msg, /HEAD aaaaaaa, origin\/main bbbbbbb/);
});

function sh(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

test("checkGit mit echtem Repo: lokaler Commit ohne Push bricht mit Push-Hinweis ab, nach Push nicht mehr", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skm-deploy-git-"));
  try {
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    sh(dir, ["init", "--bare", "-b", "main", remote]);
    sh(dir, ["clone", "--quiet", remote, work]);
    sh(work, ["config", "user.email", "t@example.invalid"]);
    sh(work, ["config", "user.name", "Test"]);
    sh(work, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(work, "a.txt"), "1");
    sh(work, ["add", "a.txt"]);
    sh(work, ["commit", "--quiet", "-m", "eins"]);
    sh(work, ["push", "--quiet", "-u", "origin", "HEAD:main"]);
    assert.doesNotThrow(() => checkGit(work, { dryRun: false, fetch: true }));

    fs.writeFileSync(path.join(work, "a.txt"), "2");
    sh(work, ["commit", "--quiet", "-am", "zwei"]);
    assert.throws(() => checkGit(work, { dryRun: false, fetch: true }), /Noch nicht gepusht.*git push/);

    sh(work, ["push", "--quiet", "origin", "HEAD:main"]);
    assert.doesNotThrow(() => checkGit(work, { dryRun: false, fetch: true }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
