<?php
// Schutz aendernder Admin-Requests gegen CSRF (Review Runde 2, Befund G4).
//
// Bisher schuetzte allein SameSite=Lax am Admin-Session-Cookie. Eine Seite auf
// derselben Site (andere Subdomain unter steei.de) bekommt das Cookie aber
// mitgeschickt, und weil PHP den Body unabhaengig vom Content-Type als JSON
// liest, konnte ein Formular mit enctype="text/plain" ohne Preflight gueltiges
// JSON schicken. Darum gilt fuer Login, Logout und Bugreport-Update:
// - Origin muss vorhanden sein und exakt in cors_allowed_origins() stehen
//   (dieselbe Allowlist wie CORS, keine zweite Liste), sonst 403 forbidden_origin.
// - Requests mit Body brauchen Content-Type application/json (Parameter wie
//   charset erlaubt, Gross-/Kleinschreibung egal), sonst 415 unsupported_media_type.
// Node-Pendant: services/requestGuard.js.
declare(strict_types=1);

require_once __DIR__ . '/cors.php';

function request_origin_allowed(?string $origin): bool {
    return cors_origin_allowed($origin);
}

function is_json_content_type(?string $contentType): bool {
    if ($contentType === null) return false;
    $mediaType = strtolower(trim(explode(';', $contentType, 2)[0]));
    return $mediaType === 'application/json';
}

function request_guard_reject(int $status, string $error): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ($error === 'forbidden_origin') header('Vary: Origin');
    echo json_encode(['ok' => false, 'error' => $error]);
    exit;
}

function require_allowed_origin(): void {
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? (string)$_SERVER['HTTP_ORIGIN'] : null;
    if (!request_origin_allowed($origin)) {
        request_guard_reject(403, 'forbidden_origin');
    }
}

function require_json_content_type(): void {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? null;
    if (!is_json_content_type($contentType === null ? null : (string)$contentType)) {
        request_guard_reject(415, 'unsupported_media_type');
    }
}
