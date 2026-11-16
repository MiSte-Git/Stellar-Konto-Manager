<?php
// ADR 0014 (PHP): reine Funktionen der Klaerung extern gesendeter Jobs gegen die gemeinsame Fixture
// test/assets/external-submit.json (Kandidaten, Datensatz aus GET /transactions/{hash}, Ergebnis,
// Reihenfolge im Budget, Endzustand mit freier Sequence). Pendant: test/externalSubmit.test.js.
//
// Run with: php test/externalSubmit.test.php

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

const JOB_HASH = '3d5d0f50' . '00000000000000000000000000000000000000000000000000000000';

$fixture = json_decode((string)file_get_contents(__DIR__ . '/assets/external-submit.json'), true);
// $JOB_HASH durch den Hash ersetzen.
$withHash = fn($value) => json_decode(str_replace('$JOB_HASH', JOB_HASH, (string)json_encode($value)), true);
$asJson = fn($value) => json_encode($value);
// Erwartung aus der als Objekt geladenen Fixture, damit {} ein Objekt bleibt (assoziativ wird es zu []).
$fixtureObj = json_decode((string)file_get_contents(__DIR__ . '/assets/external-submit.json'), false);
$expectedJson = fn($value) => str_replace('$JOB_HASH', JOB_HASH, (string)json_encode($value));

foreach (['candidateCases', 'recordCases', 'outcomeCases', 'orderCases', 'routeCases', 'unconsumedCases'] as $key) {
    check("Fixture: Abschnitt {$key} vorhanden", is_array($fixture[$key] ?? null) && count($fixture[$key]) > 0);
}

foreach ($fixture['candidateCases'] as $c) {
    check('Kandidat: ' . $c['name'], skm_is_external_check_candidate($c['job']) === $c['expected']);
}

foreach ($fixture['recordCases'] as $c) {
    $out = skm_transaction_lookup_from_record($withHash($c['record']), JOB_HASH);
    check('Datensatz: ' . $c['name'], $out === $withHash($c['expected']));
}

foreach ($fixture['outcomeCases'] as $i => $c) {
    $out = skm_external_outcome($withHash($c['lookup']), $c['ledgerPastMaxTime'], $c['storedStatus']);
    // extras ist in PHP ein stdClass (JSON {}), wie Node; Vergleich ueber JSON.
    check('Ergebnis: ' . $c['name'], $asJson($out) === $expectedJson($fixtureObj->outcomeCases[$i]->expected));
}

foreach ($fixture['orderCases'] as $c) {
    $items = $c['items'];
    usort($items, fn(array $a, array $b) => skm_compare_resolve_priority($a, $b, (int)$c['now']));
    check('Reihenfolge: ' . $c['name'], array_column($items, 'name') === $c['expected']);
}

// ES-9: Endzustand mit freier Sequence nach der Marge: Status bleibt, sonst nichts.
foreach ($fixture['unconsumedCases'] as $c) {
    check('Freie Sequence: ' . $c['name'], skm_external_unconsumed_outcome($c['storedStatus'], $c['ledgerPastMaxTime']) === $c['expected']);
}
check('Serveruhr: maxTime 0 nie vorbei', skm_past_max_time_by_clock(0, PHP_INT_MAX) === false);
check('Serveruhr: maxTime plus 60 s ist noch nicht vorbei, plus 61 s schon',
    skm_past_max_time_by_clock(1000, 1060) === false && skm_past_max_time_by_clock(1000, 1061) === true);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
