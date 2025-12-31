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
header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
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

// Routing
$path = parse_url($uri, PHP_URL_PATH) ?? '/';

// POST /api/multisig/jobs
if ($method === 'POST' && $path === '/api/multisig/jobs') {
    try {
        $body = jsonBody();
        $net = normalizeNetwork($body['network'] ?? null);
        $accountId = $body['accountId'] ?? '';
        $txXdr = $body['txXdr'] ?? '';
        if (!$net) return sendJson(['error' => 'invalid_network'], 400);
        if (!$accountId) return sendJson(['error' => 'invalid_account'], 400);
        if (!$txXdr) return sendJson(['error' => 'invalid_xdr'], 400);

        $parseErr = null;
        $tx = parseTx($txXdr, $net, $parseErr);
        if (!$tx) return sendJson(['error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        $hash = txHash($tx, $net);
        $meta = fetchAccountSigners($accountId, $net);
        $requiredWeight = (int)($meta['thresholds']['med'] ?? 0);
        $collected = verifyCollected($tx, $net, $meta['signers']);
        $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
        $status = ($requiredWeight > 0 && $collectedWeight >= $requiredWeight) ? 'ready_to_submit' : 'pending_signatures';
        $submittedResult = null;
        if ($status === 'ready_to_submit' && $requiredWeight > 0) {
            try {
                $submittedResult = submitToNetwork($tx, $net);
                $status = 'submitted_success';
            } catch (\Throwable $submitErr) {
                $submittedResult = ['error' => $submitErr->getMessage()];
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
            'signers' => $meta['signers'],
            'thresholds' => $meta['thresholds'],
            'requiredWeight' => $requiredWeight,
            'collectedSigners' => $collected,
            'collectedWeight' => $collectedWeight,
            'submittedResult' => $submittedResult,
            'submittedAt' => $submittedResult ? gmdate('c') : null,
        ];
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
            return sendJson($j);
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
            $signerMeta = $j['signers'] ?? [];
            if (!$signerMeta || count($signerMeta) === 0) {
                $meta = fetchAccountSigners($j['accountId'] ?? '', $net);
                $signerMeta = $meta['signers'];
                $j['thresholds'] = $j['thresholds'] ?? $meta['thresholds'];
                $j['requiredWeight'] = $j['requiredWeight'] ?? (int)($meta['thresholds']['med'] ?? 0);
                $j['signers'] = $signerMeta;
            }
            $collected = verifyCollected($merged, $net, $signerMeta);
            $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
            $required = (int)($j['requiredWeight'] ?? 0);
            $status = ($required > 0 && $collectedWeight >= $required) ? 'ready_to_submit' : 'pending_signatures';
            $submittedResult = $j['submittedResult'] ?? null;
            if ($status === 'ready_to_submit' && $required > 0) {
                try {
                    $submittedResult = submitToNetwork($merged, $net);
                    $status = 'submitted_success';
                } catch (\Throwable $submitErr) {
                    $submittedResult = ['error' => $submitErr->getMessage()];
                    $status = 'submitted_failed';
                }
            }

            $j['txXdrCurrent'] = $merged->toEnvelopeXdrBase64();
            $j['collectedSigners'] = $collected;
            $j['collectedWeight'] = $collectedWeight;
            $j['status'] = $status;
            $j['submittedResult'] = $submittedResult;
            $j['submittedAt'] = $submittedResult ? gmdate('c') : null;
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

// Fallback
sendJson(['error' => 'not_found'], 404);
