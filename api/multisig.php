<?php
// Minimal PHP implementation of the multisig job endpoints.
// Requires vendor/autoload.php (built locally via Composer and uploaded together with this file).
// Endpoints:
//   POST   /api/multisig/jobs
//   GET    /api/multisig/jobs
//   GET    /api/multisig/jobs/:id
//   POST   /api/multisig/jobs/:id/challenge
//   POST   /api/multisig/jobs/:id/token
//   POST   /api/multisig/jobs/:id/merge-signed-xdr
//   POST   /api/multisig/jobs/:id/decline
//   POST   /api/multisig/jobs/:id/delete

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

require __DIR__ . '/challengeStore.php';
require_once __DIR__ . '/rateLimit.php';
require_once __DIR__ . '/stellarNetworks.php';
require_once __DIR__ . '/addressKind.php';
require __DIR__ . '/txSignatures.php';
require __DIR__ . '/multisigJobsGuard.php';
require __DIR__ . '/multisigLifecycle.php';
require __DIR__ . '/multisigDecline.php';
require __DIR__ . '/submitResult.php';
require __DIR__ . '/submitUnclear.php';

use Soneso\StellarSDK\StellarSDK;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\FeeBumpTransaction;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;
use phpseclib3\Math\BigInteger;

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
    // G5: kaputtes JSON (oder Skalar statt Objekt) ergibt 400 invalid_json, ohne den Body
    // zu wiederholen. Wie Node (Fehlerbehandlung nach express.json) und api/bugreport.php.
    if (!is_array($data)) {
        sendError('invalid_json', null, 400);
        exit;
    }
    return $data;
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
// signature into it. Accepted only via the x-job-token header, like server.js:
// a ?token= query parameter would end up in access logs and browser history,
// and the frontend never sends one (#8, parity with Node).
function newAccessToken(): string {
    return bin2hex(random_bytes(32));
}

function getRequestToken(): string {
    $header = $_SERVER['HTTP_X_JOB_TOKEN'] ?? '';
    return is_string($header) ? trim($header) : '';
}

function hasValidJobToken(array $job): bool {
    $expected = (string)($job['accessToken'] ?? '');
    $provided = getRequestToken();
    if ($expected === '' || $provided === '') return false;
    return hash_equals($expected, $provided);
}

// K1: Signer und Gewichte eines Jobs kommen aus accountId, das Netz prueft die
// Signaturen aber gegen die Quelle der Transaktion. Beide muessen uebereinstimmen.
// Gleicher Wortlaut wie in server.js.
function sendAccountMismatch(): void {
    sendJson(['ok' => false, 'error' => 'account_mismatch', 'detail' => 'Transaction source does not match accountId.'], 400);
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
    // R-7: submittedResult aller Jobs bereinigen (idempotent), damit auch Altjobs envelope_xdr/result_xdr
    // verlieren, sobald die Datei einmal geschrieben wird. Gleich wie saveMultisigDb in server.js.
    $payload = ['items' => array_values(array_map('skm_with_sanitized_submit_result', $items))];
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
    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
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
        $items = expireStalePendingJobs($items);
        $items = pruneOldJobs($items);
        saveJobs($jobFile, $items);
        return $items;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

function normalizeNetwork(?string $net): ?string {
    return skm_normalize_network($net);
}

// R1: Der Guzzle-Client des SDK hat standardmaessig keinen Timeout; ein haengendes Horizon
// blockiert die Anfrage dann bis zum PHP-Limit. Gleiche Grenze wie Node (10 s).
const HORIZON_LOAD_TIMEOUT_SECONDS = 10;

function horizonClient(string $net): StellarSDK {
    $sdk = $net === 'public'
        ? StellarSDK::getPublicNetInstance()
        : StellarSDK::getTestNetInstance();
    $sdk->setHttpClient(new \GuzzleHttp\Client([
        'base_uri' => skm_horizon_url($net === 'public' ? 'public' : 'testnet'),
        'connect_timeout' => 5,
        'timeout' => HORIZON_LOAD_TIMEOUT_SECONDS,
    ]));
    return $sdk;
}

function networkObj(string $net): Network {
    return skm_network_obj($net);
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

// F-2: Sende-Timeout. Danach ist das Ergebnis unklar (submit_unclear), nicht fehlgeschlagen.
// Gleich wie Node (HORIZON_SUBMIT_TIMEOUT_MS, Standard 20 s).
const HORIZON_SUBMIT_TIMEOUT_SECONDS = 20;

// Sendet und ordnet das Ergebnis ein (F-2), gleich wie submitJobTx in server.js: 2xx mit Hash ist
// Erfolg (Rueckgabe). Unklar (SubmitUnclearException): keine Antwort, Timeout, 408, 429, >= 500 ohne
// result_codes, 2xx ohne Hash. Sonst Ablehnung (SubmitFailedException mit extras).
function submitToNetwork(AbstractTransaction $tx, string $net): array {
    $horizon = skm_horizon_url($net);
    $xdr = $tx->toEnvelopeXdrBase64();
    $ch = curl_init($horizon . '/transactions');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query(['tx' => $xdr]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, HORIZON_SUBMIT_TIMEOUT_SECONDS);
    $respBody = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($respBody === false) {
        throw new SubmitUnclearException($curlErrno === CURLE_OPERATION_TIMEDOUT ? 'submit_timeout' : ($curlError !== '' ? $curlError : 'submit_no_response'));
    }
    $data = json_decode($respBody, true);
    if (skm_submit_response_is_unclear((int)$httpCode, $data)) {
        $isSuccessCode = $httpCode >= 200 && $httpCode < 300;
        $message = $isSuccessCode ? 'submit_no_hash' : (is_array($data) ? ($data['title'] ?? $data['detail'] ?? null) : null);
        throw new SubmitUnclearException(is_string($message) && $message !== '' ? $message : 'submit_unclear');
    }
    if ($httpCode >= 200 && $httpCode < 300) {
        // F-3: nur Hash und Ledger speichern (kein envelope_xdr/result_xdr).
        return skm_submit_success_result($data);
    }
    $extras = [];
    if (is_array($data) && isset($data['extras'])) $extras = $data['extras'];
    // Fehlertext zuerst title, dann detail, wie Node (submitErrorResult in services/submitResult.js).
    throw new SubmitFailedException($data['title'] ?? $data['detail'] ?? 'submit_failed', $extras);
}

// F-2: Abruf GET /transactions/{hash} fuer die Klaerung. 404 = nicht im Ledger, alles andere ohne
// Datensatz (Netz, Timeout, 5xx, kaputtes JSON) = Fehler, der Job bleibt dann unklar. Der Datensatz zaehlt nur
// zum abgefragten Hash (auch als innerer Hash eines Fee-Bumps), siehe skm_transaction_lookup_from_record (ADR 0014).
function lookupTransactionByHash(string $net, string $hash): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $hash)) return ['kind' => 'error'];
    $ch = curl_init(skm_horizon_url($net) . '/transactions/' . $hash);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, HORIZON_LOAD_TIMEOUT_SECONDS);
    $respBody = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($respBody === false) return ['kind' => 'error'];
    if ($httpCode === 404) return ['kind' => 'not_found'];
    $data = json_decode((string)$respBody, true);
    if ($httpCode !== 200 || !is_array($data)) return ['kind' => 'error'];
    return skm_transaction_lookup_from_record($data, $hash);
}

// R-1: Ledger-Zeit von Horizon (GET /, history_latest_ledger_closed_at) als Unix-Sekunden, null bei
// Fehler, Timeout oder fehlendem Feld. Nur nach einem 404 in der Klaerung abgefragt. Gleich wie
// fetchLedgerClosedAt in server.js.
function fetchLedgerClosedAt(string $net): ?int {
    $ch = curl_init(skm_horizon_url($net) . '/');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, HORIZON_LOAD_TIMEOUT_SECONDS);
    $respBody = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($respBody === false || $httpCode !== 200) return null;
    $data = json_decode((string)$respBody, true);
    return is_array($data) ? skm_parse_ledger_closed_at($data['history_latest_ledger_closed_at'] ?? null) : null;
}

function fetchAccountSigners(string $accountId, string $net): array {
    try {
        $sdk = horizonClient($net);
        $account = $sdk->requestAccount($accountId);
        $signers = [];
        foreach ($account->getSigners() as $s) {
            // Mit Signer-Typ aus Horizon, gegen den Schluessel geprueft (ADR 0012, Plan 8.2 Teilschritt 5).
            $signers[] = [
                'publicKey' => $s->getKey(),
                'weight' => (int)$s->getWeight(),
                'type' => skm_signer_type_of(['key' => $s->getKey(), 'type' => $s->getType()]),
            ];
        }
        $thr = $account->getThresholds();
        return [
            'ok' => true,
            'signers' => $signers,
            'thresholds' => [
                'low' => (int)$thr->getLowThreshold(),
                'med' => (int)$thr->getMedThreshold(),
                'high' => (int)$thr->getHighThreshold(),
            ],
            // G5 stage 1: the account's current live sequence number, used by
            // computeMultisigLifecycleStatus() to detect a job whose baked-in
            // sequence has already been consumed by another transaction.
            'sequence' => (string)$account->getSequenceNumber(),
        ];
    } catch (\Throwable $e) {
        // 'ok' => false marks this as a failed lookup (Horizon unreachable or
        // account not found), as opposed to a genuinely empty signer list -
        // which cannot occur for an existing account (Horizon always reports
        // at least the master key as a signer). Callers that would destroy
        // data on an empty list (the merge route's signature filtering) must
        // treat this as "unknown", never as "no signers".
        // R2: notFound = Horizon kennt das Konto nicht (404), alles andere ist "nicht erreichbar".
        $notFound = $e instanceof \Soneso\StellarSDK\Exceptions\HorizonRequestException && $e->getStatusCode() === 404;
        return ['ok' => false, 'signers' => [], 'thresholds' => ['low' => 0, 'med' => 0, 'high' => 0], 'sequence' => null, 'notFound' => $notFound];
    }
}

// R2: Eine fehlgeschlagene Abfrage, die nicht "Konto unbekannt" heisst, sagt nichts ueber die
// Signer. Token, Ablehnen und Loeschen antworten dann 503 horizon_unavailable statt 403
// forbidden ("kein Signer"). Gleiche Regel wie sendSignerLookupFailed in server.js.
function signerLookupUnavailable(array $meta): bool {
    return ($meta['ok'] ?? true) === false && !($meta['notFound'] ?? false);
}

function signersCacheFilePath(): string {
    // v2 seit dem Signer-Typ (ADR 0012): Eintraege der alten Datei hatten keinen Typ und werden nicht
    // mehr gelesen. Die alte Datei signers_cache.json kann auf dem Server geloescht werden.
    return __DIR__ . '/data/signers_cache_v2.json';
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
    // Failed lookups are never written to the cache: a cached failure would
    // otherwise be served for the full TTL, turning one transient Horizon
    // hiccup into 30 seconds of "this account has no signers" - which the
    // merge route must treat as a hard error (see there). The in-request memo
    // above still holds it so a single request stays self-consistent.
    if (($data['ok'] ?? true) !== false) {
        $cache[$key] = ['data' => $data, 'fetchedAt' => time()];
        saveSignersCache($cacheFile, $cache);
    }
    return $data;
}

function matchRoute(string $uri, string $pattern): ?array {
    $regex = '#^' . preg_replace('#:([a-zA-Z0-9_]+)#', '(?P<$1>[^/]+)', $pattern) . '$#';
    if (preg_match($regex, $uri, $m)) {
        return $m;
    }
    return null;
}

// verifyCollected() and mergeSignatures() now live in txSignatures.php
// alongside filterValidSignatures(), which they're tightly coupled to - all
// three are stateless helpers over a transaction's signature list, moved out
// so they (and the H2/M1 fixes in them) can be exercised directly in tests
// without loading this whole routed script.

/**
 * Enriches a job array with collected/missing signer info and recalculates status if not final.
 *
 * F-11 / F-8: Offene Jobs werden beim Lesen live neu berechnet, wenn Horizon antwortet: Signer,
 * Schwellen und requiredWeight kommen aus dem Konto, collected aus verifyCollected gegen diese Signer,
 * der Status aus Lebenszyklus bzw. Gewicht. Vorher galt der gespeicherte Stand (z. B. ein inzwischen
 * entfernter Signer zaehlte weiter, ein bei Horizon-Ausfall angelegter Job blieb bei "noetig: 1").
 * Antwortet Horizon nicht, bleibt der gespeicherte Stand. Endzustaende: keine Abfrage, gespeicherter
 * Stand. Auf gespeicherte collectedSigners wird nur bei nicht lesbarem XDR zurueckgegriffen.
 * submit_unclear (F-2): Signer und Gewicht live wie bei offenen Jobs, der Status bleibt; aendern darf
 * ihn nur die Klaerung (resolveUnclearJobs). Nichts davon wird hier gespeichert (nur Anlegen, Merge
 * und die Klaerung speichern). Gleich wie annotateJobsLifecycleStatus in server.js.
 */
function summarizeJob(array $job): array {
    $net = $job['network'] ?? 'public';
    $accountId = $job['accountId'] ?? '';
    $txXdr = $job['txXdrCurrent'] ?? ($job['txXdrOriginal'] ?? ($job['txXdr'] ?? ''));

    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
    $isFinal = in_array($job['status'] ?? '', $finalStates, true);

    $parseErr = null;
    $tx = $txXdr ? parseTx($txXdr, $net, $parseErr) : null;

    // Nur fuer offene Jobs (gecacht, 30 s). Signer, Schwellen und Sequenz kommen aus accountId:
    // Seit K1 erzwingen Anlegen und Merge, dass die Quelle der Transaktion (Basiskonto) gleich
    // accountId ist, die Sequenz von accountId ist also die der Tx-Quelle. Altjobs von vor K1 nehmen
    // keine Signatur mehr an und laufen ab.
    $meta = $isFinal ? null : fetchAccountSignersCached($accountId, $net);
    $live = $meta !== null && ($meta['ok'] ?? true) !== false;

    $signers = $live ? ($meta['signers'] ?? []) : (is_array($job['signers'] ?? null) ? $job['signers'] : []);
    if ($live) $job['thresholds'] = $meta['thresholds'];
    if ($live && $tx) {
        $requiredWeight = requiredWeightForOperations($tx, $meta['thresholds']);
    } else {
        $requiredWeight = (int)($job['requiredWeight'] ?? ($tx ? requiredWeightForOperations($tx, $job['thresholds'] ?? []) : ($job['thresholds']['med'] ?? 0)));
    }
    $accountSequence = ($live && ($meta['sequence'] ?? null) !== null) ? new BigInteger($meta['sequence']) : null;
    $job['signers'] = $signers;
    $job['requiredWeight'] = $requiredWeight;
    // ADR 0013: fremde op.source-Konten aus dem XDR (auch fuer Altjobs ohne gespeichertes Feld).
    $job['foreignOpSources'] = $tx ? foreignOpSourcesOf($tx, $accountId) : (is_array($job['foreignOpSources'] ?? null) ? array_values($job['foreignOpSources']) : []);

    if ($tx) {
        $collected = verifyCollected($tx, $net, $signers);
    } else {
        // Nur bei nicht lesbarem XDR: der gespeicherte Stand (F-11).
        $collected = is_array($job['collectedSigners'] ?? null) ? array_values($job['collectedSigners']) : [];
    }
    $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
    $collectedMap = [];
    foreach ($collected as $c) {
        $pk = $c['publicKey'] ?? null;
        if ($pk) $collectedMap[$pk] = true;
    }
    $missing = array_values(array_filter($signers, function ($s) use ($collectedMap) {
        $pk = $s['publicKey'] ?? '';
        $weight = (int)($s['weight'] ?? 0);
        // Nur Signer, die signieren koennen (Ed25519); Hash-, Pre-Auth- und Signed-Payload-Signer fehlen nie.
        return $pk && $weight > 0 && !isset($collectedMap[$pk])
            && skm_is_interactive_signer(['key' => $pk, 'type' => $s['type'] ?? null]);
    }));
    $missingWeight = array_reduce($missing, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);

    $job['collectedSigners'] = $collected;
    $job['collectedWeight'] = $collectedWeight;
    $job['missingSigners'] = $missing;
    $job['missingWeight'] = $missingWeight;

    if (!$isFinal && ($job['status'] ?? '') !== SUBMIT_UNCLEAR_STATUS) {
        // G5 stage 1: a frozen sequence/timebound that has since become
        // unreachable on-chain overrides the collected-vs-required weight
        // computation below - no amount of additional signatures can save a
        // job whose sequence slot was consumed by another transaction or
        // whose timebound already passed.
        $lifecycleStatus = $tx ? computeMultisigLifecycleStatus($tx, $accountSequence, time()) : null;
        $job['status'] = $lifecycleStatus
            ?? (($requiredWeight > 0 && $collectedWeight >= $requiredWeight) ? 'ready_to_submit' : 'pending_signatures');
    }

    // F-3: jede Ausgabe eines Jobs laeuft hier durch; bereinigt auch Altjobs (envelope_xdr/result_xdr fallen weg).
    return skm_with_sanitized_submit_result($job);
}

/**
 * F-2: Klaerung offener submit_unclear-Jobs beim Lesen (Liste, Detail). $jobs sind Ausgaben von
 * summarizeJob() (noch mit XDR). Nur mit Live-Kontodaten und nur, wenn das Ergebnis feststehen kann
 * (Sequence der Tx-Quelle verbraucht oder maxTime laut Serveruhr vorbei; ein 404 zaehlt erst, wenn
 * Horizon einen Ledger mehr als 60 s nach maxTime meldet, R-1, siehe skm_unclear_outcome), hoechstens
 * SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST Abfragen je Anfrage. Die Abfragen laufen ausserhalb des
 * Locks; gespeichert wird unter withJobsLock und nur fuer Jobs, die dort noch submit_unclear sind.
 * Scheitert das Speichern, bleibt der Job unklar (auch in der Antwort). Gleich wie
 * resolveUnclearJobs in server.js.
 *
 * ADR 0014: Dieselbe Klaerung prueft auch Jobs, die ausserhalb von SKM gesendet worden sein koennen: gespeichert
 * offen oder in einem Endzustand, den SKM ohne Blick ins Ledger setzt (skm_is_external_check_candidate), mit laut
 * Live-Daten verbrauchter Sequence. Gemeinsames Budget, Reihenfolge nach skm_compare_resolve_priority. Ergebnis
 * aus skm_external_outcome, gespeichert unter withJobsLock nur, wenn der Job dort noch denselben Status hat wie
 * beim Lesen und noch Kandidat ist. Jede gespeicherte Klaerung (auch submit_unclear) setzt ledgerCheckedAt: Der
 * Job ist im Ledger geprueft und wird danach nie wieder abgefragt. Gesendet wird nie.
 */
/**
 * ES-11: Konto, dessen Sequence die Job-Transaktion verbraucht, also das Basiskonto der Tx-Quelle. Seit K1 gleich
 * accountId; bei Altjobs von vor K1 ein anderes Konto. Gleich wie sequenceAccountOf in server.js.
 */
function skm_sequence_account_of(array $job, ?AbstractTransaction $tx): string {
    $source = $tx !== null ? txSourceBaseAccount($tx) : null;
    return $source ?? (string)($job['accountId'] ?? '');
}

/**
 * Sequence laut Live-Kontodaten verbraucht: true/false, null = unbekannt (Horizon-Fehler, Timeout). Kennt Horizon das
 * Konto nicht (404, z. B. nach einem accountMerge), gilt die Sequence als verbraucht (ES-4). Gleich wie
 * sequenceConsumedFromMeta in server.js.
 */
function skm_sequence_consumed_from_meta(\Soneso\StellarSDK\Transaction $tx, ?array $meta): ?bool {
    if ($meta === null) return null;
    if (($meta['ok'] ?? true) !== false) {
        return skm_sequence_consumed($tx->getSequenceNumber(), isset($meta['sequence']) ? (string)$meta['sequence'] : null);
    }
    return ($meta['notFound'] ?? false) ? true : null;
}

/**
 * ADR 0014: Gespeicherter Job ist Kandidat der Klaerung und seine Sequence laut Live-Daten verbraucht ($consumed aus
 * skm_sequence_consumed_from_meta). Unbekannt (null) zaehlt als verbraucht: im Zweifel nicht loeschen und nicht zum
 * Neuanlegen auffordern (ES-8). Fee-Bump-Altjobs (keine eigene Sequence) nie. Gleich wie isLedgerCheckPending in server.js.
 */
function skm_ledger_check_pending(array $storedJob, ?AbstractTransaction $tx, ?bool $consumed): bool {
    return skm_is_external_check_candidate($storedJob) && $tx instanceof \Soneso\StellarSDK\Transaction && $consumed !== false;
}

function resolveUnclearJobs(string $jobFile, array $jobs): array {
    $nowUnix = time();
    // Gespeicherter Status je Job (summarizeJob rechnet ihn fuer offene Jobs neu), nur bei Bedarf geladen.
    $storedById = null;
    $candidates = [];
    foreach ($jobs as $index => $j) {
        $id = (string)($j['id'] ?? '');
        if (($j['status'] ?? '') === SUBMIT_UNCLEAR_STATUS) {
            $readStatus = SUBMIT_UNCLEAR_STATUS;
        } else {
            if (!in_array($j['status'] ?? '', EXTERNAL_CHECK_STATUSES, true)) continue;
            if ($storedById === null) {
                $storedById = [];
                foreach (loadJobs($jobFile) as $it) $storedById[(string)($it['id'] ?? '')] = $it;
            }
            $stored = $storedById[$id] ?? null;
            if (!skm_is_external_check_candidate($stored)) continue;
            $readStatus = (string)$stored['status'];
        }
        $net = $j['network'] ?? 'public';
        $parseErr = null;
        $tx = parseTx((string)($j['txXdrCurrent'] ?? ($j['txXdrOriginal'] ?? '')), $net, $parseErr);
        // Fee-Bump (Altjob): keine eigene Sequence und kein Zeitfenster, bleibt wie er ist.
        if (!($tx instanceof \Soneso\StellarSDK\Transaction)) continue;
        $candidates[] = [
            'index' => $index, 'id' => $id, 'job' => $j, 'tx' => $tx, 'net' => $net, 'readStatus' => $readStatus,
            'unclear' => $readStatus === SUBMIT_UNCLEAR_STATUS, 'maxTimeUnix' => extractMaxTimeUnix($tx),
            // ES-2: mindestens eine gueltige gesammelte Signatur eines Signers des Job-Kontos (verifyCollected beim Lesen).
            'signed' => (int)($j['collectedWeight'] ?? 0) > 0,
        ];
    }
    usort($candidates, fn(array $a, array $b) => skm_compare_resolve_priority($a, $b, $nowUnix));

    $budget = SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST;
    $outcomes = [];
    // ES-8: Kandidaten (nicht submit_unclear) mit verbrauchter oder unbekannter Sequence, die diese Anfrage nicht klaert.
    $pending = [];
    // R-1: Ledger-Zeit hoechstens einmal je Netz und Anfrage (auch ein Fehler wird gemerkt).
    $ledgerClosedAtByNet = [];
    $ledgerClosedAt = function (string $net) use (&$ledgerClosedAtByNet): ?int {
        if (!array_key_exists($net, $ledgerClosedAtByNet)) $ledgerClosedAtByNet[$net] = fetchLedgerClosedAt($net);
        return $ledgerClosedAtByNet[$net];
    };
    foreach ($candidates as $c) {
        $j = $c['job'];
        $net = $c['net'];
        // Kontodaten auch nach erschoepftem Budget (gecacht 30 s), damit ledgerCheckPending fuer jeden Kandidaten stimmt.
        // ES-11: Sequence der Tx-Quelle (bei Altjobs von vor K1 nicht accountId).
        $meta = fetchAccountSignersCached(skm_sequence_account_of($j, $c['tx']), $net);
        $sequenceConsumed = skm_sequence_consumed_from_meta($c['tx'], $meta);
        if (!$c['unclear'] && $sequenceConsumed !== false) $pending[$c['index']] = true;
        // Horizon-Fehler: diesmal nicht klaeren.
        if ($sequenceConsumed === null) continue;
        if (!$c['unclear'] && !$sequenceConsumed) {
            // ES-9: Endzustand mit freier Sequence. Erst nach maxTime plus Marge laut Serveruhr nach der Ledger-Zeit
            // fragen (keine Abfrage der Transaktion, kein Budget); entscheidet die Ledger-Zeit (R-1), bleibt der Status.
            if (!skm_past_max_time_by_clock($c['maxTimeUnix'], $nowUnix) || skm_external_unconsumed_outcome($c['readStatus'], true) === null) continue;
            $outcome = skm_external_unconsumed_outcome($c['readStatus'], skm_ledger_past_max_time($c['maxTimeUnix'], $ledgerClosedAt($net)));
        } else {
            if ($c['unclear'] && !skm_unclear_resolve_due($sequenceConsumed, $c['maxTimeUnix'], $nowUnix)) continue;
            if ($budget <= 0) continue;
            $budget--;
            $lookup = lookupTransactionByHash($net, (string)($j['txHash'] ?? ''));
            // Ein 404 ist nur endgueltig, wenn Horizon einen Ledger mehr als 60 s nach maxTime meldet (R-1, nicht die Serveruhr).
            $ledgerPast = ($lookup['kind'] ?? '') === 'not_found' && skm_ledger_past_max_time($c['maxTimeUnix'], $ledgerClosedAt($net));
            $outcome = $c['unclear']
                ? skm_unclear_outcome($lookup, $sequenceConsumed, $ledgerPast)
                : skm_external_outcome($lookup, $ledgerPast, $c['readStatus']);
        }
        if ($outcome !== null) $outcomes[$c['id']] = ['outcome' => $outcome, 'readStatus' => $c['readStatus'], 'unclear' => $c['unclear']];
    }
    // ES-8: ledgerCheckPending nur in der Antwort, nie gespeichert. Gleich wie server.js.
    foreach ($jobs as $index => &$jp) $jp['ledgerCheckPending'] = isset($pending[$index]);
    unset($jp);
    if ($outcomes === []) return $jobs;

    $applied = [];
    try {
        withJobsLock($jobFile, function (array $items) use ($outcomes, &$applied) {
            foreach ($items as &$it) {
                $id = (string)($it['id'] ?? '');
                if (!isset($outcomes[$id])) continue;
                $o = $outcomes[$id];
                // Inzwischen geaendert (Merge, Ablehnen, Waechter, Senden): nichts speichern. Geloeschte Jobs fehlen hier.
                if (($it['status'] ?? '') !== $o['readStatus']) continue;
                if (!$o['unclear'] && !skm_is_external_check_candidate($it)) continue;
                if ($o['unclear']) {
                    $it['status'] = $o['outcome']['status'];
                    if (array_key_exists('submittedResult', $o['outcome'])) $it['submittedResult'] = $o['outcome']['submittedResult'];
                    $it['resolvedAt'] = gmdate('c');
                    $it['ledgerCheckedAt'] = $it['resolvedAt'];
                } else {
                    foreach ($o['outcome'] as $k => $v) $it[$k] = $v;
                    $it['ledgerCheckedAt'] = gmdate('c');
                }
                $applied[$id] = $it;
            }
            unset($it);
            return $items;
        });
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.resolve_unclear failed: ' . $e->getMessage());
        return $jobs;
    }
    foreach ($jobs as &$j) {
        $id = (string)($j['id'] ?? '');
        if (!isset($applied[$id])) continue;
        $row = $applied[$id];
        $j['ledgerCheckPending'] = false;
        $j['status'] = $row['status'];
        $j['submittedResult'] = skm_sanitize_submitted_result($row['submittedResult'] ?? null);
        $j['ledgerCheckedAt'] = $row['ledgerCheckedAt'];
        if ($outcomes[$id]['unclear']) {
            $j['resolvedAt'] = $row['resolvedAt'];
        } else {
            if (array_key_exists('submittedAt', $row)) $j['submittedAt'] = $row['submittedAt'];
            if (array_key_exists('submittedExternally', $row)) $j['submittedExternally'] = $row['submittedExternally'];
        }
    }
    unset($j);
    return $jobs;
}

/**
 * R-3: Ergebnis eines Sendens nach dem Write-ahead schreiben (Anlegen, Merge). Unter withJobsLock und nur,
 * wenn der Job dort noch submit_unclear ist; hat die Klaerung ihn inzwischen entschieden, bleibt das. Gibt
 * den gespeicherten Job zurueck (oder null, wenn es ihn nicht mehr gibt). Wirft, wenn das Speichern
 * scheitert: Dann steht der Write-ahead-Stand (submit_unclear) in der Datei. Gleich wie applySubmitOutcome
 * in server.js.
 */
function applySubmitOutcome(string $jobFile, string $id, string $status, ?array $submittedResult): ?array {
    $row = null;
    withJobsLock($jobFile, function (array $items) use ($id, $status, $submittedResult, &$row) {
        foreach ($items as &$it) {
            if (($it['id'] ?? '') !== $id) continue;
            if (($it['status'] ?? '') === SUBMIT_UNCLEAR_STATUS) {
                $it['status'] = $status;
                $it['submittedResult'] = $submittedResult;
                $it['submittedAt'] = gmdate('c');
            }
            $row = $it;
        }
        unset($it);
        return $items;
    });
    return $row;
}

// Routing
$path = parse_url($uri, PHP_URL_PATH) ?? '/';

// POST /api/multisig/jobs
if ($method === 'POST' && $path === '/api/multisig/jobs') {
    // B3-1: wurde schon an Horizon gesendet, bevor das Speichern scheitert, meldet der catch-Block
    // einen eigenen Code (die Transaktion kann im Netz sein).
    $submitAttempted = false;
    try {
        // Public, unauthenticated action (anyone may propose a job for any
        // account) - rate-limited per IP so it can't be used to grow
        // multisig_jobs.json without bound (analyse_multisig.md a2).
        $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $retryAfter = multisigJobRateLimitCheckAndRecord($ip);
        if ($retryAfter > 0) {
            header('Retry-After: ' . $retryAfter);
            return sendJson(['ok' => false, 'error' => 'too_many_requests', 'retryAfter' => $retryAfter], 429);
        }

        $body = jsonBody();
        // Nur ein String ist ein Netz: Array, Zahl, Objekt ergeben 400 invalid_network (nie TypeError/500). Wie Node.
        $net = normalizeNetwork(is_string($body['network'] ?? null) ? $body['network'] : null);
        $accountId = is_string($body['accountId'] ?? null) ? trim($body['accountId']) : '';
        $txXdr = $body['txXdr'] ?? '';
        if (!$net) return sendJson(['ok' => false, 'error' => 'invalid_network'], 400);
        if (!skm_is_classic_account($accountId)) return sendJson(['ok' => false, 'error' => 'invalid_account'], 400);
        // Kein String (Zahl, Array, null) ist ungueltiges XDR (400), nie ein TypeError (500). Wie Node.
        if (!is_string($txXdr) || $txXdr === '') return sendJson(['ok' => false, 'error' => 'invalid_xdr'], 400);

        $parseErr = null;
        $tx = parseTx($txXdr, $net, $parseErr);
        if (!$tx) return sendJson(['ok' => false, 'error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        // Fee-Bump ist als Job nicht vorgesehen (#15): ausdruecklich ablehnen, vor Quelle und Zeitgrenze.
        if ($tx instanceof FeeBumpTransaction) return sendJson(['ok' => false, 'error' => 'fee_bump_not_supported'], 400);
        if (txSourceBaseAccount($tx) !== $accountId) return sendAccountMismatch();

        // G5 stage 2: reject a timebound longer than the app's own cap before
        // any Horizon work - clientside multisigTimeoutSeconds is clamped to
        // the same value, but that's trivially bypassable via a direct POST.
        $maxTimeUnix = extractMaxTimeUnix($tx);
        if (!isMultisigTimeboundWithinCap($maxTimeUnix, time())) {
            return sendJson([
                'ok' => false,
                'error' => 'timebound_too_long',
                'maxAllowedSeconds' => MULTISIG_JOB_MAX_TIMEBOUND_SECONDS,
            ], 400);
        }

        $hash = txHash($tx, $net);
        // Signers/thresholds are always derived from the real on-chain account state.
        // Client-supplied signer/weight data is never trusted for authorization decisions
        // (C2/H2) - a request-body fallback used to exist here that let a caller fabricate
        // arbitrary (publicKey, weight) pairs never actually verified against the
        // transaction's signatures; removed.
        $meta = fetchAccountSignersCached($accountId, $net);
        // F-8: Ohne Signer-Daten kein Job. Frueher entstand bei einem Horizon-Ausfall ein Job mit leeren
        // Signern, Schwellen 0 und noetigem Gewicht 1, der bis zum ersten Merge falsch angezeigt wurde
        // und bei ?signer= fuer niemanden sichtbar war. Gleich wie server.js.
        if (($meta['ok'] ?? true) === false) {
            return ($meta['notFound'] ?? false)
                ? sendJson(['ok' => false, 'error' => 'account_not_found'], 400)
                : sendJson(['ok' => false, 'error' => 'horizon_unavailable'], 503);
        }
        // ADR 0014 (ES-1): Eine Transaktion mit verbrauchter Sequence oder abgelaufener maxTime kann nie mehr ins
        // Ledger. Kein Job: sonst liesse sich eine alte, schon ausgefuehrte Transaktion eines fremden Kontos als Job
        // anlegen, die Klaerung zeigte sie als "ausserhalb von SKM gesendet" und belegte das Budget. Gleich wie server.js.
        $liveSequence = ($meta['sequence'] ?? null) !== null ? new BigInteger((string)$meta['sequence']) : null;
        $deadStatus = computeMultisigLifecycleStatus($tx, $liveSequence, time());
        if ($deadStatus !== null) return sendJson(['ok' => false, 'error' => 'tx_not_viable', 'status' => $deadStatus], 409);
        $signerMeta = $meta['signers'];
        $requiredWeight = requiredWeightForOperations($tx, $meta['thresholds']);
        $collected = verifyCollected($tx, $net, $signerMeta);
        $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
        $status = ($requiredWeight > 0 && $collectedWeight >= $requiredWeight) ? 'ready_to_submit' : 'pending_signatures';
        // R-3: Erreicht die Signatur schon die Schwelle, sendet das Backend sofort. Write-ahead: erst als
        // submit_unclear speichern, dann senden, dann das Ergebnis schreiben (applySubmitOutcome). Stirbt
        // der Prozess oder scheitert das Speichern danach, steht der Job gesperrt da und wird geklaert.
        // ADR 0013: Gewicht und Signer fremder op.source-Konten prueft das Backend nicht. Ein solcher Job
        // wird nie automatisch gesendet, auch wenn das Gewicht des Job-Kontos erreicht ist (sonst tx_bad_auth).
        $foreignOpSources = foreignOpSourcesOf($tx, $accountId);
        $willSubmit = $status === 'ready_to_submit' && $requiredWeight > 0 && $foreignOpSources === [];
        if ($willSubmit) $status = SUBMIT_UNCLEAR_STATUS;

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
            // G5 stage 1: precomputed once here so multisigJobsGuard.php's
            // dependency-free expiry guard never needs to parse XDR itself.
            'maxTimeUnix' => $maxTimeUnix,
            'signers' => $signerMeta,
            'thresholds' => $meta['thresholds'],
            'requiredWeight' => $requiredWeight,
            'collectedSigners' => $collected,
            'collectedWeight' => $collectedWeight,
            'foreignOpSources' => $foreignOpSources,
            'submittedResult' => null,
            'submittedAt' => $willSubmit ? gmdate('c') : null,
        ];
        $job = summarizeJob($job);
        // Scheitert dieses Speichern, wurde nichts gesendet (500 save_failed).
        withJobsLock($jobFile, function (array $items) use ($job) {
            array_unshift($items, $job);
            return $items;
        });
        if ($willSubmit) {
            $submitAttempted = true;
            try {
                $sent = ['status' => 'submitted_success', 'submittedResult' => submitToNetwork($tx, $net)];
            } catch (\Throwable $submitErr) {
                // F-3: nur Fehlertext und result_codes, nie envelope_xdr/result_xdr (die Liste ist ohne Token lesbar).
                // F-2: unklar (keine eindeutige Antwort) wird submit_unclear, nicht submitted_failed.
                $sent = [
                    'status' => $submitErr instanceof SubmitUnclearException ? SUBMIT_UNCLEAR_STATUS : 'submitted_failed',
                    'submittedResult' => skm_submit_error_result($submitErr),
                ];
            }
            $row = applySubmitOutcome($jobFile, $job['id'], $sent['status'], $sent['submittedResult']);
            if ($row !== null) $job = summarizeJob($row);
        }
        return sendJson($job);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.create failed: ' . $e->getMessage());
        return sendError($submitAttempted ? 'multisig.jobs.save_failed_after_submit' : 'multisig.jobs.save_failed', null, 500);
    }
}

// GET /api/multisig/jobs
if ($method === 'GET' && $path === '/api/multisig/jobs') {
    // R-8: Rate-Limit je IP (multisigJobsGuard.php), vor allen Pruefungen wie in Node.
    $retryAfter = multisigJobListRateLimitCheckAndRecord((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        return sendJson(['ok' => false, 'error' => 'too_many_requests', 'retryAfter' => $retryAfter], 429);
    }
    $net = normalizeNetwork($_GET['network'] ?? null);
    $accountId = $_GET['accountId'] ?? null;
    $signer = $_GET['signer'] ?? null;
    $status = $_GET['status'] ?? null;

    // Without a scoping filter this would enumerate every job of every
    // account (accountId/signer/status/createdBy metadata across all users) -
    // the frontend's two legitimate discovery flows ("my own jobs" by
    // accountId, "jobs where I'm a signer" by signer public key) always send
    // one of these, so requiring it here costs no real functionality.
    if (!$accountId && !$signer) {
        return sendJson(['ok' => false, 'error' => 'accountId_or_signer_required'], 400);
    }

    $items = loadJobs($jobFile);
    $items = array_filter($items, function ($j) use ($net, $accountId, $signer) {
        if ($net && ($j['network'] ?? '') !== $net) return false;
        if ($accountId && ($j['accountId'] ?? '') !== $accountId) return false;
        if ($signer) {
            $s = array_filter($j['signers'] ?? [], fn($si) => ($si['publicKey'] ?? '') === $signer);
            if (count($s) === 0) return false;
        }
        return true;
    });
    // Jobs are stored newest-first; page through them so a single list call cannot
    // trigger an unbounded number of (now cached) Horizon lookups (C4).
    $items = array_values($items);
    // G5 stage 1 / F3: $total (and pagination itself) intentionally no longer
    // account for $status - status can only be known accurately after
    // summarizeJob() recomputes it below (a stored status can be stale, e.g.
    // a job that just went expired/obsolete_seq), and recomputing every job
    // just to paginate correctly would defeat the point of paging (C4:
    // bounding how many Horizon lookups a single list call can trigger). The
    // X-Total-Count header therefore reflects net/accountId/signer scoping
    // only when $status is also given - matches server.js, which has no
    // pagination/total-count concept at all.
    $total = count($items);
    $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 100;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
    $page = array_slice($items, $offset, $limit);

    $page = array_map('summarizeJob', $page);
    // F-2: vor dem Statusfilter, damit ?status= den geklaerten Stand sieht.
    $page = resolveUnclearJobs($jobFile, $page);
    // Filtered against the freshly recomputed status, not the stored one
    // (server.js's annotateJobsLifecycleStatus() runs before its equivalent
    // filter for the same reason) - a job that just became expired/
    // obsolete_seq must not still be returned under its old ?status=.
    if ($status !== null && $status !== '') {
        $page = array_values(array_filter($page, fn($j) => ($j['status'] ?? '') === $status));
    }
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
            $resolved = resolveUnclearJobs($jobFile, [summarizeJob($j)]);
            return sendJson($resolved[0]);
        }
    }
    return sendJson(['ok' => false, 'error' => 'not_found'], 404);
}

function findJobById(string $jobFile, string $id): ?array {
    foreach (loadJobs($jobFile) as $j) {
        if (($j['id'] ?? '') === $id) return $j;
    }
    return null;
}

function parseSignerPublicKey(string $raw): ?string {
    $signerPk = trim($raw);
    try {
        KeyPair::fromAccountId($signerPk);
    } catch (\Throwable $e) {
        return null;
    }
    return $signerPk;
}

// POST /api/multisig/jobs/:id/challenge - issues a short-lived, single-use
// nonce for (jobId, signerPublicKey), the first half of the possession proof
// required by the /token endpoint below (H1 fix): naming a public key is not
// enough, the caller must additionally sign this nonce with the matching
// private key. Rate-Limit je IP (C2): jede Anfrage schreibt unter dem Lock, den auch
// Token, Ablehnen und Loeschen brauchen. Gezaehlt wird vor allen Pruefungen, wie in Node.
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/challenge'))) {
    $retryAfter = rateLimitCheckAndRecord(
        rateLimitPath('MULTISIG_CHALLENGE_RATE_LIMIT_PATH', 'multisig_challenge_rate_limit.json'),
        (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'),
        MULTISIG_CHALLENGE_RATE_LIMIT_MAX,
        MULTISIG_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS
    );
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        return sendJson(['ok' => false, 'error' => 'too_many_requests', 'retryAfter' => $retryAfter], 429);
    }
    $id = $m['id'] ?? '';
    if (!findJobById($jobFile, $id)) return sendJson(['ok' => false, 'error' => 'not_found'], 404);

    $body = jsonBody();
    $signerPk = parseSignerPublicKey(is_string($body['signer'] ?? null) ? $body['signer'] : '');
    if ($signerPk === null) return sendJson(['ok' => false, 'error' => 'invalid_signer'], 400);

    try {
        return sendJson(createChallenge($id, $signerPk));
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.challenge failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
}

// POST /api/multisig/jobs/:id/token - issues a job's access token to a caller
// who proves BOTH that they hold the private key for the claimed signer
// public key (a valid signature over "skm:token:" plus the nonce from /challenge
// above, sent back in the body field "challenge"; exactly that nonce is checked
// first and consumed regardless of outcome so it can never be replayed) AND - via the account's real, live signer list, never the stored
// job.signers snapshot - that this public key is an active signer (weight > 0)
// of the job's account. This is the only way to obtain a job's token now that
// the list endpoint no longer includes it. (H1 fix: merely naming an active
// signer's public key used to be sufficient, even without ever holding its
// private key.)
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/token'))) {
    $id = $m['id'] ?? '';
    $job = findJobById($jobFile, $id);
    if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);

    $body = jsonBody();
    $signerPk = parseSignerPublicKey(is_string($body['signer'] ?? null) ? $body['signer'] : '');
    if ($signerPk === null) return sendJson(['ok' => false, 'error' => 'invalid_signer'], 400);
    $signature = is_string($body['signature'] ?? null) ? trim($body['signature']) : '';
    if ($signature === '') return sendJson(['ok' => false, 'error' => 'missing_signature'], 400);

    try {
        // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
        $pending = consumeChallenge($id, $signerPk, $body['challenge'] ?? null);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.token challenge lookup failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
    if ($pending === null) return sendJson(['ok' => false, 'error' => 'challenge_missing_or_expired'], 400);
    if (!verifyChallengeSignature($pending['nonce'], $signature, $signerPk, 'token')) {
        return sendJson(['ok' => false, 'error' => 'invalid_signature'], 403);
    }

    $net = $job['network'] ?? 'public';
    $meta = fetchAccountSignersCached($job['accountId'] ?? '', $net);
    if (signerLookupUnavailable($meta)) return sendJson(['ok' => false, 'error' => 'horizon_unavailable'], 503);
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

// POST /api/multisig/jobs/:id/decline - Ablehnen. Der Signer beweist wie beim Token den
// Besitz seines Keys (signierte Challenge), das Job-Token allein sagt nicht, welcher Signer
// es ist. Signer und Gewichte kommen live aus dem Konto. Reicht das Gewicht der uebrigen
// Signer nicht mehr, wird der Job abgelehnt (rejected, Endzustand). Wer schon signiert hat,
// kann nicht mehr ablehnen. Gleiche Reihenfolge der Pruefungen wie in server.js.
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/decline'))) {
    $id = $m['id'] ?? '';
    $job = findJobById($jobFile, $id);
    if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);

    $body = jsonBody();
    $signerPk = parseSignerPublicKey(is_string($body['signer'] ?? null) ? $body['signer'] : '');
    if ($signerPk === null) return sendJson(['ok' => false, 'error' => 'invalid_signer'], 400);
    $signature = is_string($body['signature'] ?? null) ? trim($body['signature']) : '';
    if ($signature === '') return sendJson(['ok' => false, 'error' => 'missing_signature'], 400);

    try {
        // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
        $pending = consumeChallenge($id, $signerPk, $body['challenge'] ?? null);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.decline challenge lookup failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
    if ($pending === null) return sendJson(['ok' => false, 'error' => 'challenge_missing_or_expired'], 400);
    if (!verifyChallengeSignature($pending['nonce'], $signature, $signerPk, 'decline')) {
        return sendJson(['ok' => false, 'error' => 'invalid_signature'], 403);
    }

    $meta = fetchAccountSignersCached($job['accountId'] ?? '', $job['network'] ?? 'public');
    if (signerLookupUnavailable($meta)) return sendJson(['ok' => false, 'error' => 'horizon_unavailable'], 503);
    $liveSigners = $meta['signers'] ?? [];
    $isActiveSigner = false;
    foreach ($liveSigners as $s) {
        if (($s['publicKey'] ?? '') === $signerPk && (int)($s['weight'] ?? 0) > 0) {
            $isActiveSigner = true;
            break;
        }
    }
    if (!$isActiveSigner) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);

    try {
        $result = null;
        $conflict = null;
        $liveThresholds = $meta['thresholds'] ?? [];
        withJobsLock($jobFile, function (array $items) use ($id, $signerPk, $liveSigners, $liveThresholds, &$result, &$conflict) {
            foreach ($items as $i => $j) {
                if (($j['id'] ?? '') !== $id) continue;
                $current = summarizeJob($j);
                $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
                // F-2: submit_unclear ist nicht final, aber gesperrt (die Transaktion kann im Ledger sein).
                if (in_array($current['status'] ?? '', $finalStates, true) || ($current['status'] ?? '') === SUBMIT_UNCLEAR_STATUS) {
                    $conflict = $current['status'];
                    return $items;
                }
                foreach ($current['collectedSigners'] ?? [] as $c) {
                    if (($c['publicKey'] ?? '') === $signerPk) {
                        $conflict = 'already_signed';
                        return $items;
                    }
                }
                // Noetiges Gewicht aus den aktuellen Thresholds, nicht aus dem Stand beim
                // Anlegen: Wurde ein Threshold inzwischen gesenkt, darf der Job nicht
                // faelschlich abgelehnt werden.
                $parseErr = null;
                $tx = parseTx((string)($j['txXdrCurrent'] ?? ($j['txXdrOriginal'] ?? '')), $j['network'] ?? 'public', $parseErr);
                if ($tx && $liveThresholds) {
                    $j['requiredWeight'] = requiredWeightForOperations($tx, $liveThresholds);
                }
                $decision = applyDecline($j, $signerPk, $liveSigners, gmdate('c'));
                $j['declinedSigners'] = $decision['declinedSigners'];
                $j['status'] = $decision['status'];
                $items[$i] = $j;
                $result = ['ok' => true, 'status' => $decision['status'], 'declinedSigners' => $decision['declinedSigners']];
                return $items;
            }
            return $items;
        });
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.decline failed: ' . $e->getMessage());
        return sendError('multisig.jobs.decline_failed', null, 500);
    }
    if ($conflict !== null) return sendJson(['ok' => false, 'error' => $conflict], 409);
    if ($result === null) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
    return sendJson($result);
}

// POST /api/multisig/jobs/:id/delete - einzelnen Job loeschen (C1): nur aktuelle Signer des
// Job-Kontos und nur im Endzustand. Der Signer beweist den Besitz seines Keys wie beim
// Ablehnen per signierter Challenge, hier mit eigenem Zweck "delete"; eine token- oder
// decline-Signatur gilt nicht. Das Job-Token reicht nicht: Es hat auch, wer den Job angelegt
// hat (Anlegen ist offen), und es bleibt gueltig, wenn der Signer spaeter aus dem Konto
// entfernt wird. Signer und Gewicht kommen deshalb live aus dem Konto (Signer-Cache bis
// 30 s). Ein offener Job wuerde durch Loeschen nicht unwirksam, signiertes XDR kann anderswo
// liegen; dafuer gibt es Ablehnen und Widerruf. Gleiche Reihenfolge der Pruefungen wie in
// server.js.
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/delete'))) {
    $id = $m['id'] ?? '';
    $job = findJobById($jobFile, $id);
    if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);

    $body = jsonBody();
    $signerPk = parseSignerPublicKey(is_string($body['signer'] ?? null) ? $body['signer'] : '');
    if ($signerPk === null) return sendJson(['ok' => false, 'error' => 'invalid_signer'], 400);
    $signature = is_string($body['signature'] ?? null) ? trim($body['signature']) : '';
    if ($signature === '') return sendJson(['ok' => false, 'error' => 'missing_signature'], 400);

    try {
        // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
        $pending = consumeChallenge($id, $signerPk, $body['challenge'] ?? null);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.delete_one challenge lookup failed: ' . $e->getMessage());
        return sendError('server_error', null, 500);
    }
    if ($pending === null) return sendJson(['ok' => false, 'error' => 'challenge_missing_or_expired'], 400);
    if (!verifyChallengeSignature($pending['nonce'], $signature, $signerPk, 'delete')) {
        return sendJson(['ok' => false, 'error' => 'invalid_signature'], 403);
    }

    $meta = fetchAccountSignersCached($job['accountId'] ?? '', $job['network'] ?? 'public');
    if (signerLookupUnavailable($meta)) return sendJson(['ok' => false, 'error' => 'horizon_unavailable'], 503);
    $isActiveSigner = false;
    foreach ($meta['signers'] ?? [] as $s) {
        if (($s['publicKey'] ?? '') === $signerPk && (int)($s['weight'] ?? 0) > 0) {
            $isActiveSigner = true;
            break;
        }
    }
    if (!$isActiveSigner) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);

    try {
        $conflict = null;
        $deleted = false;
        $ledgerCheckPending = null;
        withJobsLock($jobFile, function (array $items) use ($id, $meta, &$conflict, &$deleted, &$ledgerCheckPending) {
            foreach ($items as $i => $j) {
                if (($j['id'] ?? '') !== $id) continue;
                $current = summarizeJob($j);
                $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
                if (!in_array($current['status'] ?? '', $finalStates, true)) {
                    $conflict = $current['status'] ?? '';
                    return $items;
                }
                // ADR 0014 (ES-3): Ein Kandidat mit verbrauchter Sequence kann ausserhalb von SKM gesendet worden sein.
                // Erst nach der Klaerung beim Lesen loeschbar, sonst ginge der Nachweis verloren. Gleich wie server.js.
                // ES-11: Sequence der Tx-Quelle; seit K1 ist das accountId, dessen Kontodaten schon geladen sind.
                $parseErr = null;
                $jobTx = parseTx((string)($j['txXdrCurrent'] ?? ($j['txXdrOriginal'] ?? '')), $j['network'] ?? 'public', $parseErr);
                $seqAccount = skm_sequence_account_of($j, $jobTx);
                $seqMeta = $seqAccount === ($j['accountId'] ?? '') ? $meta : fetchAccountSignersCached($seqAccount, $j['network'] ?? 'public');
                $consumed = $jobTx instanceof \Soneso\StellarSDK\Transaction ? skm_sequence_consumed_from_meta($jobTx, $seqMeta) : false;
                if (skm_ledger_check_pending($j, $jobTx, $consumed)) {
                    $ledgerCheckPending = $current['status'] ?? '';
                    return $items;
                }
                unset($items[$i]);
                $deleted = true;
                return array_values($items);
            }
            return $items;
        });
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.delete_one failed: ' . $e->getMessage());
        return sendError('multisig.jobs.delete_failed', null, 500);
    }
    if ($conflict !== null) return sendJson(['ok' => false, 'error' => 'not_final', 'status' => $conflict], 409);
    if ($ledgerCheckPending !== null) return sendJson(['ok' => false, 'error' => 'ledger_check_pending', 'status' => $ledgerCheckPending], 409);
    if (!$deleted) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
    return sendJson(['ok' => true]);
}

// POST /api/multisig/jobs/:id/merge-signed-xdr
if ($method === 'POST' && ($m = matchRoute($path, '/api/multisig/jobs/:id/merge-signed-xdr'))) {
    // B3-1: siehe Anlegen. Gesetzt, sobald der Merge an Horizon sendet.
    $submitAttempted = false;
    try {
        $id = $m['id'] ?? '';
        $body = jsonBody();
        $signedXdr = $body['signedXdr'] ?? '';

        // Fail fast on obvious client errors before taking the write lock.
        $preCheck = loadJobs($jobFile);
        $job = null;
        foreach ($preCheck as $j) {
            if (($j['id'] ?? '') === $id) { $job = $j; break; }
        }
        if (!$job) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
        if (!hasValidJobToken($job)) return sendJson(['ok' => false, 'error' => 'forbidden'], 403);
        // Erst nach Job und Token (404, 403), wie Node: Ein fehlendes oder falsch getyptes signedXdr
        // gibt ohne Token nichts preis und ist danach 400, nie ein TypeError (500).
        if (!is_string($signedXdr) || $signedXdr === '') return sendJson(['ok' => false, 'error' => 'invalid_xdr'], 400);

        $net = $job['network'] ?? 'public';
        $parseErr = null;
        $incoming = parseTx($signedXdr, $net, $parseErr);
        if (!$incoming) return sendJson(['ok' => false, 'error' => 'invalid_xdr', 'detail' => $parseErr], 400);
        if ($incoming instanceof FeeBumpTransaction) return sendJson(['ok' => false, 'error' => 'fee_bump_not_supported'], 400);
        $hash = txHash($incoming, $net);
        if ($hash !== ($job['txHash'] ?? '')) return sendJson(['ok' => false, 'error' => 'mismatched_hash'], 400);
        // K1: Altjobs von vor dieser Pruefung bleiben gespeichert, nehmen aber keine
        // Signatur mehr an. Damit gibt es fuer sie auch keine automatische Einreichung.
        if (txSourceBaseAccount($incoming) !== ($job['accountId'] ?? '')) return sendAccountMismatch();

        $resultRow = null;
        $signersUnavailable = false;
        $lifecycleRejected = null;
        // R-3: Erreicht der Merge die Schwelle, speichert der Lock unten den Job als submit_unclear mit der
        // neuen Signatur (Write-ahead); gesendet wird erst danach, das Ergebnis schreibt applySubmitOutcome.
        $toSubmit = null;
        withJobsLock($jobFile, function (array $items) use ($id, $net, $incoming, &$resultRow, &$signersUnavailable, &$lifecycleRejected, &$toSubmit) {
            foreach ($items as &$j) {
                if (($j['id'] ?? '') !== $id) continue;

                $currentErr = null;
                $current = parseTx($j['txXdrCurrent'] ?? $j['txXdrOriginal'] ?? '', $net, $currentErr);
                if (!$current) $current = $incoming;

                // Backfill for jobs stored before maxTimeUnix existed (G5
                // stage 1) - self-healing, mirrors the empty-signers heal
                // below. Keeps multisigJobsGuard.php's dependency-free expiry
                // guard accurate for jobs created before this field existed.
                if (!isset($j['maxTimeUnix'])) {
                    $j['maxTimeUnix'] = extractMaxTimeUnix($current);
                }

                // G5 stage 1 / b6: a job already in a final state (e.g.
                // submitted_success) never accepts another merge - checked
                // before any Horizon lookup or signature work, both to avoid
                // pointless cost and, critically, so a genuinely successful
                // submission can never be silently overwritten. Without this,
                // a stale resubmission attempt would recompute the now-spent
                // sequence as obsolete_seq and clobber the true
                // submitted_success.
                $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
                $existingStatus = $j['status'] ?? '';
                // F-2: submit_unclear ebenso, sonst wuerde ein weiterer Merge erneut senden.
                if (in_array($existingStatus, $finalStates, true) || $existingStatus === SUBMIT_UNCLEAR_STATUS) {
                    $lifecycleRejected = $existingStatus;
                    $resultRow = summarizeJob($j);
                    break;
                }

                // Signers/thresholds are always (re-)derived from the real on-chain account
                // state, never trusted from the request body (C2).
                $meta = fetchAccountSignersCached($j['accountId'] ?? '', $net);
                $signerMeta = $meta['signers'];
                // Fail closed on an empty signer list: it only ever means the
                // Horizon lookup failed or the account doesn't exist (an existing
                // account always has at least its master key as a signer).
                // Running filterValidSignatures() against an empty list would
                // wipe every previously collected signature from txXdrCurrent -
                // irrecoverably, since the XDR is their only home. Abort the
                // merge instead and leave the job untouched; the client simply
                // retries once Horizon answers again.
                if (!$signerMeta) {
                    $signersUnavailable = true;
                    break;
                }
                $j['thresholds'] = $meta['thresholds'];
                $j['signers'] = $signerMeta;

                // G5 stage 1: reject the merge outright if the job's underlying
                // transaction is already dead - its sequence has been consumed
                // by another transaction, or its timebound has passed. Checked
                // before touching any signature state so a doomed merge
                // attempt never gets recorded as if it mattered.
                $accountSequence = (($meta['ok'] ?? true) !== false && ($meta['sequence'] ?? null) !== null)
                    ? new BigInteger($meta['sequence'])
                    : null;
                // Sequenz von accountId genuegt: K1 (oben) erzwingt, dass die Tx-Quelle (Basiskonto)
                // gleich accountId ist.
                $lifecycleStatus = computeMultisigLifecycleStatus($current, $accountSequence, time());
                if ($lifecycleStatus !== null) {
                    $j['status'] = $lifecycleStatus;
                    $j['requiredWeight'] = requiredWeightForOperations($current, $meta['thresholds']);
                    $lifecycleRejected = $lifecycleStatus;
                    $resultRow = summarizeJob($j);
                    break;
                }

                $merged = mergeSignatures($current, $incoming);
                $j['requiredWeight'] = requiredWeightForOperations($merged, $meta['thresholds']);

                // M1 fix: drop anything that doesn't verify against a real account
                // signer and cap at Stellar's 20-signature protocol limit before
                // persisting - previously every submitted signature was stored
                // verbatim, valid or not.
                $merged->setSignatures(filterValidSignatures($merged, $net, $signerMeta));

                // Recomputed fresh from the (now-filtered) merged signature set, which
                // already carries forward every previously-valid signature via
                // mergeSignatures() above - no need to also merge in the job's stale
                // stored collectedSigners or (H2 fix) any client-supplied data, which
                // was never verified against the transaction's actual signatures.
                $collected = verifyCollected($merged, $net, $signerMeta);
                $collectedWeight = array_reduce($collected, fn($c, $s) => $c + (int)($s['weight'] ?? 0), 0);
                $required = (int)($j['requiredWeight'] ?? 0);
                $status = ($required > 0 && $collectedWeight >= $required) ? 'ready_to_submit' : 'pending_signatures';
                $submittedResult = $j['submittedResult'] ?? null;
                $submittedAt = $submittedResult ? ($j['submittedAt'] ?? gmdate('c')) : null;
                // ADR 0013: mit fremden op.source-Konten nie automatisch senden, der Job bleibt ready_to_submit.
                $j['foreignOpSources'] = foreignOpSourcesOf($merged, (string)($j['accountId'] ?? ''));
                if ($status === 'ready_to_submit' && $required > 0 && $j['foreignOpSources'] === []) {
                    $status = SUBMIT_UNCLEAR_STATUS;
                    $submittedResult = null;
                    $submittedAt = gmdate('c');
                    $toSubmit = $merged;
                }

                $j['txXdrCurrent'] = $merged->toEnvelopeXdrBase64();
                $j['collectedSigners'] = $collected;
                $j['collectedWeight'] = $collectedWeight;
                $j['declinedSigners'] = dropDeclinesOfCollected(is_array($j['declinedSigners'] ?? null) ? $j['declinedSigners'] : [], $collected);
                $j['status'] = $status;
                $j['submittedResult'] = $submittedResult;
                $j['submittedAt'] = $submittedAt;
                $j = summarizeJob($j);
                $resultRow = $j;
                break;
            }
            unset($j);
            return $items;
        });

        if ($signersUnavailable) return sendError('signers_unavailable', null, 502);
        if ($lifecycleRejected) return sendJson(['ok' => false, 'error' => $lifecycleRejected, 'job' => $resultRow], 409);
        if (!$resultRow) return sendJson(['ok' => false, 'error' => 'not_found'], 404);
        if ($toSubmit !== null) {
            // Write-ahead steht in der Datei; erst jetzt senden.
            $submitAttempted = true;
            try {
                $sent = ['status' => 'submitted_success', 'submittedResult' => submitToNetwork($toSubmit, $net)];
            } catch (\Throwable $submitErr) {
                // G5 stage 1: a submission that fails specifically because
                // the sequence/timebound died between our pre-merge check
                // above and Horizon's authoritative processing must not be
                // reported as a generic submitted_failed - safety net for
                // that TOCTOU gap (the account sequence used above can be
                // up to 30s cached, see fetchAccountSignersCached()).
                // F-3: wie beim Anlegen nur Fehlertext und result_codes.
                // F-2: unklar (keine eindeutige Antwort) wird submit_unclear, nicht submitted_failed.
                $submittedResult = skm_submit_error_result($submitErr);
                $resultCode = skm_submitted_result_tx_code($submittedResult);
                $mapped = mapSubmitResultCodeToLifecycleStatus($resultCode);
                $status = $submitErr instanceof SubmitUnclearException ? SUBMIT_UNCLEAR_STATUS : ($mapped ?? 'submitted_failed');
                $sent = ['status' => $status, 'submittedResult' => $submittedResult];
            }
            $row = applySubmitOutcome($jobFile, $id, $sent['status'], $sent['submittedResult']);
            if ($row !== null) $resultRow = summarizeJob($row);
        }
        return sendJson($resultRow);
    } catch (\Throwable $e) {
        error_log('[multisig] jobs.merge failed: ' . $e->getMessage());
        return sendError($submitAttempted ? 'multisig.jobs.save_failed_after_submit' : 'multisig.jobs.merge_failed', null, 500);
    }
}

// DELETE /api/multisig/jobs?network=testnet&confirm=DELETE TESTNET JOBS
if ($method === 'DELETE' && $path === '/api/multisig/jobs') {
    $net = normalizeNetwork($_GET['network'] ?? null);
    $confirm = $_GET['confirm'] ?? '';
    $adminToken = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    $requiredToken = getenv('MULTISIG_ADMIN_TOKEN') ?: '';

    if (!$net) return sendJson(['ok' => false, 'error' => 'invalid_network'], 400);
    // This bulk-deletes every job of an entire network in one call - equally
    // destructive for other users' testnet jobs as for mainnet ones (fremde
    // Jobs löschen ist fremde Jobs löschen), so both now require the same
    // real, server-side secret (MULTISIG_ADMIN_TOKEN via hash_equals), not
    // just a fixed confirm string that's public knowledge (shown verbatim in
    // the frontend's own UI) and gave testnet callers no actual auth check at
    // all. The confirm string is kept in addition, scoped per network, as a
    // second guard against an admin accidentally wiping the wrong network.
    if (!$requiredToken || !$adminToken || !hash_equals($requiredToken, $adminToken)) {
        return sendJson(['ok' => false, 'error' => 'unauthorized'], 401);
    }
    $expectedConfirm = $net === 'testnet' ? 'DELETE TESTNET JOBS' : 'DELETE ALL JOBS';
    if ($confirm !== $expectedConfirm) return sendJson(['ok' => false, 'error' => 'confirm_required'], 400);

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
