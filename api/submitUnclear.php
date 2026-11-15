<?php
// F-2: Unklares Sendeergebnis eines Multisig-Jobs. Kommt beim Senden keine eindeutige Antwort von
// Horizon, kann die Transaktion trotzdem im Ledger landen. Der Job wird dann nicht submitted_failed
// (Endzustand, die Signer legen dieselbe Zahlung neu an und sie geht doppelt raus), sondern
// submit_unclear: nicht final, aber gesperrt (kein Merge, kein Ablehnen, kein Loeschen, nie erneutes
// Senden). Geklaert wird beim Lesen ueber GET /transactions/{hash}, sobald das Ergebnis feststehen
// muss: Sequence der Tx-Quelle verbraucht oder maxTime + SUBMIT_UNCLEAR_GRACE_SECONDS vorbei.
// Gleiche Regeln und Konstanten wie services/submitUnclear.js. Braucht submitResult.php.
declare(strict_types=1);

use phpseclib3\Math\BigInteger;

const SUBMIT_UNCLEAR_STATUS = 'submit_unclear';
// Karenz nach maxTime: Horizon kann dem Ledger einige Sekunden hinterherhinken, und die Uhr des
// Servers muss nicht genau mit der Schliesszeit der Ledger uebereinstimmen.
const SUBMIT_UNCLEAR_GRACE_SECONDS = 120;
// Hoechstens so viele Abfragen GET /transactions/{hash} je Lese-Anfrage (Liste oder Detail).
const SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST = 5;
// Fehlertext, wenn die Transaktion im Ledger steht, aber fehlgeschlagen ist (Horizon liefert im
// Datensatz keine result_codes).
const SUBMIT_UNCLEAR_FAILED_MESSAGE = 'Transaction Failed';

/** Ausnahme von submitToNetwork(), wenn das Ergebnis unklar ist (Text im F-3-Format gespeichert). */
class SubmitUnclearException extends \Exception {}

/**
 * Antwort von POST /transactions: unklar sind keine Antwort ($httpCode null), 408, 429 und >= 500,
 * jeweils ohne result_codes, sowie 2xx ohne Hash. Mit result_codes und bei jedem anderen Status ist
 * es eine Ablehnung. 2xx mit Hash ist Erfolg (nicht unklar).
 */
function skm_submit_response_is_unclear(?int $httpCode, $data): bool {
    if ($httpCode === null) return true;
    if ($httpCode >= 200 && $httpCode < 300) {
        return !(is_array($data) && is_string($data['hash'] ?? null) && $data['hash'] !== '');
    }
    $codes = is_array($data) ? ($data['extras']['result_codes'] ?? null) : null;
    if (skm_clean_result_codes($codes) !== null) return false;
    return $httpCode === 408 || $httpCode === 429 || $httpCode >= 500;
}

/** Konto-Sequence >= Tx-Sequence. Unbekannte oder kaputte Werte: nicht verbraucht. */
function skm_sequence_consumed(BigInteger $txSequence, ?string $accountSequence): bool {
    if ($accountSequence === null || !preg_match('/^-?[0-9]+$/', $accountSequence)) return false;
    return (new BigInteger($accountSequence))->compare($txSequence) >= 0;
}

/** Ist jetzt > maxTime + Karenz? maxTimeUnix 0 heisst ohne Zeitgrenze: nie vorbei. */
function skm_unclear_time_passed(int $maxTimeUnix, int $nowUnix): bool {
    return $maxTimeUnix > 0 && $nowUnix > $maxTimeUnix + SUBMIT_UNCLEAR_GRACE_SECONDS;
}

/** Darf jetzt abgefragt werden? Bei verbrauchter Sequence oder abgelaufener Zeit (plus Karenz). */
function skm_unclear_resolve_due(bool $sequenceConsumed, int $maxTimeUnix, int $nowUnix): bool {
    return $sequenceConsumed || skm_unclear_time_passed($maxTimeUnix, $nowUnix);
}

/**
 * Ergebnis aus dem Abruf der Transaktion. $lookup: ['kind' => 'found', 'successful' => bool, 'hash',
 * 'ledger'] | ['kind' => 'not_found'] | ['kind' => 'error']. null: bleibt unklar. Ohne submittedResult
 * bleibt das gespeicherte (der Fehlertext vom Senden). Gefunden ist sofort endgueltig, ein 404 erst bei
 * $timePassed (jetzt > maxTime + Karenz): Horizon laeuft hinter einem Load Balancer, das Konto (Sequence
 * verbraucht) kann vom aktuellen Knoten kommen und der 404 von einem nachhinkenden.
 */
function skm_unclear_outcome(array $lookup, bool $sequenceConsumed, bool $timePassed): ?array {
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
        if (!$timePassed) return null;
        return ['status' => $sequenceConsumed ? 'obsolete_seq' : 'expired'];
    }
    return null;
}
