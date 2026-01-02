<?php
// Minimal PHP implementation of the multisig job endpoints.
// Requires vendor/autoload.php (built locally via Composer and uploaded together with this file).
// Endpoints:
//   POST   /api/multisig/jobs
//   GET    /api/multisig/jobs
//   GET    /api/multisig/jobs/:id
//   POST   /api/multisig/jobs/:id/merge-signed-xdr

declare(strict_types=1);

$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) {
    require $autoload;
} else {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'vendor_autoload_missing']);
    exit;
}

use Soneso\StellarSDK\StellarSDK;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
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
    $payload = ['error' => $error];
    if ($detail) $payload['detail'] = $detail;
    sendJson($payload, $status);
}

// Storage helpers
$dataDir = __DIR__ . '/data';
$jobFile = $dataDir . '/multisig_jobs.json';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0775, true);
}

function loadJobs(string $jobFile): array {
    if (!file_exists($jobFile)) return [];
    $txt = file_get_contents($jobFile);
    $data = json_decode($txt, true);
    return is_array($data) ? ($data['items'] ?? []) : [];
}

function saveJobs(string $jobFile, array $items): void {
    $payload = ['items' => array_values($items)];
    file_put_contents($jobFile, json_encode($payload, JSON_PRETTY_PRINT));
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
    $sdk = horizonClient($net);
    $response = $sdk->submitTransaction($tx);
    return [
        'hash' => $response->getHash(),
        'ledger' => $response->getLedger(),
        'envelopeXdr' => $response->getEnvelopeXdr(),
        'resultXdr' => $response->getResultXdr(),
    ];
}

function getSubmitErrorDetail(\Throwable $e): array {
    $detail = ['message' => $e->getMessage()];
    // Try to extract stellar-specific error info if available
    if (method_exists($e, 'getExtras')) {
        $detail['extras'] = $e->getExtras();
    } elseif (property_exists($e, 'extras')) {
        $detail['extras'] = $e->extras;
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
        $meta = fetchAccountSigners($accountId, $net);
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
        $providedSigners = [];
        if (isset($body['signers']) && is_array($body['signers'])) {
            foreach ($body['signers'] as $s) {
                $pk = $s['publicKey'] ?? '';
                $w = (int)($s['weight'] ?? 0);
                if ($pk && $w > 0) $providedSigners[] = ['publicKey' => $pk, 'weight' => $w];
            }
        }
        $providedRequired = isset($body['requiredWeight']) ? (int)$body['requiredWeight'] : null;
        if (!$net) return sendJson(['error' => 'invalid_network'], 400);
        if (!$accountId) return sendJson(['error' => 'invalid_account'], 400);
        if (!$txXdr) return sendJson(['error' => 'invalid_xdr'], 400);

        $parseErr = null;
        $tx = parseTx($txXdr, $net, $parseErr);
        if (!$tx) return sendJson(['error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        $hash = txHash($tx, $net);
        $meta = fetchAccountSigners($accountId, $net);
        $requiredWeight = (int)($meta['thresholds']['med'] ?? 0);
        $signerMeta = $providedSigners && count($providedSigners) > 0 ? $providedSigners : $meta['signers'];
        $requiredWeight = $providedRequired ?? (int)($meta['thresholds']['med'] ?? 0);
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
        $items = loadJobs($jobFile);
        array_unshift($items, $job);
        saveJobs($jobFile, $items);
        return sendJson($job);
    } catch (\Throwable $e) {
        return sendError('server_error', $e->getMessage(), 500);
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
    $items = array_map('summarizeJob', array_values($items));
    // hide raw XDR in list
    $out = array_map(function ($j) {
        $c = $j;
        unset($c['txXdrCurrent'], $c['txXdrOriginal']);
        return $c;
    }, array_values($items));
    return sendJson($out);
}

// GET /api/multisig/jobs/:id
if ($method === 'GET' && ($m = matchRoute($path, '/api/multisig/jobs/:id'))) {
    $id = $m['id'] ?? '';
    $items = loadJobs($jobFile);
    foreach ($items as $j) {
        if (($j['id'] ?? '') === $id) {
            return sendJson(summarizeJob($j));
        }
    }
    return sendJson(['error' => 'not_found'], 404);
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
        $providedSigners = [];
        if (isset($body['signers']) && is_array($body['signers'])) {
            foreach ($body['signers'] as $s) {
                $pk = $s['publicKey'] ?? '';
                $w = (int)($s['weight'] ?? 0);
                if ($pk && $w > 0) $providedSigners[] = ['publicKey' => $pk, 'weight' => $w];
            }
        }
        if (!$signedXdr) return sendJson(['error' => 'invalid_xdr'], 400);

        $items = loadJobs($jobFile);
        $found = false;
        foreach ($items as &$j) {
            if (($j['id'] ?? '') !== $id) continue;
            $found = true;
            $net = $j['network'] ?? 'public';
            $parseErr = null;
            $incoming = parseTx($signedXdr, $net, $parseErr);
            if (!$incoming) return sendJson(['error' => 'invalid_xdr', 'detail' => $parseErr], 400);
            $hash = txHash($incoming, $net);
            if ($hash !== ($j['txHash'] ?? '')) return sendJson(['error' => 'mismatched_hash'], 400);

            $currentErr = null;
            $current = parseTx($j['txXdrCurrent'] ?? $j['txXdrOriginal'] ?? '', $net, $currentErr);
            if (!$current) $current = $incoming;
            $merged = mergeSignatures($current, $incoming);
            $signerMeta = $providedSigners && count($providedSigners) > 0 ? $providedSigners : ($j['signers'] ?? []);
            if (!$signerMeta || count($signerMeta) === 0) {
                $meta = fetchAccountSigners($j['accountId'] ?? '', $net);
                $signerMeta = $meta['signers'];
                $j['thresholds'] = $j['thresholds'] ?? $meta['thresholds'];
                $j['requiredWeight'] = $j['requiredWeight'] ?? (int)($meta['thresholds']['med'] ?? 0);
                $j['signers'] = $signerMeta;
            }
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
            break;
        }
        unset($j);
        if (!$found) return sendJson(['error' => 'not_found'], 404);
        saveJobs($jobFile, $items);
        foreach ($items as $row) {
            if (($row['id'] ?? '') === $id) {
                return sendJson($row);
            }
        }
        return sendJson(['error' => 'not_found'], 404);
    } catch (\Throwable $e) {
        return sendError('server_error', $e->getMessage(), 500);
    }
}

// DELETE /api/multisig/jobs?network=testnet&confirm=DELETE TESTNET JOBS
if ($method === 'DELETE' && $path === '/api/multisig/jobs') {
    $net = normalizeNetwork($_GET['network'] ?? null);
    $confirm = $_GET['confirm'] ?? '';
    $adminToken = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    $requiredToken = getenv('MULTISIG_ADMIN_TOKEN') ?: '';

    if (!$net) return sendJson(['error' => 'invalid_network'], 400);
    if ($net === 'testnet') {
        if ($confirm !== 'DELETE TESTNET JOBS') return sendJson(['error' => 'confirm_required'], 400);
    } else {
        if (!$requiredToken || !$adminToken || $adminToken !== $requiredToken) {
            return sendJson(['error' => 'unauthorized'], 401);
        }
        if ($confirm !== 'DELETE ALL JOBS') return sendJson(['error' => 'confirm_required'], 400);
    }

    $items = loadJobs($jobFile);
    $before = count($items);
    $items = array_values(array_filter($items, function ($j) use ($net) {
        return ($j['network'] ?? '') !== $net;
    }));
    saveJobs($jobFile, $items);
    return sendJson(['deleted' => $before - count($items)]);
}

// Fallback
sendJson(['error' => 'not_found'], 404);
