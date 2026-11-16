<?php
// F-2: Unklares Sendeergebnis eines Multisig-Jobs. Kommt beim Senden keine eindeutige Antwort von
// Horizon, kann die Transaktion trotzdem im Ledger landen. Der Job wird dann nicht submitted_failed
// (Endzustand, die Signer legen dieselbe Zahlung neu an und sie geht doppelt raus), sondern
// submit_unclear: nicht final, aber gesperrt (kein Merge, kein Ablehnen, kein Loeschen, nie erneutes
// Senden). Geklaert wird beim Lesen ueber GET /transactions/{hash}, sobald das Ergebnis feststehen
// kann: Sequence der Tx-Quelle verbraucht oder maxTime laut Serveruhr vorbei. Ob ein 404 endgueltig ist,
// entscheidet die Ledger-Zeit von Horizon (R-1), nie die Serveruhr. Gleiche Regeln und Konstanten wie
// services/submitUnclear.js. Braucht submitResult.php.
declare(strict_types=1);

use phpseclib3\Math\BigInteger;

const SUBMIT_UNCLEAR_STATUS = 'submit_unclear';
// R-1: Ein 404 ist erst endgueltig, wenn die Ledger-Zeit aus GET / mehr als so viele Sekunden nach maxTime
// liegt. Root und Transaktion sind zwei Anfragen und koennen hinter dem Load Balancer verschiedene Knoten
// treffen; mit der Marge muesste der Knoten der Transaktionsabfrage ueber 60 s zurueckliegen statt nur einen
// Ledger. Gleiche Marge wie der strenge Pfad im Sendeschutz des Frontends (maxTime plus 60 s).
const SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS = 60;
// Hoechstens so viele Abfragen GET /transactions/{hash} je Lese-Anfrage (Liste oder Detail).
const SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST = 5;
// Fehlertext, wenn die Transaktion im Ledger steht, aber fehlgeschlagen ist (Horizon liefert im
// Datensatz keine result_codes).
const SUBMIT_UNCLEAR_FAILED_MESSAGE = 'Transaction Failed';

/** Ausnahme von submitToNetwork(), wenn das Ergebnis unklar ist (Text im F-3-Format gespeichert). */
class SubmitUnclearException extends \Exception {}

/**
 * R-6: Eine Ablehnung braucht echte Codes: transaction oder inner_transaction als String oder mindestens
 * einen String in operations. Gleiche Regel wie hasResultCodes in services/submitUnclear.js, gemeinsame
 * Faelle in test/assets/submit-classification.json. (skm_clean_result_codes bleibt fuer das Speichern.)
 */
function skm_has_result_codes($codes): bool {
    if (!is_array($codes) || array_is_list($codes)) return false;
    if (is_string($codes['transaction'] ?? null) || is_string($codes['inner_transaction'] ?? null)) return true;
    $ops = $codes['operations'] ?? null;
    return is_array($ops) && count(array_filter($ops, 'is_string')) > 0;
}

/**
 * Antwort von POST /transactions: unklar sind keine Antwort ($httpCode null oder 0), 408, 429 und >= 500,
 * jeweils ohne result_codes, sowie 2xx ohne Hash. Mit result_codes und bei jedem anderen Status ist
 * es eine Ablehnung. 2xx mit Hash ist Erfolg (nicht unklar).
 */
function skm_submit_response_is_unclear(?int $httpCode, $data): bool {
    if ($httpCode === null || $httpCode === 0) return true;
    if ($httpCode >= 200 && $httpCode < 300) {
        return !(is_array($data) && is_string($data['hash'] ?? null) && $data['hash'] !== '');
    }
    $extras = is_array($data) ? ($data['extras'] ?? null) : null;
    $codes = is_array($extras) ? ($extras['result_codes'] ?? null) : null;
    if (skm_has_result_codes($codes)) return false;
    return $httpCode === 408 || $httpCode === 429 || $httpCode >= 500;
}

/** Konto-Sequence >= Tx-Sequence. Unbekannte oder kaputte Werte: nicht verbraucht. */
function skm_sequence_consumed(BigInteger $txSequence, ?string $accountSequence): bool {
    if ($accountSequence === null || !preg_match('/^-?[0-9]+$/', $accountSequence)) return false;
    return (new BigInteger($accountSequence))->compare($txSequence) >= 0;
}

/**
 * Wird jetzt abgefragt? Bei verbrauchter Sequence oder wenn maxTime laut Serveruhr vorbei ist (maxTime 0:
 * ohne Zeitgrenze, nie). Die Serveruhr bestimmt nur, wann gefragt wird; endgueltig macht einen 404 nur
 * die Ledger-Zeit (skm_ledger_past_max_time). Geht die Uhr nach, wird spaeter gefragt, geht sie vor, umsonst.
 */
function skm_unclear_resolve_due(bool $sequenceConsumed, int $maxTimeUnix, int $nowUnix): bool {
    return $sequenceConsumed || ($maxTimeUnix > 0 && $nowUnix > $maxTimeUnix);
}

/**
 * history_latest_ledger_closed_at aus GET / als Unix-Sekunden, sonst null. Horizon liefert UTC mit Z
 * (2026-11-15T10:00:00Z). Nur diese Form; ein unmoegliches Datum (30. Februar, Stunde 99) ergibt null,
 * gleich wie parseLedgerClosedAt in services/submitUnclear.js.
 */
function skm_parse_ledger_closed_at($value): ?int {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $value)) return null;
    $dt = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $value, new \DateTimeZone('UTC'));
    if ($dt === false || $dt->format('Y-m-d\TH:i:s\Z') !== $value) return null;
    return $dt->getTimestamp();
}

/**
 * R-1: Hat Horizon einen Ledger aufgenommen, der mehr als SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS nach maxTime
 * geschlossen wurde? Eine Transaktion kann nur in einen Ledger mit Schliesszeit <= maxTime; liegt der zuletzt
 * aufgenommene danach, sind alle Ledger bis maxTime aufgenommen und ein 404 ist endgueltig. Die Marge deckt
 * einen anderen, nachhinkenden Knoten fuer die Transaktionsabfrage ab. Ohne Ledger-Zeit oder Zeitgrenze: nie.
 */
function skm_ledger_past_max_time(int $maxTimeUnix, ?int $ledgerClosedAtUnix): bool {
    return $maxTimeUnix > 0 && $ledgerClosedAtUnix !== null
        && $ledgerClosedAtUnix > $maxTimeUnix + SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS;
}

/**
 * Ergebnis aus dem Abruf der Transaktion. $lookup: ['kind' => 'found', 'successful' => bool, 'hash',
 * 'ledger'] | ['kind' => 'not_found'] | ['kind' => 'error']. null: bleibt unklar. Ohne submittedResult
 * bleibt das gespeicherte (der Fehlertext vom Senden). Gefunden ist sofort endgueltig, ein 404 erst bei
 * $ledgerPastMaxTime (Horizon meldet einen Ledger mehr als 60 s nach maxTime): Ein Knoten kann hinterherhinken (auch
 * mehr als Minuten), dann zeigt er weder die Transaktion noch die verbrauchte Sequence.
 */
function skm_unclear_outcome(array $lookup, bool $sequenceConsumed, bool $ledgerPastMaxTime): ?array {
    $kind = $lookup['kind'] ?? '';
    if ($kind === 'found') {
        $successful = $lookup['successful'] ?? null;
        if ($successful === true) {
            return ['status' => 'submitted_success', 'submittedResult' => skm_submit_success_result(['hash' => $lookup['hash'] ?? null, 'ledger' => $lookup['ledger'] ?? null])];
        }
        if ($successful === false) {
            return ['status' => 'submitted_failed', 'submittedResult' => skm_submit_error_result_from(SUBMIT_UNCLEAR_FAILED_MESSAGE, null)];
        }
        return null;
    }
    if ($kind === 'not_found') {
        if (!$ledgerPastMaxTime) return null;
        return ['status' => $sequenceConsumed ? 'obsolete_seq' : 'expired'];
    }
    return null;
}

// ADR 0014: Klaerung extern gesendeter Jobs ueber den txHash. SKM sendet nur ueber den Write-ahead
// submit_unclear (R-3); steht ein Job mit einem dieser gespeicherten Status im Ledger, hat ihn jemand
// ausserhalb von SKM gesendet. Offene Jobs und die Endzustaende, die SKM ohne Blick ins Ledger setzt
// (Waechter, Merge, Ablehnen). submitted_success und submitted_failed nie. Gleich wie services/submitUnclear.js.
const EXTERNAL_CHECK_STATUSES = ['pending_signatures', 'ready_to_submit', 'expired', 'obsolete_seq', 'rejected'];
// Endzustaende, die ein sicherer 404 stehen laesst (es kommt nur ledgerCheckedAt dazu). expired nicht: Kandidaten haben
// eine verbrauchte Sequence, und ein Widerruf (bumpSequence) ergibt obsolete_seq, auch wenn der Waechter (Serveruhr)
// den Job vorher bei maxTime auf expired gesetzt hat (ES-6).
const EXTERNAL_CHECK_FINAL_STATUSES = ['obsolete_seq', 'rejected'];

/**
 * Wird der gespeicherte Job auf ein externes Senden geprueft? Status aus EXTERNAL_CHECK_STATUSES, noch ohne
 * ledgerCheckedAt (Marker nach der Klaerung) und nicht schon als extern gesendet markiert. Ob die Sequence
 * verbraucht ist, prueft der Aufrufer mit Live-Kontodaten. Gleich wie isExternalCheckCandidate in Node.
 */
function skm_is_external_check_candidate($storedJob): bool {
    if (!is_array($storedJob)) return false;
    $ledgerCheckedAt = $storedJob['ledgerCheckedAt'] ?? null;
    return in_array($storedJob['status'] ?? null, EXTERNAL_CHECK_STATUSES, true)
        && ($ledgerCheckedAt === null || $ledgerCheckedAt === '' || $ledgerCheckedAt === false || $ledgerCheckedAt === 0)
        && ($storedJob['submittedExternally'] ?? null) !== true;
}

/**
 * maxTime plus Marge laut Serveruhr vorbei? Dann kann ein 404 schon endgueltig sein bzw. lohnt die Ledger-Zeit
 * (skm_ledger_past_max_time entscheidet). Ohne Zeitgrenze (0) nie. Gleich wie isPastMaxTimeByClock in Node.
 */
function skm_past_max_time_by_clock(int $maxTimeUnix, int $nowUnix): bool {
    return $maxTimeUnix > 0 && $nowUnix > $maxTimeUnix + SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS;
}

/**
 * ADR 0014: Reihenfolge im gemeinsamen Budget (SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST). Zuerst submit_unclear
 * (Sendeschutz). Dann Kandidaten mit mindestens einer gueltigen gesammelten Signatur eines Signers des Job-Kontos
 * (signed) vor Jobs ohne Signatur (ES-2): Eine gueltige Signatur kann niemand ohne Key erzeugen. Innerhalb jeder
 * Gruppe zuerst Kandidaten, deren maxTime plus Marge laut Serveruhr vorbei ist, dann aelteste maxTime, ohne
 * Zeitgrenze (0) zuletzt. Sonst Reihenfolge der Liste (usort ist ab PHP 8 stabil). Die Serveruhr ordnet nur;
 * endgueltig macht einen 404 nur die Ledger-Zeit. $a, $b: ['unclear' => bool, 'signed' => bool, 'maxTimeUnix' => int].
 * Gleich wie compareResolvePriority in Node.
 */
function skm_compare_resolve_priority(array $a, array $b, int $nowUnix): int {
    $ua = (bool)($a['unclear'] ?? false);
    $ub = (bool)($b['unclear'] ?? false);
    if ($ua !== $ub) return $ua ? -1 : 1;
    if ($ua) return 0;
    $sa = ($a['signed'] ?? false) === true;
    $sb = ($b['signed'] ?? false) === true;
    if ($sa !== $sb) return $sa ? -1 : 1;
    $decidable = fn(array $c): bool => skm_past_max_time_by_clock((int)$c['maxTimeUnix'], $nowUnix);
    if ($decidable($a) !== $decidable($b)) return $decidable($a) ? -1 : 1;
    $key = fn(array $c): int => (int)$c['maxTimeUnix'] > 0 ? (int)$c['maxTimeUnix'] : PHP_INT_MAX;
    return $key($a) <=> $key($b);
}

/**
 * Datensatz aus GET /transactions/{hash} als Ergebnis der Abfrage. Nur ein Datensatz zum abgefragten Hash zaehlt
 * (eigener Hash oder inner_transaction.hash eines Fee-Bumps), sonst Fehler. createdAt nur in der Form von Horizon
 * (UTC mit Z), sonst null. successful nur als Boolean. Gleich wie transactionLookupFromRecord in Node.
 */
function skm_transaction_lookup_from_record($data, string $queriedHash): array {
    if (!is_array($data) || $queriedHash === '') return ['kind' => 'error'];
    $inner = $data['inner_transaction'] ?? null;
    $innerHash = is_array($inner) ? ($inner['hash'] ?? null) : null;
    if (($data['hash'] ?? null) !== $queriedHash && $innerHash !== $queriedHash) return ['kind' => 'error'];
    $createdAt = $data['created_at'] ?? null;
    return [
        'kind' => 'found',
        'successful' => is_bool($data['successful'] ?? null) ? $data['successful'] : null,
        'hash' => $queriedHash,
        'ledger' => is_int($data['ledger'] ?? null) ? $data['ledger'] : null,
        'createdAt' => skm_parse_ledger_closed_at($createdAt) !== null ? $createdAt : null,
    ];
}

/**
 * ADR 0014: Ergebnis fuer einen Kandidaten (skm_is_external_check_candidate, Sequence verbraucht).
 * Gefunden und erfolgreich: submitted_success mit submittedExternally, submittedResult im F-3-Format, submittedAt
 * aus created_at von Horizon (null, wenn es fehlt). Gefunden und fehlgeschlagen: submitted_failed ebenso. Ein 404
 * nur bei $ledgerPastMaxTime (R-1): obsolete_seq (die Sequence ist verbraucht), gespeichert obsolete_seq und rejected
 * bleiben. Sonst null: nichts speichern, beim naechsten Lesen erneut. Gleich wie externalOutcome in Node.
 */
function skm_external_outcome(array $lookup, bool $ledgerPastMaxTime, string $storedStatus): ?array {
    $kind = $lookup['kind'] ?? '';
    if ($kind === 'found') {
        $submittedAt = is_string($lookup['createdAt'] ?? null) ? $lookup['createdAt'] : null;
        $successful = $lookup['successful'] ?? null;
        if ($successful === true) {
            return [
                'status' => 'submitted_success',
                'submittedExternally' => true,
                'submittedResult' => skm_submit_success_result(['hash' => $lookup['hash'] ?? null, 'ledger' => $lookup['ledger'] ?? null]),
                'submittedAt' => $submittedAt,
            ];
        }
        if ($successful === false) {
            return [
                'status' => 'submitted_failed',
                'submittedExternally' => true,
                'submittedResult' => skm_submit_error_result_from(SUBMIT_UNCLEAR_FAILED_MESSAGE, null),
                'submittedAt' => $submittedAt,
            ];
        }
        return null;
    }
    if ($kind === 'not_found' && $ledgerPastMaxTime) {
        return ['status' => in_array($storedStatus, EXTERNAL_CHECK_FINAL_STATUSES, true) ? $storedStatus : 'obsolete_seq'];
    }
    return null;
}

// ES-9: Endzustaende, die SKM ohne Blick ins Ledger setzt. Gleich wie EXTERNAL_UNCONSUMED_FINAL_STATUSES in Node.
const EXTERNAL_UNCONSUMED_FINAL_STATUSES = ['expired', 'obsolete_seq', 'rejected'];

/**
 * ADR 0014 (ES-9): Kandidat im Endzustand, Sequence laut Live-Daten nicht verbraucht. Meldet Horizon einen Ledger mehr
 * als 60 s nach maxTime (R-1), kann die Transaktion nie mehr ins Ledger: Status bleibt, nur ledgerCheckedAt kommt
 * dazu. Ohne Zeitgrenze (maxTime 0, nur Altjobs) und fuer offene Jobs nie. Sonst null. Gleich wie
 * externalUnconsumedOutcome in Node.
 */
function skm_external_unconsumed_outcome(string $storedStatus, bool $ledgerPastMaxTime): ?array {
    if (!$ledgerPastMaxTime || !in_array($storedStatus, EXTERNAL_UNCONSUMED_FINAL_STATUSES, true)) return null;
    return ['status' => $storedStatus];
}
