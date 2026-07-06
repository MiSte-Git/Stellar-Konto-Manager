<?php
// api/bugreport.php
// Bugreport API for shared hosting (cyon) backed by MySQL.
// - GET: list bug reports with optional filters and paging
// - POST: create bug report
// - POST with { action: "update" }: admin update (requires x-admin-secret)

declare(strict_types=1);

require __DIR__ . '/admin_session.php';
require __DIR__ . '/cors.php';
require __DIR__ . '/bugreportGuard.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// CORS for local dev (Vite) → PROD API. Session-cookie-protected endpoints
// (admin listing/update, finding A2) need a specific origin + credentials
// flag - shared allowlist in cors.php (finding #9).
apply_cors_headers(['GET', 'POST', 'OPTIONS'], ['Content-Type'], true);

// Handle preflight without DB access
if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}

admin_session_start();

function json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function require_config(): array {
    $configPath = __DIR__ . '/_config.php';
    if (!file_exists($configPath)) {
        json_out(['ok' => false, 'error' => 'missing_config'], 500);
    }
    /** @noinspection PhpIncludeInspection */
    $cfg = require $configPath;
    if (!is_array($cfg)) {
        json_out(['ok' => false, 'error' => 'invalid_config'], 500);
    }
    return $cfg;
}

function get_pdo(array $cfg): PDO {
    $dsn = (string)($cfg['DB_DSN'] ?? '');
    $user = (string)($cfg['DB_USER'] ?? '');
    $pass = (string)($cfg['DB_PASS'] ?? '');

    if ($dsn === '' || $user === '') {
        json_out(['ok' => false, 'error' => 'invalid_config'], 500);
    }

    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_out(['ok' => false, 'error' => 'invalid_json'], 400);
    }
    return $data;
}

function require_admin(): void {
    if (!is_admin_authenticated()) {
        json_out(['ok' => false, 'error' => 'forbidden'], 403);
    }
}

function allowlist(string $value, array $allowed, string $fallback): string {
    return in_array($value, $allowed, true) ? $value : $fallback;
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

$allowedStatus = ['open', 'in_progress', 'closed', 'rejected'];
$allowedPriority = ['low', 'normal', 'high', 'urgent'];
$allowedCategory = ['bug', 'idea', 'improve', 'other'];
$allowedPage = ['start','trustlines','trustlineCompare','balance','xlmByMemo','sendPayment','investedTokens','createAccount','multisigEdit','settings','feedback','other'];

try {
    // Inside the try/catch (not before it) so a DB connection failure - which
    // PDO always raises as an exception, even outside ERRMODE_EXCEPTION - goes
    // through the same generic-error handling instead of leaking a raw
    // PDOException (with DB user/host) to the client.
    $cfg = require_config();
    $pdo = get_pdo($cfg);
    $table = (string)($cfg['DB_TABLE_BUGREPORTS'] ?? 'bugreports');

    if ($method === 'GET') {
        // Listing exposes contact emails/free-text reports - admin-only (was
        // unprotected before the A2 fix, since the admin UI's client-side
        // secret check was the only prior gate).
        require_admin();

        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
        $offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;
        $limit = max(1, min(500, $limit));
        $offset = max(0, $offset);

        $status = isset($_GET['status']) ? (string)$_GET['status'] : '';
        $priority = isset($_GET['priority']) ? (string)$_GET['priority'] : '';
        $category = isset($_GET['category']) ? (string)$_GET['category'] : '';
        $page = isset($_GET['page']) ? (string)$_GET['page'] : '';
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';

        // Sort is optional. We only allow a safe whitelist.
        $sort = isset($_GET['sort']) ? (string)$_GET['sort'] : 'ts';
        $dir = strtolower((string)($_GET['dir'] ?? 'desc'));
        $dirSql = $dir === 'asc' ? 'ASC' : 'DESC';

        $sortable = [
            'id' => 'id',
            'ts' => 'ts',
            'url' => 'url',
            'page' => 'page',
            'language' => 'language',
            'email' => 'contactEmail',
            'userAgent' => 'userAgent',
            'title' => 'title',
            'description' => 'description',
            'category' => 'category',
            'status' => 'status',
            'rejectionReason' => 'rejectionReason',
            'comment' => 'comment',
            'priority' => 'priority',
            'appVersion' => 'appVersion',
        ];
        $sortCol = $sortable[$sort] ?? 'ts';

        $where = [];
        $params = [];

        if ($status !== '') {
            $where[] = 'status = :status';
            $params[':status'] = allowlist($status, $allowedStatus, 'open');
        }
        if ($priority !== '') {
            $where[] = 'priority = :priority';
            $params[':priority'] = allowlist($priority, $allowedPriority, 'normal');
        }
        if ($category !== '') {
            $where[] = 'category = :category';
            $params[':category'] = allowlist($category, $allowedCategory, 'bug');
        }
        if ($page !== '') {
            $where[] = 'page = :page';
            $params[':page'] = allowlist($page, $allowedPage, 'other');
        }
        if ($q !== '') {
            $where[] = '(title LIKE :q OR description LIKE :q OR url LIKE :q OR comment LIKE :q OR rejectionReason LIKE :q OR contactEmail LIKE :q)';
            $params[':q'] = '%' . $q . '%';
        }

        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $countSql = "SELECT COUNT(*) AS cnt FROM `{$table}` {$whereSql}";
        $stmt = $pdo->prepare($countSql);
        $stmt->execute($params);
        $total = (int)($stmt->fetchColumn() ?? 0);

        $sql = "SELECT id, ts, url, userAgent, language, contactEmail, title, description, rejectionReason, comment, status, priority, category, page, appVersion
                FROM `{$table}`
                {$whereSql}
                ORDER BY {$sortCol} {$dirSql}
                LIMIT :limit OFFSET :offset";

        $stmt = $pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $items = $stmt->fetchAll();

        json_out(['items' => $items, 'total' => $total], 200);
    }

    if ($method === 'POST') {
        $data = read_json_body();
        $action = isset($data['action']) ? (string)$data['action'] : '';

        if ($action === 'update') {
            require_admin();

            $id = isset($data['id']) ? (int)$data['id'] : 0;
            if ($id <= 0) json_out(['ok' => false, 'error' => 'invalid_id'], 400);

            $draft = $data;
            unset($draft['action'], $draft['id']);

            $set = [];
            $params = [':id' => $id];

            if (array_key_exists('status', $draft)) {
                $set[] = 'status = :status';
                $params[':status'] = allowlist((string)$draft['status'], $allowedStatus, 'open');
            }
            if (array_key_exists('priority', $draft)) {
                $set[] = 'priority = :priority';
                $params[':priority'] = allowlist((string)$draft['priority'], $allowedPriority, 'normal');
            }
            if (array_key_exists('category', $draft)) {
                $set[] = 'category = :category';
                $params[':category'] = allowlist((string)$draft['category'], $allowedCategory, 'bug');
            }
            if (array_key_exists('page', $draft)) {
                $set[] = 'page = :page';
                $params[':page'] = allowlist((string)$draft['page'], $allowedPage, 'other');
            }
            if (array_key_exists('rejectionReason', $draft)) {
                $set[] = 'rejectionReason = :rejectionReason';
                $params[':rejectionReason'] = ($draft['rejectionReason'] === null) ? null : (string)$draft['rejectionReason'];
            }
            if (array_key_exists('comment', $draft)) {
                $set[] = 'comment = :comment';
                $params[':comment'] = ($draft['comment'] === null) ? null : (string)$draft['comment'];
            }
            if (array_key_exists('contactEmail', $draft)) {
                $set[] = 'contactEmail = :contactEmail';
                $params[':contactEmail'] = ($draft['contactEmail'] === null) ? null : (string)$draft['contactEmail'];
            }

            if (!$set) {
                json_out(['ok' => true, 'updated' => 0], 200);
            }

            $sql = "UPDATE `{$table}` SET " . implode(', ', $set) . " WHERE id = :id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            if ($stmt->rowCount() === 0) {
                // id may not exist
                $check = $pdo->prepare("SELECT id FROM `{$table}` WHERE id = :id");
                $check->execute([':id' => $id]);
                if (!$check->fetchColumn()) {
                    json_out(['ok' => false, 'error' => 'not_found'], 404);
                }
            }

            json_out(['ok' => true], 200);
        }

        // Create new bugreport (public, unauthenticated) - N3 rate limit
        // applies only here, not to the admin-only GET/update actions above.
        $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $retryAfter = bugReportRateLimitCheckAndRecord($ip);
        if ($retryAfter > 0) {
            header('Retry-After: ' . $retryAfter);
            json_out(['ok' => false, 'error' => 'too_many_requests', 'retryAfter' => $retryAfter], 429);
        }

        $title = isset($data['title']) ? clamp_field(trim((string)$data['title'])) : '';
        if ($title === '' && isset($data['subject'])) {
            $title = clamp_field(trim((string)$data['subject']));
        }

        $description = isset($data['description']) ? clamp_field((string)$data['description']) : null;
        $url = isset($data['url']) ? clamp_field((string)$data['url']) : '';
        $userAgent = isset($data['userAgent']) ? clamp_field((string)$data['userAgent']) : clamp_field((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
        $language = isset($data['language']) ? clamp_field((string)$data['language']) : '';
        $contactEmail = isset($data['contactEmail']) ? trim((string)$data['contactEmail']) : '';
        $appVersion = isset($data['appVersion']) ? clamp_field((string)$data['appVersion']) : null;

        // N4: a newly-submitted report is always "open", regardless of what
        // the (unauthenticated) reporter's payload claims - otherwise anyone
        // could file a report that's already "closed"/"rejected" and never
        // show up in the admin queue. Status transitions after creation go
        // through the admin-only action=update above.
        $status = 'open';
        $priority = allowlist(isset($data['priority']) ? (string)$data['priority'] : 'normal', $allowedPriority, 'normal');
        $category = allowlist(isset($data['category']) ? (string)$data['category'] : 'bug', $allowedCategory, 'bug');
        $page = allowlist(isset($data['page']) ? (string)$data['page'] : 'other', $allowedPage, 'other');

        if ($title === '') {
            json_out(['ok' => false, 'error' => 'missing_title'], 400);
        }
        if ($url === '') {
            json_out(['ok' => false, 'error' => 'missing_url'], 400);
        }

        $contactEmailVal = null;
        if ($contactEmail !== '') {
            if (!filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) {
                json_out(['ok' => false, 'error' => 'invalid_email'], 400);
            }
            $contactEmailVal = $contactEmail;
        }

        $ts = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');

        $sql = "INSERT INTO `{$table}` (ts, url, userAgent, language, contactEmail, title, description, rejectionReason, comment, status, priority, category, page, appVersion)
                VALUES (:ts, :url, :userAgent, :language, :contactEmail, :title, :description, NULL, NULL, :status, :priority, :category, :page, :appVersion)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':ts' => $ts,
            ':url' => $url,
            ':userAgent' => $userAgent,
            ':language' => $language,
            ':contactEmail' => $contactEmailVal,
            ':title' => $title,
            ':description' => $description,
            ':status' => $status,
            ':priority' => $priority,
            ':category' => $category,
            ':page' => $page,
            ':appVersion' => $appVersion,
        ]);

        $id = (int)$pdo->lastInsertId();
        json_out(['ok' => true, 'id' => $id], 201);
    }

    json_out(['ok' => false, 'error' => 'method_not_allowed'], 405);
} catch (Throwable $e) {
    error_log('[bugreport] request failed: ' . $e->getMessage());
    json_out(['ok' => false, 'error' => 'server_error'], 500);
}
