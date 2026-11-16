<?php
// Lightweight, dependency-free test script for api/challengeStore.php (mirrors
// test/challengeStore.test.js for the Node backend). This project has no
// PHPUnit/test framework for the PHP side, so this follows the same
// minimal-tooling approach already used throughout api/*.php (plain PHP,
// no extra Composer dev-dependencies) rather than introducing one just for
// this file.
//
// Run with: php test/challengeStore.test.php

declare(strict_types=1);

$tmpDir = sys_get_temp_dir() . '/skm-challengestore-test-' . bin2hex(random_bytes(4));
mkdir($tmpDir, 0775, true);
putenv('CHALLENGES_FILE_PATH=' . $tmpDir . '/challenges.json');

require __DIR__ . '/../api/challengeStore.php';

use Soneso\StellarSDK\Crypto\KeyPair;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n"; // ✔
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n"; // ✘
    }
}

// Signiert wie das Frontend: "skm:<purpose>:" plus Nonce. $purpose null signiert die
// rohe Nonce (altes Format, muss abgelehnt werden).
function signNonce(KeyPair $keypair, string $challengeB64, ?string $purpose = 'token'): string {
    $nonce = base64_decode($challengeB64, true);
    return base64_encode($keypair->sign($purpose === null ? $nonce : 'skm:' . $purpose . ':' . $nonce));
}

// --- createChallenge ---------------------------------------------------
$before = time();
$c1 = createChallenge('job-1', 'GSIGNER1');
check('createChallenge returns a non-empty base64 challenge', is_string($c1['challenge']) && strlen($c1['challenge']) > 0);
$decoded = base64_decode($c1['challenge'], true);
check('createChallenge nonce decodes to 32 raw bytes', $decoded !== false && strlen($decoded) === 32);
check('createChallenge expiresAt is ~60s in the future', $c1['expiresAt'] >= $before + 59 && $c1['expiresAt'] <= $before + 61);

// --- consumeChallenge: single-use --------------------------------------
$c2 = createChallenge('job-2', 'GSIGNER2');
$first = consumeChallenge('job-2', 'GSIGNER2', $c2['challenge']);
check('consumeChallenge returns the nonce on first call', $first !== null && $first['nonce'] === $c2['challenge']);
$second = consumeChallenge('job-2', 'GSIGNER2', $c2['challenge']);
check('consumeChallenge returns null on second call (single-use)', $second === null);

// --- consumeChallenge: unknown pair -------------------------------------
check(
    'consumeChallenge returns null for a pair that never requested a challenge',
    consumeChallenge('never-requested-job', 'GNOBODY', base64_encode(str_repeat("\0", 32))) === null
);

// --- ohne Nonce wird nichts verbraucht ------------------------------------
$c3 = createChallenge('job-3', 'GSIGNER3')['challenge'];
check('consumeChallenge ohne Nonce verbraucht nichts', consumeChallenge('job-3', 'GSIGNER3', null) === null);
check('die offene Challenge bleibt danach einloesbar', (consumeChallenge('job-3', 'GSIGNER3', $c3)['nonce'] ?? '') === $c3);

// --- keine Ueberschreibung mehr --------------------------------------------
$jobId3 = 'job-3b';
$signer3 = 'GSIGNER3';
$firstChallenge = createChallenge($jobId3, $signer3)['challenge'];
$secondChallenge = createChallenge($jobId3, $signer3)['challenge'];
check('requesting a new challenge produces a different nonce', $firstChallenge !== $secondChallenge);
check('die erste Challenge bleibt nach einer zweiten gueltig', (consumeChallenge($jobId3, $signer3, $firstChallenge)['nonce'] ?? '') === $firstChallenge);
check('die zweite Challenge ebenfalls', (consumeChallenge($jobId3, $signer3, $secondChallenge)['nonce'] ?? '') === $secondChallenge);

// --- expiry ---------------------------------------------------------------
$c4 = createChallenge('job-4', 'GSIGNER4', -1); // already expired the instant it's created
check('consumeChallenge treats an expired challenge as absent', consumeChallenge('job-4', 'GSIGNER4', $c4['challenge']) === null);

// --- verifyChallengeSignature: genuine signature --------------------------
$kp5 = KeyPair::random();
$c5 = createChallenge('job-5', $kp5->getAccountId());
$sig5 = signNonce($kp5, $c5['challenge']);
check(
    'verifyChallengeSignature accepts a genuine signature from the claimed keypair',
    verifyChallengeSignature($c5['challenge'], $sig5, $kp5->getAccountId(), 'token') === true
);

// --- verifyChallengeSignature: wrong signer -------------------------------
$owner = KeyPair::random();
$impostor = KeyPair::random();
$c6 = createChallenge('job-6', $owner->getAccountId());
$sig6 = signNonce($impostor, $c6['challenge']); // signed with the wrong key
check(
    'verifyChallengeSignature rejects a signature produced by a different keypair',
    verifyChallengeSignature($c6['challenge'], $sig6, $owner->getAccountId(), 'token') === false
);

// --- verifyChallengeSignature: tampered nonce -----------------------------
$kp7 = KeyPair::random();
$c7 = createChallenge('job-7', $kp7->getAccountId());
$sig7 = signNonce($kp7, $c7['challenge']);
$tamperedChallenge = base64_encode('completely different 32 byte value!!');
check(
    'verifyChallengeSignature rejects a signature over tampered nonce data',
    verifyChallengeSignature($tamperedChallenge, $sig7, $kp7->getAccountId(), 'token') === false
);

// --- Zweckbindung: Rohsignatur, leerer Zweck, token vs. decline ------------
$kp9 = KeyPair::random();
$c9 = createChallenge('job-9', $kp9->getAccountId())['challenge'];
$raw9 = signNonce($kp9, $c9, null);
check(
    'verifyChallengeSignature rejects the raw nonce signature (no purpose prefix)',
    verifyChallengeSignature($c9, $raw9, $kp9->getAccountId(), 'token') === false
        && verifyChallengeSignature($c9, $raw9, $kp9->getAccountId(), 'decline') === false
);
check(
    'verifyChallengeSignature with empty purpose is always false',
    verifyChallengeSignature($c9, $raw9, $kp9->getAccountId(), '') === false
        && verifyChallengeSignature($c9, signNonce($kp9, $c9, ''), $kp9->getAccountId(), '') === false
);
check(
    'verifyChallengeSignature keeps token and decline signatures apart',
    verifyChallengeSignature($c9, signNonce($kp9, $c9, 'decline'), $kp9->getAccountId(), 'token') === false
        && verifyChallengeSignature($c9, signNonce($kp9, $c9, 'token'), $kp9->getAccountId(), 'decline') === false
        && verifyChallengeSignature($c9, signNonce($kp9, $c9, 'decline'), $kp9->getAccountId(), 'decline') === true
);
$noPurpose = false;
try {
    verifyChallengeSignature($c9, $raw9, $kp9->getAccountId());
} catch (\ArgumentCountError $e) {
    $noPurpose = true;
}
check('verifyChallengeSignature cannot be called without purpose', $noPurpose);

// --- verifyChallengeSignature: never throws on garbage --------------------
$garbageOk = true;
try {
    if (verifyChallengeSignature('not-valid-base64!!', 'also-not-base64!!', 'not-a-real-key', 'token') !== false) $garbageOk = false;
    if (verifyChallengeSignature('', '', '', '') !== false) $garbageOk = false;
} catch (\Throwable $e) {
    $garbageOk = false;
}
check('verifyChallengeSignature never throws on malformed input (garbage base64/pubkey)', $garbageOk);

// --- end-to-end handshake --------------------------------------------------
$jobId8 = 'job-8';
$kp8 = KeyPair::random();
$c8 = createChallenge($jobId8, $kp8->getAccountId());
$sig8 = signNonce($kp8, $c8['challenge']);
$pending8 = consumeChallenge($jobId8, $kp8->getAccountId(), $c8['challenge']);
check('end-to-end: challenge is still pending before redemption', $pending8 !== null);
check(
    'end-to-end: verifyChallengeSignature succeeds against the consumed nonce',
    $pending8 !== null && verifyChallengeSignature($pending8['nonce'], $sig8, $kp8->getAccountId(), 'token') === true
);
check(
    'end-to-end: replaying the same nonce after consumption fails closed',
    consumeChallenge($jobId8, $kp8->getAccountId(), $c8['challenge']) === null
);

// --- Gemeinsame Faelle (test/assets/challenge-cases.json, gleich in Node) ----
$cases = json_decode((string)file_get_contents(__DIR__ . '/assets/challenge-cases.json'), true);
foreach ($cases['scenarios'] as $si => $scenario) {
    $jobs = ['j1' => "fx{$si}-j1", 'j2' => "fx{$si}-j2"];
    $keys = ['S1' => KeyPair::random(), 'S2' => KeyPair::random()];
    $nonces = [];
    $ok = true;
    $detail = '';
    foreach ($scenario['steps'] as $i => $step) {
        $pk = $keys[$step['signer']]->getAccountId();
        if ($step['op'] === 'create') {
            $nonces[$step['nonce']] = createChallenge($jobs[$step['job']], $pk)['challenge'];
            continue;
        }
        $nonce = $nonces[$step['nonce']];
        $pending = consumeChallenge($jobs[$step['job']], $pk, $nonce);
        $outcome = 'missing';
        if ($pending !== null) {
            $signWith = $step['sign'] === 'valid' ? $keys[$step['signer']] : KeyPair::random();
            $outcome = verifyChallengeSignature($pending['nonce'], signNonce($signWith, $nonce), $pk, 'token') ? 'ok' : 'invalid_signature';
        }
        if ($outcome !== $step['expect']) {
            $ok = false;
            $detail .= ' [Schritt ' . ($i + 1) . ": {$outcome} statt {$step['expect']}]";
        }
    }
    check("Fixture: {$scenario['name']}{$detail}", $ok);
}
check(
    'Fixture: Grenzen stimmen mit den Konstanten ueberein',
    CHALLENGE_MAX_PER_SIGNER === $cases['limits']['perSigner'] && CHALLENGE_MAX_PER_JOB === $cases['limits']['perJob']
        && CHALLENGE_MAX_TOTAL === $cases['limits']['total'] && CHALLENGE_TTL_SECONDS === $cases['limits']['ttlSeconds']
        && CHALLENGE_NONCE_BYTES === $cases['limits']['nonceBytes']
);
$kpBody = KeyPair::random();
$cBody = createChallenge('fx-body', $kpBody->getAccountId())['challenge'];
foreach ($cases['bodyNonces'] as $c) {
    $value = !empty($c['omit']) ? null : $c['value'];
    check("Fixture: Nonce im Body \"{$c['label']}\" " . ($c['wellFormed'] ? 'wohlgeformt' : 'abgelehnt'), (parseChallengeNonce($value) !== null) === $c['wellFormed']);
    check("Fixture: Nonce im Body \"{$c['label']}\" verbraucht nichts", consumeChallenge('fx-body', $kpBody->getAccountId(), $value) === null);
}
check('Fixture: offene Challenge bleibt nach kaputten Nonces einloesbar', (consumeChallenge('fx-body', $kpBody->getAccountId(), $cBody)['nonce'] ?? '') === $cBody);
$cExp = createChallenge('fx-exp', 'GEXP', -1)['challenge'];
check('abgelaufene Nonce: fuer anderen Signer null', consumeChallenge('fx-exp', 'GANDERER', $cExp) === null);
check('abgelaufene Nonce: fuer den richtigen Signer null', consumeChallenge('fx-exp', 'GEXP', $cExp) === null);

// --- Obergrenzen (C2) -----------------------------------------------------
$capSigners = array_map(fn($i) => "GCAPJOB{$i}", range(0, CHALLENGE_MAX_PER_JOB));
$capNonces = array_map(fn($pk) => createChallenge('cap-job', $pk)['challenge'], $capSigners);
check('je Job hoechstens CHALLENGE_MAX_PER_JOB, die aelteste fliegt raus', consumeChallenge('cap-job', $capSigners[0], $capNonces[0]) === null);
$restOk = true;
foreach (array_slice($capSigners, 1, null, true) as $i => $pk) if (consumeChallenge('cap-job', $pk, $capNonces[$i]) === null) $restOk = false;
check('die uebrigen Challenges des Jobs bleiben offen', $restOk);

$reSigners = array_map(fn($i) => "GREJOB{$i}", range(0, CHALLENGE_MAX_PER_JOB - 1));
$reNonces = array_map(fn($pk) => createChallenge('re-job', $pk)['challenge'], $reSigners);
$again = createChallenge('re-job', $reSigners[0])['challenge'];
check(
    'weitere Challenge fuer dasselbe Paar zaehlt je Job mit, verdraengt wird die aelteste des Jobs',
    consumeChallenge('re-job', $reSigners[0], $reNonces[0]) === null
        && consumeChallenge('re-job', $reSigners[0], $again) !== null
        && consumeChallenge('re-job', $reSigners[1], $reNonces[1]) !== null
);

// Gesamt: Datei bis zur Obergrenze vorbelegen (schneller als 2000 Einzelaufrufe),
// davor ein abgelaufener Eintrag. Er faellt zuerst weg, dann die aelteste gueltige.
$expiredKey = base64_encode(random_bytes(32));
$full = [$expiredKey => ['jobId' => 'expired', 'signer' => 'GEXPIRED', 'expiresAt' => time() - 1]];
$totalKeys = [];
for ($i = 0; $i < CHALLENGE_MAX_TOTAL; $i++) {
    $k = base64_encode(random_bytes(32));
    $totalKeys[] = $k;
    $full[$k] = ['jobId' => "total-{$i}", 'signer' => 'GTOTAL', 'expiresAt' => time() + 60];
}
file_put_contents(challengesFilePath(), json_encode($full));
$kpFresh = KeyPair::random();
$cFresh = createChallenge('fresh-job', $kpFresh->getAccountId());
$stored = json_decode((string)file_get_contents(challengesFilePath()), true);
check('gesamt hoechstens CHALLENGE_MAX_TOTAL Eintraege', count($stored) === CHALLENGE_MAX_TOTAL);
check('abgelaufene und dann die aelteste wurden verdraengt', !isset($stored[$expiredKey]) && !isset($stored[$totalKeys[0]]) && isset($stored[$totalKeys[1]]));
$pendingFresh = consumeChallenge('fresh-job', $kpFresh->getAccountId(), $cFresh['challenge']);
check(
    'nach der Verdraengung funktioniert eine frische Challenge mit Signatur weiter',
    $pendingFresh !== null && verifyChallengeSignature($pendingFresh['nonce'], signNonce($kpFresh, $cFresh['challenge']), $kpFresh->getAccountId(), 'token') === true
);

// --- F-13: Schreibfehler werden gemeldet -------------------------------------
// Scheitert das Speichern, darf keine Nonce herausgegeben werden: consumeChallenge und
// createChallenge werfen (die Routen antworten dann 500). Vorher schluckte saveChallenges
// den Fehler, und dieselbe Nonce liess sich bis zum Ablauf beliebig oft einloesen.
$throws = function (callable $fn): bool {
    try { $fn(); return false; } catch (\Throwable $e) { return true; }
};

// Verzeichnis nicht beschreibbar (0555): Temp-Datei scheitert (Fall [dir] aus den PHP-Proben).
$roDir = $tmpDir . '/readonly';
mkdir($roDir, 0775);
putenv('CHALLENGES_FILE_PATH=' . $roDir . '/challenges.json');
$cRo = createChallenge('ro-job', 'GROSIGNER');
chmod($roDir, 0555);
$roWritable = is_writable($roDir);
check('sanity: Verzeichnis ist schreibgeschuetzt', !$roWritable);
$roResults = [];
for ($i = 0; $i < 3; $i++) {
    try { $roResults[] = consumeChallenge('ro-job', 'GROSIGNER', $cRo['challenge']); } catch (\Throwable $e) { $roResults[] = 'thrown'; }
}
check('Verzeichnis 0555: consumeChallenge wirft bei jedem Versuch', $roResults === ['thrown', 'thrown', 'thrown']);
check('Verzeichnis 0555: keine Nonce wird herausgegeben', !in_array(true, array_map(fn($r) => is_array($r) && ($r['nonce'] ?? '') === $cRo['challenge'], $roResults), true));
check('Verzeichnis 0555: createChallenge wirft', $throws(fn() => createChallenge('ro-job', 'GROSIGNER2')));
chmod($roDir, 0775);

// rename scheitert: Ziel ist ein nicht leeres Verzeichnis, die Temp-Datei laesst sich schreiben.
$renameDir = $tmpDir . '/rename';
mkdir($renameDir . '/challenges.json', 0775, true);
touch($renameDir . '/challenges.json/blocker');
putenv('CHALLENGES_FILE_PATH=' . $renameDir . '/challenges.json');
check('rename scheitert: createChallenge wirft', $throws(fn() => createChallenge('rn-job', 'GRNSIGNER')));
check('rename scheitert: consumeChallenge wirft', $throws(fn() => consumeChallenge('rn-job', 'GRNSIGNER', base64_encode(random_bytes(32)))));
check('rename scheitert: keine Temp-Datei bleibt liegen', glob($renameDir . '/challenges.json.tmp.*') === []);

// json_encode scheitert (ungueltiges UTF-8 im Schluessel): ebenfalls ein Fehler, kein stilles Verwerfen.
putenv('CHALLENGES_FILE_PATH=' . $tmpDir . '/challenges.json');
check('json_encode scheitert: createChallenge wirft', $throws(fn() => createChallenge("bad-\xff-job", 'GBADUTF8')));

// --- cleanup ---------------------------------------------------------------
@unlink($renameDir . '/challenges.json/blocker');
@rmdir($renameDir . '/challenges.json');
array_map('unlink', glob($renameDir . '/*') ?: []);
array_map('unlink', glob($roDir . '/*') ?: []);
@rmdir($renameDir);
@rmdir($roDir);
array_map('unlink', glob($tmpDir . '/*') ?: []);
@rmdir($tmpDir);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
