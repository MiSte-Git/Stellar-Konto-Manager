<?php
// Challenge-response nonce store for the multisig job token endpoint (PHP variant).
//
// Closes finding H1 (Ultrareview 2026-07-06): the token endpoint used to hand
// out a job's accessToken to anyone who merely *named* a public key that
// happened to be an active signer on-chain - no proof the caller actually
// holds that key's private half was required, and signer lists are public on
// Horizon. This adds the missing possession proof: the caller must first
// request a short-lived, single-use nonce for (jobId, signerPublicKey), then
// sign it with the claimed key before a token is issued.
//
// Unlike server.js's in-memory Map, PHP has no long-running process to keep
// state in between requests, so this persists to a small file (same
// flock()-based locking pattern as multisig.php's job store), guarded by the
// same api/data/.htaccess deny-all.
declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use Soneso\StellarSDK\Crypto\KeyPair;

const CHALLENGE_TTL_SECONDS = 60;

function challengesFilePath(): string {
    // Overridable so tests can point this at a throwaway temp file instead of
    // the real api/data/challenges.json (same pattern as server.js's
    // BUG_DB_DIR/MULTISIG_DB_PATH env overrides).
    $override = getenv('CHALLENGES_FILE_PATH');
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/challenges.json';
}

function challengeKey(string $jobId, string $signerPublicKey): string {
    return $jobId . ':' . $signerPublicKey;
}

function loadChallenges(string $file): array {
    if (!file_exists($file)) return [];
    $txt = @file_get_contents($file);
    if ($txt === false || $txt === '') return [];
    $data = json_decode($txt, true);
    return is_array($data) ? $data : [];
}

function saveChallenges(string $file, array $data): void {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $json = json_encode($data);
    if ($json === false) return; // best-effort; a failed write just means the next request re-derives state
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $json) === false) return;
    if (!@rename($tmp, $file)) @unlink($tmp);
}

// Drops any entry past its expiry, keyed by absolute unix timestamp.
function pruneExpiredChallenges(array $data, int $now): array {
    return array_filter($data, fn($entry) => is_array($entry) && (int)($entry['expiresAt'] ?? 0) > $now);
}

// Serializes read-modify-write access to the challenge file, same pattern as
// withJobsLock() in multisig.php.
function withChallengesLock(callable $mutator) {
    $file = challengesFilePath();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) {
        throw new \RuntimeException('challenge_lock_open_failed');
    }
    try {
        if (!flock($lockHandle, LOCK_EX)) {
            throw new \RuntimeException('challenge_lock_acquire_failed');
        }
        $data = pruneExpiredChallenges(loadChallenges($file), time());
        [$data, $result] = $mutator($data);
        saveChallenges($file, $data);
        return $result;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

/**
 * Issues a fresh nonce for (jobId, signerPublicKey), overwriting any
 * still-pending challenge for the same pair.
 * @return array{challenge: string, expiresAt: int} challenge is base64.
 */
function createChallenge(string $jobId, string $signerPublicKey, int $ttlSeconds = CHALLENGE_TTL_SECONDS): array {
    $nonce = base64_encode(random_bytes(32));
    $expiresAt = time() + $ttlSeconds;
    return withChallengesLock(function (array $data) use ($jobId, $signerPublicKey, $nonce, $expiresAt) {
        $data[challengeKey($jobId, $signerPublicKey)] = ['nonce' => $nonce, 'expiresAt' => $expiresAt];
        return [$data, ['challenge' => $nonce, 'expiresAt' => $expiresAt]];
    });
}

/**
 * Atomically retrieves and deletes the pending challenge for (jobId,
 * signerPublicKey) - single-use regardless of whether the signature that
 * follows turns out to be valid.
 * @return array{nonce: string}|null null if none pending or it expired.
 */
function consumeChallenge(string $jobId, string $signerPublicKey): ?array {
    $key = challengeKey($jobId, $signerPublicKey);
    return withChallengesLock(function (array $data) use ($key) {
        $entry = $data[$key] ?? null;
        unset($data[$key]);
        $result = (is_array($entry) && (int)($entry['expiresAt'] ?? 0) > time())
            ? ['nonce' => (string)$entry['nonce']]
            : null;
        return [$data, $result];
    });
}

/**
 * Verifies that $signatureB64 is a valid ed25519 signature by
 * $signerPublicKey over the raw bytes of $nonceB64. Never throws - any
 * malformed base64/signature/public key is treated as an invalid signature.
 */
function verifyChallengeSignature(string $nonceB64, string $signatureB64, string $signerPublicKey): bool {
    try {
        $data = base64_decode($nonceB64, true);
        $signature = base64_decode($signatureB64, true);
        if ($data === false || $signature === false || $data === '' || $signature === '') return false;
        $kp = KeyPair::fromAccountId($signerPublicKey);
        return $kp->verifySignature($signature, $data);
    } catch (\Throwable $e) {
        return false;
    }
}
