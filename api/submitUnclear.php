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
