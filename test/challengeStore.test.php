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

function signNonce(KeyPair $keypair, string $challengeB64): string {
    return base64_encode($keypair->sign(base64_decode($challengeB64, true)));
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
$first = consumeChallenge('job-2', 'GSIGNER2');
check('consumeChallenge returns the nonce on first call', $first !== null && $first['nonce'] === $c2['challenge']);
$second = consumeChallenge('job-2', 'GSIGNER2');
check('consumeChallenge returns null on second call (single-use)', $second === null);

// --- consumeChallenge: unknown pair -------------------------------------
check(
    'consumeChallenge returns null for a pair that never requested a challenge',
    consumeChallenge('never-requested-job', 'GNOBODY') === null
);

// --- overwrite on re-request ---------------------------------------------
$jobId3 = 'job-3';
$signer3 = 'GSIGNER3';
$firstChallenge = createChallenge($jobId3, $signer3)['challenge'];
$secondChallenge = createChallenge($jobId3, $signer3)['challenge'];
check('requesting a new challenge produces a different nonce', $firstChallenge !== $secondChallenge);
$consumed3 = consumeChallenge($jobId3, $signer3);
check('consumeChallenge returns the newest nonce after an overwrite', $consumed3 !== null && $consumed3['nonce'] === $secondChallenge);

// --- expiry ---------------------------------------------------------------
createChallenge('job-4', 'GSIGNER4', -1); // already expired the instant it's created
check('consumeChallenge treats an expired challenge as absent', consumeChallenge('job-4', 'GSIGNER4') === null);

// --- verifyChallengeSignature: genuine signature --------------------------
$kp5 = KeyPair::random();
$c5 = createChallenge('job-5', $kp5->getAccountId());
$sig5 = signNonce($kp5, $c5['challenge']);
check(
    'verifyChallengeSignature accepts a genuine signature from the claimed keypair',
    verifyChallengeSignature($c5['challenge'], $sig5, $kp5->getAccountId()) === true
);

// --- verifyChallengeSignature: wrong signer -------------------------------
$owner = KeyPair::random();
$impostor = KeyPair::random();
$c6 = createChallenge('job-6', $owner->getAccountId());
$sig6 = signNonce($impostor, $c6['challenge']); // signed with the wrong key
check(
    'verifyChallengeSignature rejects a signature produced by a different keypair',
    verifyChallengeSignature($c6['challenge'], $sig6, $owner->getAccountId()) === false
);

// --- verifyChallengeSignature: tampered nonce -----------------------------
$kp7 = KeyPair::random();
$c7 = createChallenge('job-7', $kp7->getAccountId());
$sig7 = signNonce($kp7, $c7['challenge']);
$tamperedChallenge = base64_encode('completely different 32 byte value!!');
check(
    'verifyChallengeSignature rejects a signature over tampered nonce data',
    verifyChallengeSignature($tamperedChallenge, $sig7, $kp7->getAccountId()) === false
);

// --- verifyChallengeSignature: never throws on garbage --------------------
$garbageOk = true;
try {
    if (verifyChallengeSignature('not-valid-base64!!', 'also-not-base64!!', 'not-a-real-key') !== false) $garbageOk = false;
    if (verifyChallengeSignature('', '', '') !== false) $garbageOk = false;
} catch (\Throwable $e) {
    $garbageOk = false;
}
check('verifyChallengeSignature never throws on malformed input (garbage base64/pubkey)', $garbageOk);

// --- end-to-end handshake --------------------------------------------------
$jobId8 = 'job-8';
$kp8 = KeyPair::random();
$c8 = createChallenge($jobId8, $kp8->getAccountId());
$sig8 = signNonce($kp8, $c8['challenge']);
$pending8 = consumeChallenge($jobId8, $kp8->getAccountId());
check('end-to-end: challenge is still pending before redemption', $pending8 !== null);
check(
    'end-to-end: verifyChallengeSignature succeeds against the consumed nonce',
    $pending8 !== null && verifyChallengeSignature($pending8['nonce'], $sig8, $kp8->getAccountId()) === true
);
check(
    'end-to-end: replaying the same (jobId, signer) after consumption fails closed',
    consumeChallenge($jobId8, $kp8->getAccountId()) === null
);

// --- cleanup ---------------------------------------------------------------
array_map('unlink', glob($tmpDir . '/*') ?: []);
@rmdir($tmpDir);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
