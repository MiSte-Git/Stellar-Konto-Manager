<?php
// F-3: Was von einer Horizon-Antwort beim Senden eines Multisig-Jobs gespeichert und ausgegeben wird.
// Nur Fehlertext und result_codes (Ablehnung) bzw. Hash und Ledger (Erfolg). envelope_xdr und
// result_xdr fallen weg: Die Job-Liste ist ohne Token lesbar (G-Adresse reicht), und eine vorlaeufig
// abgelehnte Transaktion (z. B. tx_insufficient_fee) koennte ein Dritter sonst bis maxTime selbst
// einreichen. Gleiches Format wie services/submitResult.js:
//   Ablehnung: { error: string, detail: { message: string, extras: { result_codes? } } }
//   Erfolg:    { hash: string|null, ledger?: int }
// skm_sanitize_submitted_result bereinigt auch Altjobs (detail.extras = ganze extras, Erfolg mit
// envelopeXdr/resultXdr, Node-Format mit error = ganze Horizon-Antwort) beim Lesen.
declare(strict_types=1);

const SKM_SUBMIT_MAX_MESSAGE_LENGTH = 300;

function skm_submit_clean_text($value): string {
    if (!is_string($value)) return '';
    $text = trim($value);
    // Nach Zeichen kuerzen, nicht nach Bytes: substr() zerschnitte Umlaute, json_encode() scheiterte dann.
    // Gleich wie Node (Array.from: nach Codepoints).
    return $text === '' ? '' : mb_substr($text, 0, SKM_SUBMIT_MAX_MESSAGE_LENGTH, 'UTF-8');
}

/** Nur die bekannten Felder, nur Strings. null, wenn nichts Brauchbares darin steht. */
function skm_clean_result_codes($codes): ?array {
    if (!is_array($codes) || array_is_list($codes) && $codes !== []) return null;
    $out = [];
    if (is_string($codes['transaction'] ?? null)) $out['transaction'] = $codes['transaction'];
    if (is_string($codes['inner_transaction'] ?? null)) $out['inner_transaction'] = $codes['inner_transaction'];
    if (is_array($codes['operations'] ?? null)) {
        $out['operations'] = array_values(array_filter($codes['operations'], 'is_string'));
    }
    return $out === [] ? null : $out;
}

function skm_submit_error_result_from(string $message, $codes): array {
    $text = skm_submit_clean_text($message);
    if ($text === '') $text = 'submit_failed';
    $resultCodes = skm_clean_result_codes($codes);
    // extras als Objekt ausgeben (JSON {}), auch wenn leer: gleiches Format wie Node.
    $extras = $resultCodes !== null ? ['result_codes' => $resultCodes] : new \stdClass();
    return ['error' => $text, 'detail' => ['message' => $text, 'extras' => $extras]];
}

/** Aus einer Ausnahme von submitToNetwork() (SubmitFailedException mit Horizon-extras) oder einem anderen Fehler. */
function skm_submit_error_result(\Throwable $e): array {
    $extras = method_exists($e, 'getExtras') ? $e->getExtras() : [];
    $codes = is_array($extras) ? ($extras['result_codes'] ?? null) : null;
    return skm_submit_error_result_from($e->getMessage(), $codes);
}

/** Transaktions-Code aus einem Ergebnis von skm_submit_error_result (extras kann ein leeres Objekt sein). */
function skm_submitted_result_tx_code(array $sr): ?string {
    $extras = $sr['detail']['extras'] ?? null;
    $code = is_array($extras) ? ($extras['result_codes']['transaction'] ?? null) : null;
    return is_string($code) ? $code : null;
}

/** Aus der Erfolgsantwort von Horizon (POST /transactions). */
function skm_submit_success_result(array $data): array {
    $hash = $data['hash'] ?? ($data['id'] ?? null);
    $out = ['hash' => is_string($hash) ? $hash : null];
    if (is_int($data['ledger'] ?? null)) $out['ledger'] = $data['ledger'];
    return $out;
}

/** Bereinigt einen gespeicherten submittedResult (auch Altformate). null bleibt null. */
function skm_sanitize_submitted_result($sr): ?array {
    if (!is_array($sr) || $sr === []) return null;
    if (isset($sr['error'])) {
        $err = $sr['error'];
        if (is_string($err)) {
            $message = $err;
        } else {
            $message = skm_submit_clean_text($err['title'] ?? null)
                ?: skm_submit_clean_text($err['detail'] ?? null)
                ?: skm_submit_clean_text($err['message'] ?? null)
                ?: skm_submit_clean_text($sr['detail']['message'] ?? null);
        }
        $codes = $sr['detail']['extras']['result_codes'] ?? (is_array($err) ? ($err['extras']['result_codes'] ?? null) : null);
        return skm_submit_error_result_from($message, $codes);
    }
    return skm_submit_success_result($sr);
}

/** Job mit bereinigtem submittedResult (fuer jede Antwort, die einen Job ausgibt). */
function skm_with_sanitized_submit_result(array $job): array {
    if (array_key_exists('submittedResult', $job)) {
        $job['submittedResult'] = skm_sanitize_submitted_result($job['submittedResult']);
    }
    return $job;
}
