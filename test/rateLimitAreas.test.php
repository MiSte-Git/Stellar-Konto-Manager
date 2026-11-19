<?php
// R-8: alle PHP-Rate-Limits laufen ueber api/rateLimit.php. Je Bereich: Budget aus
// test/assets/rate-limits.json, IPv6-Adressen im selben /64 teilen ein Budget, IPv4-mapped
// zaehlt als IPv4. Vorher zaehlten Bugreport, Job anlegen und Admin-Login jede IPv6-Adresse
// einzeln (Limit per Adresswechsel im eigenen /64 umgehbar). Die Routen (Fehlercode,
// Retry-After) prueft test/rateLimitRoutes.test.php.
//
// Run with: php test/rateLimitAreas.test.php

declare(strict_types=1);

$tmpDir = sys_get_temp_dir() . '/skm-ratelimit-areas-' . bin2hex(random_bytes(4));
mkdir($tmpDir, 0775, true);

require __DIR__ . '/../api/bugreportGuard.php';
require __DIR__ . '/../api/multisigJobsGuard.php';
require __DIR__ . '/../api/federationService.php';
require __DIR__ . '/../api/challengeStore.php';
require __DIR__ . '/../api/assetLogo.php';

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n";
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n";
    }
}

$limits = json_decode((string)file_get_contents(__DIR__ . '/assets/rate-limits.json'), true);

// Bereich => [Env-Variable, Funktion, Budget, Fenster]
$areas = [
    'federation' => ['FEDERATION_RATE_LIMIT_PATH', 'federation_rate_limit_check_and_record', FEDERATION_RATE_LIMIT_MAX, FEDERATION_RATE_LIMIT_WINDOW_SECONDS],
    'bugreport' => ['BUGREPORT_RATE_LIMIT_PATH', 'bugReportRateLimitCheckAndRecord', BUGREPORT_RATE_LIMIT_MAX, BUGREPORT_RATE_LIMIT_WINDOW_SECONDS],
    'jobCreate' => ['MULTISIG_JOB_RATE_LIMIT_PATH', 'multisigJobRateLimitCheckAndRecord', MULTISIG_JOB_RATE_LIMIT_MAX, MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS],
    'jobList' => ['MULTISIG_JOB_LIST_RATE_LIMIT_PATH', 'multisigJobListRateLimitCheckAndRecord', MULTISIG_JOB_LIST_RATE_LIMIT_MAX, MULTISIG_JOB_LIST_RATE_LIMIT_WINDOW_SECONDS],
    'assetLogo' => ['ASSET_LOGO_RATE_LIMIT_PATH', 'asset_logo_rate_limit_check_and_record', ASSET_LOGO_RATE_LIMIT_MAX, ASSET_LOGO_RATE_LIMIT_WINDOW_SECONDS],
];
check('challenge: Budget wie in der Fixture', MULTISIG_CHALLENGE_RATE_LIMIT_MAX === $limits['areas']['challenge']['max']
    && MULTISIG_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS === $limits['areas']['challenge']['windowSeconds']);

foreach ($areas as $name => [$envVar, $fn, $max, $window]) {
    $file = "{$tmpDir}/{$name}.json";
    putenv("{$envVar}={$file}");
    check("{$name}: Budget {$max} je {$window} s wie in der Fixture",
        $max === $limits['areas'][$name]['max'] && $window === $limits['areas'][$name]['windowSeconds']);

    $within = true;
    for ($i = 0; $i < $max; $i++) if ($fn('198.51.100.7') !== 0) $within = false;
    $retry = $fn('198.51.100.7');
    check("{$name}: {$max} Anfragen frei, die naechste ergibt retryAfter 1..{$window}", $within && $retry >= 1 && $retry <= $window);
    check("{$name}: andere IPv4 hat eigenes Budget", $fn('198.51.100.8') === 0);
    check("{$name}: eigene Datei im Bereich", file_exists($file));

    for ($i = 0; $i < $max; $i++) $fn('2001:db8:1:2::' . dechex($i + 1));
    check("{$name}: IPv6-Adressen im selben /64 teilen ein Budget", $fn('2001:db8:1:2:ffff:ffff:ffff:ffff') > 0);
    check("{$name}: anderes /64 hat eigenes Budget", $fn('2001:db8:1:3::1') === 0);

    for ($i = 0; $i < $max; $i++) $fn('203.0.113.20');
    check("{$name}: IPv4-mapped zaehlt als die eingebettete IPv4", $fn('::ffff:203.0.113.20') > 0);
    putenv($envVar);
}

// Admin-Login: nur Fehlversuche, Sperre ab maxFailures fuer windowSeconds, Erfolg loescht.
$admin = $limits['adminLogin'];
$max = $admin['maxFailures'];
$window = $admin['windowSeconds'];
$file = "{$tmpDir}/admin.json";
$fail = fn(string $ip) => rateLimitFailureRecord($file, $ip, false, $max, $window);
$locked = fn(string $ip) => rateLimitFailureCheck($file, $ip);

for ($i = 0; $i < $max - 1; $i++) $fail('198.51.100.30');
check('admin: ' . ($max - 1) . ' Fehlversuche sperren nicht', $locked('198.51.100.30') === 0);
$fail('198.51.100.30');
$retry = $locked('198.51.100.30');
check("admin: der {$max}. Fehlversuch sperrt fuer bis zu {$window} s", $retry > $window - 5 && $retry <= $window);
check('admin: andere IPv4 nicht gesperrt', $locked('198.51.100.31') === 0);

for ($i = 0; $i < $max - 1; $i++) $fail('198.51.100.32');
rateLimitFailureRecord($file, '198.51.100.32', true, $max, $window);
$fail('198.51.100.32');
check('admin: Erfolg loescht den Zaehler (danach zaehlt ein Fehlversuch wieder als erster)',
    $locked('198.51.100.32') === 0 && ((json_decode((string)file_get_contents($file), true)['198.51.100.32']['count'] ?? 0) === 1));

$data = json_decode((string)file_get_contents($file), true);
$data['198.51.100.30']['lockedUntil'] = time() - 1;
$data['198.51.100.30']['firstAttempt'] = time() - $window - 1;
file_put_contents($file, json_encode($data));
check('admin: nach Ablauf der Sperre frei', $locked('198.51.100.30') === 0);
$fail('198.51.100.30');
$entry = json_decode((string)file_get_contents($file), true)['198.51.100.30'] ?? [];
check('admin: nach Ablauf beginnt das Zaehlen neu', ($entry['count'] ?? 0) === 1 && ($entry['lockedUntil'] ?? -1) === 0);

for ($i = 0; $i < $max; $i++) $fail('2001:db8:5:6::' . dechex($i + 1));
check('admin: IPv6-Fehlversuche im selben /64 zaehlen zusammen', $locked('2001:db8:5:6:abcd::1') > 0);
check('admin: anderes /64 nicht gesperrt', $locked('2001:db8:5:7::1') === 0);
for ($i = 0; $i < $max; $i++) $fail('203.0.113.40');
check('admin: IPv4-mapped teilt die Sperre der IPv4', $locked('::ffff:203.0.113.40') > 0);

$capFile = "{$tmpDir}/admin-cap.json";
for ($i = 0; $i < 5; $i++) rateLimitFailureRecord($capFile, "192.0.2.{$i}", false, $max, $window, 3);
$stored = json_decode((string)file_get_contents($capFile), true) ?: [];
check('admin: Obergrenze der Eintraege wird eingehalten', count($stored) === 3 && isset($stored['192.0.2.4']));
check('admin: fail open, wenn die Lock-Datei nicht angelegt werden kann',
    (function () use ($max, $window) {
        rateLimitFailureRecord('/proc/skm-nicht-schreibbar/x.json', '198.51.100.7', false, $max, $window);
        return rateLimitFailureCheck('/proc/skm-nicht-schreibbar/x.json', '198.51.100.7') === 0;
    })());

// Zeitstempel ueber vorbefuellte Dateien statt sleep. $entry(count, firstAttempt-Offset, lockedUntil-Offset).
$now = time();
$entry = fn(int $count, int $first, int $lockedIn) => ['count' => $count, 'firstAttempt' => $now + $first, 'lockedUntil' => $lockedIn === 0 ? 0 : $now + $lockedIn];
$prefill = fn(string $f, array $d) => file_put_contents($f, json_encode($d));
$read = fn(string $f) => json_decode((string)file_get_contents($f), true) ?: [];

// Fenster ab dem ersten Fehlversuch: spaetere Fehlversuche verschieben es nicht, nach Ablauf beginnt es neu.
$winFile = "{$tmpDir}/admin-window.json";
$prefill($winFile, ['198.51.100.50' => $entry(1, -600, 0), '198.51.100.51' => $entry(3, -$window - 1, 0)]);
$fail = fn(string $ip) => rateLimitFailureRecord($winFile, $ip, false, $max, $window);
$fail('198.51.100.50');
$fail('198.51.100.51');
$e = $read($winFile)['198.51.100.50'] ?? [];
check('admin: Fehlversuch im Fenster zaehlt weiter, firstAttempt bleibt beim ersten',
    ($e['count'] ?? 0) === 2 && ($e['firstAttempt'] ?? 0) === $now - 600);
$e = $read($winFile)['198.51.100.51'] ?? [];
check('admin: Fehlversuch nach Ablauf des Fensters beginnt neu bei 1',
    ($e['count'] ?? 0) === 1 && ($e['firstAttempt'] ?? 0) >= $now && ($e['lockedUntil'] ?? -1) === 0);
$prefill($winFile, ['198.51.100.52' => $entry($max - 1, -600, 0)]);
$fail('198.51.100.52');
$e = $read($winFile)['198.51.100.52'] ?? [];
check("admin: der {$max}. Fehlversuch im Fenster sperrt ab jetzt fuer das ganze Fenster",
    ($e['count'] ?? 0) === $max && ($e['lockedUntil'] ?? 0) >= $now + $window);

// Volle Datei: verdraengt wird der Eintrag, der am fruehesten ablaeuft; Abgelaufenes faellt vorher weg.
$capFile2 = "{$tmpDir}/admin-evict.json";
$recordCap = fn(string $ip) => rateLimitFailureRecord($capFile2, $ip, false, $max, $window, 3);
$prefill($capFile2, [
    'locked' => $entry($max, -800, 800),   // laeuft ab in 800 s
    'soon' => $entry(1, -850, 0),         // laeuft ab in 50 s
    'later' => $entry(1, -200, 0),        // laeuft ab in 700 s
]);
$recordCap('192.0.2.10');
$keys = array_keys($read($capFile2));
sort($keys);
check('admin: volle Datei verdraengt den am fruehesten ablaufenden Eintrag, die spaete Sperre bleibt',
    $keys === ['192.0.2.10', 'later', 'locked']);
$recordCap('192.0.2.11');
$keys = array_keys($read($capFile2));
sort($keys);
check('admin: danach faellt der naechstfruehe (ungesperrt, 700 s) vor der Sperre (800 s)',
    $keys === ['192.0.2.10', '192.0.2.11', 'locked']);

$prefill($capFile2, [
    'lockedSoon' => $entry($max, -895, 10), // Sperre laeuft in 10 s ab
    'unlocked' => $entry(1, -100, 0),      // laeuft ab in 800 s
    'expired' => $entry(2, -$window - 5, 0), // abgelaufen
]);
$recordCap('192.0.2.12');
$keys = array_keys($read($capFile2));
sort($keys);
check('admin: abgelaufener Eintrag faellt beim Aufraeumen weg, ohne dass verdraengt wird',
    $keys === ['192.0.2.12', 'lockedSoon', 'unlocked']);
$recordCap('192.0.2.13');
$keys = array_keys($read($capFile2));
sort($keys);
check('admin: auch eine Sperre wird verdraengt, wenn sie am fruehesten ablaeuft',
    $keys === ['192.0.2.12', '192.0.2.13', 'unlocked']);

// L-3: Lock-Datei nicht oeffenbar (Verzeichnis statt Datei), Sperre gespeichert: Sperre gilt weiter.
$noLockFile = "{$tmpDir}/admin-nolock.json";
$prefill($noLockFile, ['198.51.100.60' => $entry($max, -60, 840)]);
mkdir($noLockFile . '.lock');
$retry = rateLimitFailureCheck($noLockFile, '198.51.100.60');
check('admin: Lock-Datei nicht oeffenbar, bestehende Sperre wird trotzdem durchgesetzt', $retry > 830 && $retry <= 840);
check('admin: Lock-Datei nicht oeffenbar, andere IP nicht gesperrt', rateLimitFailureCheck($noLockFile, '198.51.100.61') === 0);
rmdir($noLockFile . '.lock');

array_map('unlink', glob($tmpDir . '/*') ?: []);
@rmdir($tmpDir);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
