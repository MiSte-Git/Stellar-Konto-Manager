<?php
// Ablehnen eines Multisig-Jobs durch einen Signer. Gleiche Logik in services/multisigDecline.js.
//
// Eine Ablehnung ist zunaechst eine Information fuer die anderen Signer: Auf dem Netz
// stoppt sie die Transaktion nicht (dafuer gibt es den Widerruf per bumpSequence). Der
// Job selbst wird aber abgelehnt (Status rejected, nimmt keine Signaturen mehr an),
// sobald die Signer, die nicht abgelehnt haben, das noetige Gewicht nicht mehr
// erreichen koennen. Das Gewicht kommt aus den aktuellen Signern des Kontos (Horizon),
// nie aus der Anfrage.

declare(strict_types=1);

/**
 * @return array{declinedSigners: array, status: string, possibleWeight: int}
 */
function applyDecline(array $job, string $signerPk, array $liveSigners, string $nowIso): array {
    $previous = is_array($job['declinedSigners'] ?? null) ? $job['declinedSigners'] : [];
    $declined = array_values(array_filter($previous, function ($d) use ($signerPk) {
        return is_array($d) && ($d['publicKey'] ?? '') !== '' && ($d['publicKey'] ?? '') !== $signerPk;
    }));
    $declined[] = ['publicKey' => $signerPk, 'at' => $nowIso];
    $declinedKeys = [];
    foreach ($declined as $d) $declinedKeys[$d['publicKey']] = true;
    $possible = 0;
    foreach ($liveSigners as $s) {
        $w = (int)($s['weight'] ?? 0);
        if ($w > 0 && !isset($declinedKeys[$s['publicKey'] ?? ''])) $possible += $w;
    }
    $required = (int)($job['requiredWeight'] ?? 0);
    $status = ($required > 0 && $possible < $required) ? 'rejected' : (string)($job['status'] ?? 'pending_signatures');
    return ['declinedSigners' => $declined, 'status' => $status, 'possibleWeight' => $possible];
}

// Wer doch noch signiert hat, gilt nicht mehr als ablehnend.
function dropDeclinesOfCollected(array $declined, array $collected): array {
    $keys = [];
    foreach ($collected as $c) $keys[$c['publicKey'] ?? ''] = true;
    return array_values(array_filter($declined, fn($d) => is_array($d) && !isset($keys[$d['publicKey'] ?? ''])));
}
