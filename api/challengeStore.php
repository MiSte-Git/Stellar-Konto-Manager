<?php
// Challenge-response nonce store for the multisig job token endpoint (PHP variant).
//
// Closes finding H1 (Ultrareview 2026-07-06): the token endpoint used to hand
// out a job's accessToken to anyone who merely *named* a public key that
// happened to be an active signer on-chain - no proof the caller actually
// holds that key's private half was required, and signer lists are public on
// Horizon. This adds the missing possession proof: the caller must first
// request a short-lived, single-use nonce for (jobId, signerPublicKey), then
// sign it with the claimed key before a token is issued. Beim Einloesen schickt
// der Client die Nonce mit; verbraucht wird nur genau diese.
//
// Unlike server.js's in-memory Map, PHP has no long-running process to keep
// state in between requests, so this persists to a small file (same
// flock()-based locking pattern as multisig.php's job store), guarded by the
// same api/data/.htaccess deny-all.
declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/signerAuth.php';


const CHALLENGE_TTL_SECONDS = 60;
// Obergrenzen, damit challenges.json mit zufaelligen Keys nicht beliebig waechst (C2).
// Gleich in services/challengeStore.js.
const CHALLENGE_MAX_TOTAL = 2000;
const CHALLENGE_MAX_PER_JOB = 20;
// Offene Challenges je (jobId, signer). Mehrere, damit ein Dritter mit jobId und Signer-Adresse
// (beides oeffentlich) die Challenge eines ehrlichen Signers nicht ueberschreiben kann.
const CHALLENGE_MAX_PER_SIGNER = 5;
// Laenge der Nonce in Byte, gleich wie CHALLENGE_NONCE_BYTES im Frontend.
const CHALLENGE_NONCE_BYTES = 32;
// Budget fuer POST /challenge je IP (api/rateLimit.php), gleich wie in server.js.
const MULTISIG_CHALLENGE_RATE_LIMIT_MAX = 20;
const MULTISIG_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS = 60;

function challengesFilePath(): string {
    // Overridable so tests can point this at a throwaway temp file instead of
    // the real api/data/challenges.json (same pattern as server.js's
    // BUG_DB_DIR/MULTISIG_DB_PATH env overrides).
    $override = getenv('CHALLENGES_FILE_PATH');
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/challenges.json';
}

/**
 * Nonce aus dem Request-Body (Feld challenge): nur strikte Standard-base64 mit Padding und
 * genau 32 Byte, gleiche Strenge wie K5 und decodeChallengeNonce im Frontend. Gibt die Nonce
 * unveraendert zurueck oder null. Gleich parseChallengeNonce in services/challengeStore.js.
 */
function parseChallengeNonce($value): ?string {
    if (!is_string($value)) return null;
    $bytes = skm_decode_strict_base64($value);
    if ($bytes === null || strlen($bytes) !== CHALLENGE_NONCE_BYTES) return null;
    return $value;
}

function loadChallenges(string $file): array {
    if (!file_exists($file)) return [];
    $txt = @file_get_contents($file);
    if ($txt === false || $txt === '') return [];
    $data = json_decode($txt, true);
    return is_array($data) ? $data : [];
}

// F-13: Jeder Schreibfehler wirft (wie saveJobs in multisig.php). Sonst bliebe ein Verbrauch in
// consumeChallenge ungespeichert, und dieselbe Nonce liesse sich bis zum Ablauf beliebig oft
// einloesen. withChallengesLock gibt den Fehler weiter, die Routen antworten 500.
function saveChallenges(string $file, array $data): void {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $json = json_encode($data);
    if ($json === false) throw new \RuntimeException('challenge_encode_failed');
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $json) === false) {
        @unlink($tmp);
        throw new \RuntimeException('challenge_write_failed');
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        throw new \RuntimeException('challenge_rename_failed');
    }
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
 * Issues a fresh nonce for (jobId, signerPublicKey). Andere offene Challenges desselben Paars
 * bleiben, bis CHALLENGE_MAX_PER_SIGNER erreicht ist (dann faellt die aelteste weg).
 * Schluessel in challenges.json ist die Nonce, die Reihenfolge der Datei ist das Alter.
 * @return array{challenge: string, expiresAt: int} challenge is base64.
 */
function createChallenge(string $jobId, string $signerPublicKey, int $ttlSeconds = CHALLENGE_TTL_SECONDS): array {
    $expiresAt = time() + $ttlSeconds;
    return withChallengesLock(function (array $data) use ($jobId, $signerPublicKey, $expiresAt) {
        do {
            $nonce = base64_encode(random_bytes(CHALLENGE_NONCE_BYTES));
        } while (isset($data[$nonce]));
        $data = capChallenges($data, $jobId, $signerPublicKey);
        $data[$nonce] = ['jobId' => $jobId, 'signer' => $signerPublicKey, 'expiresAt' => $expiresAt];
        return [$data, ['challenge' => $nonce, 'expiresAt' => $expiresAt]];
    });
}

// Macht Platz fuer eine neue Challenge von ($jobId, $signer): zuerst je Signer, dann je Job,
// dann gesamt die aeltesten Eintraege entfernen. Abgelaufene hat withChallengesLock() schon entfernt.
function capChallenges(array $data, string $jobId, string $signerPublicKey): array {
    $ofSigner = [];
    foreach ($data as $k => $entry) {
        if (($entry['jobId'] ?? null) === $jobId && ($entry['signer'] ?? null) === $signerPublicKey) $ofSigner[] = $k;
    }
    for ($i = 0; $i <= count($ofSigner) - CHALLENGE_MAX_PER_SIGNER; $i++) unset($data[$ofSigner[$i]]);
    $ofJob = [];
    foreach ($data as $k => $entry) {
        if (($entry['jobId'] ?? null) === $jobId) $ofJob[] = $k;
    }
    for ($i = 0; $i <= count($ofJob) - CHALLENGE_MAX_PER_JOB; $i++) unset($data[$ofJob[$i]]);
    if (count($data) >= CHALLENGE_MAX_TOTAL) {
        $data = array_slice($data, count($data) - CHALLENGE_MAX_TOTAL + 1, null, true);
    }
    return $data;
}

/**
 * Loest genau die Challenge $nonceB64 ein, wenn sie zu ($jobId, $signerPublicKey) gehoert, und
 * loescht sie dabei, unabhaengig davon, ob die folgende Signaturpruefung gelingt (kein Replay).
 * Eine Nonce, die kaputt, unbekannt, abgelaufen oder fuer einen anderen Job oder Signer
 * ausgestellt ist, ergibt null; eine fremde Nonce bleibt dabei unangetastet. Andere offene
 * Challenges desselben Signers bleiben immer. Kaputte Nonce: kein Dateizugriff.
 * @return array{nonce: string}|null
 */
function consumeChallenge(string $jobId, string $signerPublicKey, $nonceB64): ?array {
    $nonce = parseChallengeNonce($nonceB64);
    if ($nonce === null) return null;
    return withChallengesLock(function (array $data) use ($jobId, $signerPublicKey, $nonce) {
        $entry = $data[$nonce] ?? null;
        if (!is_array($entry) || ($entry['jobId'] ?? null) !== $jobId || ($entry['signer'] ?? null) !== $signerPublicKey) {
            return [$data, null];
        }
        unset($data[$nonce]);
        $result = (int)($entry['expiresAt'] ?? 0) > time() ? ['nonce' => $nonce] : null;
        return [$data, $result];
    });
}

/**
 * Verifies that $signatureB64 is a valid ed25519 signature by
 * $signerPublicKey over "skm:<purpose>:" plus the raw nonce bytes. Never
 * throws - any malformed base64/signature/public key is treated as an invalid
 * signature.
 */
// $purpose bindet die Signatur an eine Aktion (token, decline, delete) und ist Pflicht: Ohne
// Praefix waere die Nachricht eine rohe 32-Byte-Nonce, gleich lang wie ein Transaktions-
// Hash. Ein manipuliertes Backend koennte sonst einen Tx-Hash als Challenge schicken und
// eine gueltige Transaktions-Signatur einsammeln. Ohne $purpose ist keine Nachricht
// gueltig, eine Signatur fuer das Token gilt nie als Ablehnung und umgekehrt.
// Gleich in services/challengeStore.js und frontend/src/utils/multisigApi.js.
// Korrektur K5: Nonce und Signatur strikt als Standard-base64 mit Padding (wie Node). Vorher nahm
// base64_decode(..., true) auch Eingaben ohne Padding an. Pruefung in signerAuth.php.
function verifyChallengeSignature(string $nonceB64, string $signatureB64, string $signerPublicKey, string $purpose): bool {
    if ($purpose === '') return false;
    $nonce = skm_decode_strict_base64($nonceB64);
    if ($nonce === null || $nonce === '') return false;
    return skm_verify_challenge($signerPublicKey, 'skm:' . $purpose . ':' . $nonce, $signatureB64);
}
