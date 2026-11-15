<?php
// R-6 (PHP): Einordnung unklar oder abgelehnt beim Senden eines Multisig-Jobs, gegen die gemeinsame
// Fixture test/assets/submit-classification.json (gleiche Faelle in test/submitClassification.test.js).
// skm_submit_response_is_unclear bekommt HTTP-Status (null = keine Antwort) und den dekodierten Body.
//
// Run with: php test/submitClassification.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';
require __DIR__ . '/../api/submitResult.php';
require __DIR__ . '/../api/submitUnclear.php';

$passed = 0;
$failed = 0;
function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) { $passed++; echo "\xE2\x9C\x94 {$description}\n"; }
    else { $failed++; echo "\xE2\x9C\x98 {$description}\n"; }
}

$cases = json_decode((string)file_get_contents(__DIR__ . '/assets/submit-classification.json'), true)['cases'] ?? [];
check('Fixture hat Faelle', count($cases) >= 20);
foreach ($cases as $c) {
    $actual = skm_submit_response_is_unclear($c['status'], $c['data']);
    check('R-6: ' . $c['name'] . ' -> ' . ($c['unclear'] ? 'unklar' : 'eindeutig'), $actual === $c['unclear']);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
