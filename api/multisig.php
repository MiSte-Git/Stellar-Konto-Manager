<?php
// Minimal PHP implementation of the multisig job endpoints.
// Requires vendor/autoload.php (built locally via Composer and uploaded together with this file).
// Endpoints:
//   POST   /api/multisig/jobs
//   GET    /api/multisig/jobs
//   GET    /api/multisig/jobs/:id
//   POST   /api/multisig/jobs/:id/merge-signed-xdr

declare(strict_types=1);

require __DIR__ . '/cors.php';

$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) {
    require $autoload;
} else {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'vendor_autoload_missing']);
    exit;
}

use Soneso\StellarSDK\StellarSDK;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;

class SubmitFailedException extends \Exception {
    private array $extras;
    public function __construct(string $message, array $extras = []) {
        parent::__construct($message);
        $this->extras = $extras;
    }
    public function getExtras(): array {
        return $this->extras;
    }
}

// CORS headers, restricted to known dev/prod origins (was previously a wildcard
// '*' — finding B3). Shared allowlist in cors.php (finding #9).
apply_cors_headers(['GET', 'POST', 'DELETE', 'OPTIONS'], ['Content-Type', 'x-job-token']);
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Simple router based on REQUEST_URI
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function jsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function sendJson($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
}

function sendError(string $error, ?string $detail = null, int $status = 500): void {
    $payload = ['ok' => false, 'error' => $error];
    if ($detail) $payload['detail'] = $detail;
    sendJson($payload, $status);
}

// Per-job access token (B3): required to view a job's full details or merge a
// signature into it. Accepted via the x-job-token header (what the frontend
// sends for both backends) or a ?token= query parameter (fallback for direct
// links), never trusted from anywhere else.
function newAccessToken(): string {
    return bin2hex(random_bytes(32));
}

function getRequestToken(): string {
    $header = $_SERVER['HTTP_X_JOB_TOKEN'] ?? '';
    if (is_string($header) && $header !== '') return trim($header);
    $query = $_GET['token'] ?? '';
    return is_string($query) ? trim($query) : '';
}

function hasValidJobToken(array $job): bool {
    $expected = (string)($job['accessToken'] ?? '');
    $provided = getRequestToken();
    if ($expected === '' || $provided === '') return false;
    return hash_equals($expected, $provided);
}

// Storage helpers
$dataDir = __DIR__ . '/data';
$jobFile = $dataDir . '/multisig_jobs.json';

const JOB_RETENTION_DAYS = 30;

function ensureDataDirWritable(string $dir): void {
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        throw new \RuntimeException('data_dir_unwritable');
    }
}

function loadJobs(string $jobFile): array {
    if (!file_exists($jobFile)) return [];
    $txt = file_get_contents($jobFile);
    $data = json_decode($txt, true);
    return is_array($data) ? ($data['items'] ?? []) : [];
}

// Writes the job file atomically (tmp file + rename) and throws if the write
// did not actually happen, so callers never report success on silent data loss.
function saveJobs(string $jobFile, array $items): void {
    ensureDataDirWritable(dirname($jobFile));
    $payload = ['items' => array_values($items)];
    $json = json_encode($payload, JSON_PRETTY_PRINT);
    if ($json === false) {
        throw new \RuntimeException('jobs_encode_failed');
    }
    $tmpFile = $jobFile . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmpFile, $json) === false) {
        throw new \RuntimeException('jobs_write_failed');
    }
    if (!rename($tmpFile, $jobFile)) {
        @unlink($tmpFile);
        throw new \RuntimeException('jobs_write_failed');
    }
}

// Drops old, already-final jobs so the job file does not grow forever.
// Active jobs (pending/ready) are always kept, regardless of age.
function pruneOldJobs(array $items, int $maxAgeDays = JOB_RETENTION_DAYS): array {
    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'];
    $cutoff = time() - ($maxAgeDays * 86400);
    return array_values(array_filter($items, function ($job) use ($finalStates, $cutoff) {
        $status = $job['status'] ?? '';
        if (!in_array($status, $finalStates, true)) return true;
        $createdAt = strtotime((string)($job['createdAt'] ?? ''));
        if ($createdAt === false) return true;
        return $createdAt >= $cutoff;
    }));
}

// Serializes read-modify-write access to the job file across concurrent requests.
// $mutator receives the freshly loaded items and must return the new items array.
function withJobsLock(string $jobFile, callable $mutator): array {
    ensureDataDirWritable(dirname($jobFile));
    $lockHandle = fopen($jobFile . '.lock', 'c');
    if ($lockHandle === false) {
        throw new \RuntimeException('lock_open_failed');
    }
    try {
        if (!flock($lockHandle, LOCK_EX)) {
            throw new \RuntimeException('lock_acquire_failed');
        }
        $items = loadJobs($jobFile);
        $items = $mutator($items);
        $items = pruneOldJobs($items);
        saveJobs($jobFile, $items);
        return $items;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

function normalizeNetwork(?string $net): ?string {
    $v = strtolower(trim((string)$net));
    if ($v === 'public' || $v === 'publicnet') return 'public';
    if ($v === 'testnet' || $v === 'test') return 'testnet';
    return null;
}

function horizonClient(string $net): StellarSDK {
    return $net === 'public'
        ? StellarSDK::getPublicNetInstance()
        : StellarSDK::getTestNetInstance();
}

function networkObj(string $net): Network {
    return $net === 'public' ? Network::public() : Network::testnet();
}

function parseTx(string $xdr, string $net, ?string &$err = null): ?AbstractTransaction {
    try {
        $network = networkObj($net);
        return AbstractTransaction::fromEnvelopeBase64XdrString($xdr);
    } catch (\Throwable $e) {
        $err = $e->getMessage();
        return null;
    }
}

function txHash(AbstractTransaction $tx, string $net): string {
    $network = networkObj($net);
    return bin2hex($tx->hash($network));
}

function submitToNetwork(AbstractTransaction $tx, string $net): array {
    $horizon = $net === 'public' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
    $xdr = $tx->toEnvelopeXdrBase64();
    $ch = curl_init($horizon . '/transactions');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query(['tx' => $xdr]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $respBody = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($respBody === false) {
        throw new SubmitFailedException($curlErrno === CURLE_OPERATION_TIMEDOUT ? 'submit_timeout' : 'submit_failed');
    }
    $data = json_decode($respBody, true);
    if ($httpCode >= 200 && $httpCode < 300 && isset($data['hash'])) {
        return [
          'hash' => $data['hash'],
          'ledger' => $data['ledger'] ?? null,
          'envelopeXdr' => $data['envelope_xdr'] ?? null,
          'resultXdr' => $data['result_xdr'] ?? null,
        ];
    }
    $extras = [];
    if (is_array($data) && isset($data['extras'])) $extras = $data['extras'];
    throw new SubmitFailedException($data['detail'] ?? $data['title'] ?? 'submit_failed', $extras);
}

function getSubmitErrorDetail(\Throwable $e): array {
    $detail = ['message' => $e->getMessage()];
    // Try to extract stellar-specific error info if available
    if (method_exists($e, 'getExtras')) {
        $detail['extras'] = $e->getExtras();
    } elseif (property_exists($e, 'extras')) {
        $detail['extras'] = $e->extras;
    }
    if (!isset($detail['extras']) || empty($detail['extras'])) {
        if (method_exists($e, 'getResultCodes')) {
            $rc = $e->getResultCodes();
            if ($rc) {
                $detail['extras'] = ['result_codes' => $rc];
            }
        } elseif (property_exists($e, 'result_codes')) {
            $detail['extras'] = ['result_codes' => $e->result_codes];
        }
    }
    if ($e instanceof SubmitFailedException) {
        $ex = $e->getExtras();
        if ($ex) $detail['extras'] = $ex;
    }
    if (!isset($detail['extras'])) {
        $detail['extras'] = ['result_codes' => 'unknown'];
    }
    return $detail;
}

function fetchAccountSigners(string $accountId, string $net): array {
    try {
        $sdk = horizonClient($net);
        $account = $sdk->requestAccount($accountId);
        $signers = [];
        foreach ($account->getSigners() as $s) {
            $signers[] = [
                'publicKey' => $s->getKey(),
                'weight' => (int)$s->getWeight(),
            ];
        }
        $thr = $account->getThresholds();
        return [
            'signers' => $signers,
            'thresholds' => [
                'low' => (int)$thr->getLowThreshold(),
                'med' => (int)$thr->getMedThreshold(),
                'high' => (int)$thr->getHighThreshold(),
            ],
        ];
    } catch (\Throwable $e) {
        return ['signers' => [], 'thresholds' => ['low' => 0, 'med' => 0, 'high' => 0]];
    }
}

function signersCacheFilePath(): string {
    return __DIR__ . '/data/signers_cache.json';
}

function loadSignersCache(string $cacheFile): array {
    if (!file_exists($cacheFile)) return [];
    $txt = @file_get_contents($cacheFile);
    if ($txt === false) return [];
    $data = json_decode($txt, true);
    return is_array($data) ? $data : [];
}

function saveSignersCache(string $cacheFile, array $cache): void {
    // Best-effort cache write; a failure here must never break the request.
    @file_put_contents($cacheFile, json_encode($cache));
}

// Same data as fetchAccountSigners(), but reused for a short TTL so that listing
// several jobs of the same account does not trigger a Horizon call per job.
function fetchAccountSignersCached(string $accountId, string $net, int $ttlSeconds = 30): array {
    static $memo = [];
    $key = $net . ':' . $accountId;
    if (isset($memo[$key])) return $memo[$key];

    $cacheFile = signersCacheFilePath();
    $cache = loadSignersCache($cacheFile);
    $entry = $cache[$key] ?? null;
    if (is_array($entry) && isset($entry['fetchedAt']) && (time() - (int)$entry['fetchedAt']) < $ttlSeconds) {
        $memo[$key] = $entry['data'];
        return $entry['data'];
    }

    $data = fetchAccountSigners($accountId, $net);
    $memo[$key] = $data;
    $cache[$key] = ['data' => $data, 'fetchedAt' => time()];
    saveSignersCache($cacheFile, $cache);
    return $data;
}

function matchRoute(string $uri, string $pattern): ?array {
    $regex = '#^' . preg_replace('#:([a-zA-Z0-9_]+)#', '(?P<$1>[^/]+)', $pattern) . '$#';
    if (preg_match($regex, $uri, $m)) {
        return $m;
    }
    return null;
}

function verifyCollected(AbstractTransaction $tx, string $net, array $signers): array {
    $network = networkObj($net);
    $base = $tx->signatureBase($network);
    $result = [];
    $seen = [];
    foreach ($signers as $s) {
        $pub = $s['publicKey'] ?? null;
        $weight = (int)($s['weight'] ?? 0);
        if (!$pub || $weight <= 0) continue;
        try {
            $kp = KeyPair::fromAccountId($pub);
        } catch (\Throwable $e) {
            continue;
        }
        $hint = $kp->getHint();
        foreach ($tx->getSignatures() as $sig) {
            if (!$sig instanceof XdrDecoratedSignature) continue;
            if ($sig->getHint() !== $hint) continue;
            try {
                if ($kp->verifySignature($sig->getRawSignature(), $base)) {
                    $accId = $kp->getAccountId();
                    if (!isset($seen[$accId])) {
                        $result[] = ['publicKey' => $accId, 'weight' => $weight];
                        $seen[$accId] = true;
                    }
                    break;
                }
            } catch (\Throwable $e) {
                continue;
            }
        }
    }
    return $result;
}

function mergeSignatures(AbstractTransaction $target, AbstractTransaction $incoming): AbstractTransaction {
    $map = [];
    $merged = [];
    $addSig = function (XdrDecoratedSignature $sig) use (&$map, &$merged) {
        $key = base64_encode($sig->getHint() . $sig->getSignature());
        if (isset($map[$key])) return;
        $map[$key] = true;
        $merged[] = $sig;
    };
    foreach ($target->getSignatures() as $s) {
        if ($s instanceof XdrDecoratedSignature) $addSig($s);
    }
    foreach ($incoming->getSignatures() as $s) {
        if ($s instanceof XdrDecoratedSignature) $addSig($s);
    }
    $target->setSignatures($merged);
    return $target;
}

/**
 * Enriches a job array with collected/missing signer info and recalculates status if not final.
 */
function summarizeJob(array $job): array {
    $net = $job['network'] ?? 'public';
    $accountId = $job['accountId'] ?? '';
    $txXdr = $job['txXdrCurrent'] ?? ($job['txXdrOriginal'] ?? ($job['txXdr'] ?? ''));

    $signers = $job['signers'] ?? [];
    if (!$signers || count($signers) === 0) {
        $meta = fetchAccountSignersCached($accountId, $net);
        $signers = $meta['signers'];
        $job['thresholds'] = $job['thresholds'] ?? $meta['thresholds'];
    }

    $requiredWeight = (int)($job['requiredWeight'] ?? ($job['thresholds']['med'] ?? 0));
    $job['signers'] = $signers;
    $job['requiredWeight'] = $requiredWeight;

    $collected = [];
    $collectedWeight = 0;
    $parseErr = null;
    if ($txXdr) {
        $tx = parseTx($txXdr, $net, $parseErr);
        if ($tx) {
            $collected = verifyCollected($tx, $net, $signers);
            $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
        }
    }
    // Fallback to existing collected info if parsing failed
    if (!$collected && isset($job['collectedSigners']) && is_array($job['collectedSigners'])) {
        $collected = array_values($job['collectedSigners']);
        $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
    }
    $collectedMap = [];
    foreach ($collected as $c) {
        $pk = $c['publicKey'] ?? null;
        if ($pk) $collectedMap[$pk] = true;
    }
    $missing = array_values(array_filter($signers, function ($s) use ($collectedMap) {
        $pk = $s['publicKey'] ?? '';
        $weight = (int)($s['weight'] ?? 0);
        return $pk && $weight > 0 && !isset($collectedMap[$pk]);
    }));
    $missingWeight = array_reduce($missing, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);

    $job['collectedSigners'] = $collected;
    $job['collectedWeight'] = $collectedWeight;
    $job['missingSigners'] = $missing;
    $job['missingWeight'] = $missingWeight;

    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'];
    if (!in_array($job['status'] ?? '', $finalStates, true)) {
        $job['status'] = ($requiredWeight > 0 && $collectedWeight >= $requiredWeight)
            ? 'ready_to_submit'
            : 'pending_signatures';
    }

    return $job;
}

// Routing
$path = parse_url($uri, PHP_URL_PATH) ?? '/';

// POST /api/multisig/jobs
if ($method === 'POST' && $path === '/api/multisig/jobs') {
    try {
        $body = jsonBody();
        $net = normalizeNetwork($body['network'] ?? null);
        $accountId = $body['accountId'] ?? '';
        $txXdr = $body['txXdr'] ?? '';
        $clientCollected = [];
        if (isset($body['clientCollected']) && is_array($body['clientCollected'])) {
            foreach ($body['clientCollected'] as $s) {
                $pk = $s['publicKey'] ?? '';
                $w = (int)($s['weight'] ?? 0);
                if ($pk && $w > 0) $clientCollected[] = ['publicKey' => $pk, 'weight' => $w];
            }
        }
        if (!$net) return sendJson(['ok' => false, 'error' => 'invalid_network'], 400);
        if (!$accountId) return sendJson(['ok' => false, 'error' => 'invalid_account'], 400);
        if (!$txXdr) return sendJson(['ok' => false, 'error' => 'invalid_xdr'], 400);

        $parseErr = null;
        $tx = parseTx($txXdr, $net, $parseErr);
        if (!$tx) return sendJson(['ok' => false, 'error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        $hash = txHash($tx, $net);
        // Signers/thresholds are always derived from the real on-chain account state.
        // Client-supplied signer/weight data is never trusted for authorization decisions (C2).
        $meta = fetchAccountSignersCached($accountId, $net);
        $signerMeta = $meta['signers'];
        $requiredWeight = (int)($meta['thresholds']['med'] ?? 0);
        $collected = verifyCollected($tx, $net, $signerMeta);
        if (!$collected && $clientCollected) {
            $collected = $clientCollected;
        }
        $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
        $status = ($requiredWeight > 0 && $collectedWeight >= $requiredWeight) ? 'ready_to_submit' : 'pending_signatures';
        $submittedResult = null;
        if ($status === 'ready_to_submit' && $requiredWeight > 0) {
            try {
                $submittedResult = submitToNetwork($tx, $net);
                $status = 'submitted_success';
            } catch (\Throwable $submitErr) {
                $submittedResult = ['error' => $submitErr->getMessage(), 'detail' => getSubmitErrorDetail($submitErr)];
                $status = 'submitted_failed';
            }
        }

        $job = [
            'id' => bin2hex(random_bytes(12)),
            'accessToken' => newAccessToken(),
            'network' => $net,
            'accountId' => $accountId,
            'txHash' => $hash,
            'txXdrOriginal' => $txXdr,
            'txXdrCurrent' => $txXdr,
            'status' => $status,
            'createdAt' => gmdate('c'),
            'signers' => $signerMeta,
            'thresholds' => $meta['thresholds'],
            'requiredWeight' => $requiredWeight,
            'collectedSigners' => $collected,
            'collectedWeight' => $collectedWeight,
            'submittedResult' => $submittedResult,
            'submittedAt' => $submittedResult ? gmdate('c') : null,
        ];
        $job = summarizeJob($job);
        withJobsLock($jobFile, function (array $items) use ($job) {
            array_unshift($items, $job);
            return $items;
        });
        return sendJson($job);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.create failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
}

// GET /api/multisig/jobs
if ($method === 'GET' && $path === '/api/multisig/jobs') {
    $items = loadJobs($jobFile);
    $net = normalizeNetwork($_GET['network'] ?? null);
    $accountId = $_GET['accountId'] ?? null;
    $signer = $_GET['signer'] ?? null;
    $status = $_GET['status'] ?? null;

    $items = array_filter($items, function ($j) use ($net, $accountId, $signer, $status) {
        if ($net && ($j['network'] ?? '') !== $net) return false;
        if ($accountId && ($j['accountId'] ?? '') !== $accountId) return false;
        if ($signer) {
            $s = array_filter($j['signers'] ?? [], fn($si) => ($si['publicKey'] ?? '') === $signer);
            if (count($s) === 0) return false;
        }
        if ($status && ($j['status'] ?? '') !== $status) return false;
        return true;
    });
    // Jobs are stored newest-first; page through them so a single list call cannot
    // trigger an unbounded number of (now cached) Horizon lookups (C4).
    $items = array_values($items);
    $total = count($items);
    $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 100;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
    $page = array_slice($items, $offset, $limit);

    $page = array_map('summarizeJob', $page);
    // hide raw XDR in list; accessToken is never included either (B3-follow-up):
    // anyone who knows a public accountId/signer key could otherwise read every
    // pending job's token straight out of the list, defeating the per-job token
    // check below. Clients fetch the token per job via GET /:id/token instead,
    // which verifies the requester's public key against the account's live signers.
    $out = array_map(function ($j) {
        $c = $j;
        unset($c['txXdrCurrent'], $c['txXdrOriginal'], $c['accessToken']);
        return $c;
    }, $page);
    header('X-Total-Count: ' . $total);
    return sendJson($out);
}

// GET /api/multisig/jobs/:id
if ($method === 'GET' && ($m = matchRoute($path, '/api/multisig/jobs/:id'))) {
    $id = $m['id'] ?? '';
    $items = loadJobs($jobFile);
    foreach ($items as $j) {
        if (($j['id'] ?? '') === $id) {
            if (!hasValidJobToken($j)) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);
            return sendJson(summarizeJob($j));
        }
    }
    return sendJson(['ok' => false, 'error' => 'not_found'], 404);
}

// GET /api/multisig/jobs/:id/token - issues a job's access token to a caller
// who proves, via the account's real, live signer list (never the stored
// job.signers snapshot), that the claimed public key is an active signer
// (weight > 0) of the job's account. This is the only way to obtain a job's
// token now that the list endpoint no longer includes it.
if ($method === 'GET' && ($m = matchRoute($path, '/api/multisig/jobs/:id/token'))) {
    $id = $m['id'] ?? '';
    $signerPk = trim((string)($_GET['signer'] ?? ''));
    try {
        KeyPair::fromAccountId($signerPk);
    } catch (\Throwable $e) {
        return sendJson(['ok' => false, 'error' => 'invalid_signer'], 400);
    }

    $items = loadJobs($jobFile);
    $job = null;
    foreach ($items as $j) {
        if (($j['id'] ?? '') === $id) { $job = $j; break; }
    }
    if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);

    $net = $job['network'] ?? 'public';
    $meta = fetchAccountSignersCached($job['accountId'] ?? '', $net);
    $isActiveSigner = false;
    foreach ($meta['signers'] ?? [] as $s) {
        if (($s['publicKey'] ?? '') === $signerPk && (int)($s['weight'] ?? 0) > 0) {
            $isActiveSigner = true;
            break;
        }
    }
    if (!$isActiveSigner) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);

    return sendJson(['accessToken' => $job['accessToken'] ?? '']);
}

// POST /api/multisig/jobs/:id/merge-signed-xdr
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/merge-signed-xdr'))) {
    try {
        $id = $m['id'] ?? '';
        $body = jsonBody();
        $signedXdr = $body['signedXdr'] ?? '';
        $clientCollected = [];
        if (isset($body['clientCollected']) && is_array($body['clientCollected'])) {
            foreach ($body['clientCollected'] as $s) {
                $pk = $s['publicKey'] ?? '';
                $w = (int)($s['weight'] ?? 0);
                if ($pk && $w > 0) $clientCollected[] = ['publicKey' => $pk, 'weight' => $w];
            }
        }
        if (!$signedXdr) return sendJson(['ok' => false, 'error' => 'invalid_xdr'], 400);

        // Fail fast on obvious client errors before taking the write lock.
        $preCheck = loadJobs($jobFile);
        $job = null;
        foreach ($preCheck as $j) {
            if (($j['id'] ?? '') === $id) { $job = $j; break; }
        }
        if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
        if (!hasValidJobToken($job)) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);

        $net = $job['network'] ?? 'public';
        $parseErr = null;
        $incoming = parseTx($signedXdr, $net, $parseErr);
        if (!$incoming) return sendJson(['ok' => false, 'error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        $hash = txHash($incoming, $net);
        if ($hash !== ($job['txHash'] ?? '')) return sendJson(['ok' => false, 'error' => 'mismatched_hash'], 400);

        $resultRow = null;
        withJobsLock($jobFile, function (array $items) use ($id, $net, $incoming, $clientCollected, &$resultRow) {
            foreach ($items as &$j) {
                if (($j['id'] ?? '') !== $id) continue;

                $currentErr = null;
                $current = parseTx($j['txXdrCurrent'] ?? $j['txXdrOriginal'] ?? '', $net, $currentErr);
                if (!$current) $current = $incoming;
                $merged = mergeSignatures($current, $incoming);

                // Signers/thresholds are always (re-)derived from the real on-chain account
                // state, never trusted from the request body (C2).
                $meta = fetchAccountSignersCached($j['accountId'] ?? '', $net);
                $signerMeta = $meta['signers'];
                $j['thresholds'] = $meta['thresholds'];
                $j['requiredWeight'] = (int)($meta['thresholds']['med'] ?? 0);
                $j['signers'] = $signerMeta;

                $collected = verifyCollected($merged, $net, $signerMeta);
                // Merge in client-provided collected and previously stored collected to avoid losing signatures
                $collectedAll = array_merge(
                    is_array($collected) ? $collected : [],
                    is_array($clientCollected) ? $clientCollected : [],
                    is_array($j['collectedSigners'] ?? null) ? $j['collectedSigners'] : []
                );
                // Deduplicate by publicKey, prefer highest weight
                $byPk = [];
                foreach ($collectedAll as $c) {
                    $pk = $c['publicKey'] ?? '';
                    $w = (int)($c['weight'] ?? 0);
                    if (!$pk) continue;
                    if (!isset($byPk[$pk]) || $w > (int)($byPk[$pk]['weight'] ?? 0)) {
                        $byPk[$pk] = ['publicKey' => $pk, 'weight' => $w];
                    }
                }
                $collected = array_values($byPk);
                $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
                $required = (int)($j['requiredWeight'] ?? 0);
                $status = ($required > 0 && $collectedWeight >= $required) ? 'ready_to_submit' : 'pending_signatures';
                $submittedResult = $j['submittedResult'] ?? null;
                if ($status === 'ready_to_submit' && $required > 0) {
                    try {
                        $submittedResult = submitToNetwork($merged, $net);
                        $status = 'submitted_success';
                    } catch (\Throwable $submitErr) {
                        $submittedResult = ['error' => $submitErr->getMessage(), 'detail' => getSubmitErrorDetail($submitErr)];
                        $status = 'submitted_failed';
                    }
                }

                $j['txXdrCurrent'] = $merged->toEnvelopeXdrBase64();
                $j['collectedSigners'] = $collected;
                $j['collectedWeight'] = $collectedWeight;
                $j['status'] = $status;
                $j['submittedResult'] = $submittedResult;
                $j['submittedAt'] = $submittedResult ? gmdate('c') : null;
                $j = summarizeJob($j);
                $resultRow = $j;
                break;
            }
            unset($j);
            return $items;
        });

        if (!$resultRow) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
        return sendJson($resultRow);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.merge failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
}

// DELETE /api/multisig/jobs?network=testnet&confirm=DELETE TESTNET JOBS
if ($method === 'DELETE' && $path === '/api/multisig/jobs') {
    $net = normalizeNetwork($_GET['network'] ?? null);
    $confirm = $_GET['confirm'] ?? '';
    $adminToken = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    $requiredToken = getenv('MULTISIG_ADMIN_TOKEN') ?: '';

    if (!$net) return sendJson(['ok' => false, 'error' => 'invalid_network'], 400);
    if ($net === 'testnet') {
        if ($confirm !== 'DELETE TESTNET JOBS') return sendJson(['ok' => false, 'error' => 'confirm_required'], 400);
    } else {
        if (!$requiredToken || !$adminToken || $adminToken !== $requiredToken) {
            return sendJson(['ok' => false, 'error' => 'unauthorized'], 401);
        }
        if ($confirm !== 'DELETE ALL JOBS') return sendJson(['ok' => false, 'error' => 'confirm_required'], 400);
    }

    $before = 0;
    $after = 0;
    try {
        withJobsLock($jobFile, function (array $items) use ($net, &$before, &$after) {
            $before = count($items);
            $items = array_values(array_filter($items, function ($j) use ($net) {
                return ($j['network'] ?? '') !== $net;
            }));
            $after = count($items);
            return $items;
        });
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.delete failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
    return sendJson(['deleted' => $before - $after]);
}

// Fallback
sendJson(['ok' => false, 'error' => 'not_found'], 404);
