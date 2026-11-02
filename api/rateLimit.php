<?php
// Allgemeiner Rate-Limiter je IP, dateibasiert nach dem Muster von
// federation_rate_limit_check_and_record() (api/federationService.php). Jeder Bereich
// hat eine eigene Datei, damit sich Budgets und Locks nicht gegenseitig beeinflussen.
// Bisher nutzt ihn nur POST /api/multisig/jobs/:id/challenge; Federation, Bugreport und
// Admin-Login haben noch ihre eigenen Varianten.
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
