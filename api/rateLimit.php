<?php
// Gemeinsamer Rate-Limiter je IP fuer alle PHP-Endpunkte, dateibasiert. Jeder Bereich hat
// eine eigene Datei, damit sich Budgets und Locks nicht gegenseitig beeinflussen:
//   rateLimitCheckAndRecord: jede Anfrage zaehlt (Federation, Bugreport anlegen, Job anlegen,
//     Jobliste, POST /challenge).
//   rateLimitFailureCheck/rateLimitFailureRecord: nur Fehlversuche zaehlen, Sperre nach N
//     (Admin-Login).
// Ueberall gleich: IP-Bildung (rateLimitClientKey), Lock-Datei, Obergrenze der Eintraege,
// fail open nur fuer den Limiter selbst.
declare(strict_types=1);

const RATE_LIMIT_DEFAULT_MAX_ENTRIES = 5000;

// Pfad der Datendatei eines Bereichs, per Env-Variable ueberschreibbar (Tests).
function rateLimitPath(string $envVar, string $defaultFile): string {
    $override = getenv($envVar);
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/' . $defaultFile;
}

// IPv6 je /64 (eine Endkunden-Zuteilung), wie express-rate-limit mit ipv6Subnet 64;
// sonst haette ein einzelnes /64 beliebig viele Identitaeten. IPv4-mapped
// (::ffff:a.b.c.d) zaehlt als die eingebettete IPv4-Adresse, sonst teilten sich alle
// IPv4-Clients hinter einem Dual-Stack-Socket ein Budget.
function rateLimitClientKey(string $ip): string {
    $packed = @inet_pton($ip);
    if ($packed !== false && strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        return inet_ntop(substr($packed, 12));
    }
    if ($packed !== false && strlen($packed) === 16) {
        return 'v6:' . bin2hex(substr($packed, 0, 8)) . '::/64';
    }
    return $ip;
}

// Zaehlt eine Anfrage fuer $ip in $file. Gibt die Sekunden bis zum Ablauf des Fensters
// zurueck, wenn das Budget ueberschritten ist, sonst 0. Die Datei hat hoechstens
// $maxEntries Eintraege; ist sie voll, fallen die aeltesten Fenster zuerst weg. Kann die
// Lock-Datei nicht geoeffnet werden, laesst der Limiter die Anfrage durch (fail open nur
// fuer den Limiter selbst, die Route dahinter prueft ihre Eingaben weiterhin).
function rateLimitCheckAndRecord(string $file, string $ip, int $max, int $windowSeconds, int $maxEntries = RATE_LIMIT_DEFAULT_MAX_ENTRIES): int {
    $key = rateLimitClientKey($ip);
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) return 0;
    flock($lockHandle, LOCK_EX);
    try {
        $data = [];
        if (file_exists($file)) {
            $raw = @file_get_contents($file);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) $data = $decoded;
        }
        $now = time();
        foreach ($data as $k => $entry) {
            if (!is_array($entry) || ($now - (int)($entry['windowStart'] ?? 0)) > $windowSeconds) unset($data[$k]);
        }
        if (!isset($data[$key]) && count($data) >= $maxEntries) {
            uasort($data, fn($a, $b) => (int)($a['windowStart'] ?? 0) <=> (int)($b['windowStart'] ?? 0));
            $data = array_slice($data, count($data) - $maxEntries + 1, null, true);
        }
        $entry = $data[$key] ?? ['count' => 0, 'windowStart' => $now];
        $entry['count'] = (int)$entry['count'] + 1;
        $data[$key] = $entry;
        @file_put_contents($file, json_encode($data));
        if ($entry['count'] > $max) {
            return max($windowSeconds - ($now - (int)$entry['windowStart']), 1);
        }
        return 0;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

// Fehlversuche (Admin-Login): Sekunden bis zur Freigabe, wenn $ip gesperrt ist, sonst 0.
// Liest unter demselben Lock, den rateLimitFailureRecord zum Schreiben nimmt. Laesst sich
// die Lock-Datei nicht oeffnen, liest es ohne Lock: eine gespeicherte Sperre gilt weiter
// (fail open nur fuer das Schreiben in rateLimitFailureRecord).
function rateLimitFailureCheck(string $file, string $ip): int {
    $key = rateLimitClientKey($ip);
    if (!file_exists($file)) return 0;
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle !== false) flock($lockHandle, LOCK_SH);
    try {
        $raw = @file_get_contents($file);
        $data = $raw ? json_decode($raw, true) : null;
        if (!is_array($data) || !is_array($data[$key] ?? null)) return 0;
        $remaining = (int)($data[$key]['lockedUntil'] ?? 0) - time();
        return $remaining > 0 ? $remaining : 0;
    } finally {
        if ($lockHandle !== false) {
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
    }
}

// Ergebnis eines Versuchs: Erfolg loescht den Zaehler, ein Fehlversuch zaehlt im Fenster
// $windowSeconds ab dem ersten Fehlversuch; ab $maxFailures ist $ip fuer $windowSeconds
// gesperrt. Eintraege, die weder gesperrt noch im Fenster sind, fallen weg. Ist die Datei
// voll, fallen die Eintraege zuerst weg, die am fruehesten ablaufen.
function rateLimitFailureRecord(string $file, string $ip, bool $success, int $maxFailures, int $windowSeconds, int $maxEntries = RATE_LIMIT_DEFAULT_MAX_ENTRIES): void {
    $key = rateLimitClientKey($ip);
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) return;
    flock($lockHandle, LOCK_EX);
    try {
        $data = [];
        if (file_exists($file)) {
            $raw = @file_get_contents($file);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) $data = $decoded;
        }
        $now = time();
        $expiresAt = fn($e) => max((int)($e['lockedUntil'] ?? 0), (int)($e['firstAttempt'] ?? 0) + $windowSeconds);
        foreach ($data as $k => $entry) {
            if (!is_array($entry)) { unset($data[$k]); continue; }
            if ((int)($entry['lockedUntil'] ?? 0) <= $now && ($now - (int)($entry['firstAttempt'] ?? 0)) > $windowSeconds) unset($data[$k]);
        }
        if ($success) {
            unset($data[$key]);
        } else {
            if (!isset($data[$key]) && count($data) >= $maxEntries) {
                uasort($data, fn($a, $b) => $expiresAt($a) <=> $expiresAt($b));
                $data = array_slice($data, count($data) - $maxEntries + 1, null, true);
            }
            $entry = $data[$key] ?? ['count' => 0, 'firstAttempt' => $now, 'lockedUntil' => 0];
            if (($now - (int)$entry['firstAttempt']) > $windowSeconds) {
                $entry = ['count' => 0, 'firstAttempt' => $now, 'lockedUntil' => 0];
            }
            $entry['count'] = (int)$entry['count'] + 1;
            if ($entry['count'] >= $maxFailures) $entry['lockedUntil'] = $now + $windowSeconds;
            $data[$key] = $entry;
        }
        @file_put_contents($file, json_encode($data));
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}
