<?php
// C2: allgemeiner Rate-Limiter api/rateLimit.php. Pendant: test/challengeRateLimit.test.js.
// Die Einbindung in POST /challenge prueft test/multisigDecline.test.php.
//
// Run with: php test/rateLimit.test.php

declare(strict_types=1);

require __DIR__ . '/../api/rateLimit.php';

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

$tmpDir = sys_get_temp_dir() . '/skm-ratelimit-' . bin2hex(random_bytes(4));
mkdir($tmpDir, 0775, true);
$file = $tmpDir . '/challenge.json';
$hit = fn(string $ip, string $f = '') => rateLimitCheckAndRecord($f !== '' ? $f : $file, $ip, 20, 60);

$within = true;
for ($i = 0; $i < 20; $i++) {
    if ($hit('198.51.100.7') !== 0) $within = false;
}
check('20 Anfragen je Minute sind erlaubt', $within);
$retry = $hit('198.51.100.7');
check('die 21. Anfrage ergibt retryAfter zwischen 1 und 60', $retry >= 1 && $retry <= 60);
check('andere IPv4 hat eigenes Budget', $hit('198.51.100.8') === 0);
check('eigene Datei je Bereich: anderer Bereich zaehlt getrennt', $hit('198.51.100.7', $tmpDir . '/other.json') === 0);

for ($i = 0; $i < 20; $i++) $hit('2001:db8:1:2::' . dechex($i + 1));
check('IPv6-Adressen aus derselben /64 teilen ein Budget', $hit('2001:db8:1:2:ffff::1') > 0);
check('naechstes /64 hat eigenes Budget', $hit('2001:db8:1:3::1') === 0);

check('IPv4-mapped zaehlt als IPv4', rateLimitClientKey('::ffff:203.0.113.9') === '203.0.113.9');
check('IPv6 wird auf /64 gekuerzt', rateLimitClientKey('2001:db8:1:2:aaaa::1') === rateLimitClientKey('2001:db8:1:2::'));
check('IPv4 bleibt unveraendert', rateLimitClientKey('203.0.113.9') === '203.0.113.9');

$capFile = $tmpDir . '/cap.json';
for ($i = 0; $i < 5; $i++) rateLimitCheckAndRecord($capFile, "192.0.2.{$i}", 20, 60, 3);
$stored = json_decode((string)file_get_contents($capFile), true) ?: [];
check('Obergrenze der Eintraege wird eingehalten', count($stored) === 3 && isset($stored['192.0.2.4']));

putenv('SKM_TEST_RATE_PATH=' . $tmpDir . '/env.json');
check('Pfad per Env ueberschreibbar', rateLimitPath('SKM_TEST_RATE_PATH', 'x.json') === $tmpDir . '/env.json');
putenv('SKM_TEST_RATE_PATH');
check('ohne Env liegt die Datei unter api/data/', rateLimitPath('SKM_TEST_RATE_PATH', 'x.json') === realpath(__DIR__ . '/../api') . '/data/x.json');

check('fail open, wenn die Lock-Datei nicht angelegt werden kann', rateLimitCheckAndRecord('/proc/skm-nicht-schreibbar/x.json', '198.51.100.7', 0, 60) === 0);

array_map('unlink', glob($tmpDir . '/*') ?: []);
@rmdir($tmpDir);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
