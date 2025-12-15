<?php
// api/health.php
// Simple health endpoint used by start-dev.sh (prod backend reachability check).
// Returns 200 if the script can load config and connect to the database.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// CORS for local dev (Vite) → PROD API
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, x-admin-secret');

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $configPath = __DIR__ . '/_config.php';
    if (!file_exists($configPath)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'missing_config']);
        exit;
    }

    /** @noinspection PhpIncludeInspection */
    $cfg = require $configPath;

    $dsn = (string)($cfg['DB_DSN'] ?? '');
    $user = (string)($cfg['DB_USER'] ?? '');
    $pass = (string)($cfg['DB_PASS'] ?? '');

    if ($dsn === '' || $user === '') {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'invalid_config']);
        exit;
    }

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // Optional: verify expected table exists
    $table = (string)($cfg['DB_TABLE_BUGREPORTS'] ?? 'bugreports');
    $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
    $tableOk = (bool)$stmt->fetchColumn();

    echo json_encode([
        'ok' => true,
        'db' => true,
        'table' => $table,
        'tableOk' => $tableOk,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'db' => false,
        'error' => 'exception',
        'message' => $e->getMessage(),
    ]);
}
