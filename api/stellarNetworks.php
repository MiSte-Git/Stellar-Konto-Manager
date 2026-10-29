<?php
// Netzwerk-Registry fuer das PHP-Backend. Spiegel von services/stellarNetworks.js
// und frontend/src/config/networks.js (Paritaet geprueft durch
// test/stellarNetworks.test.js).
//
// Backend-IDs sind kleingeschrieben ('public' | 'testnet' | 'futurenet').
// skm_normalize_network() liefert nur aktivierte Netze, sonst null.
// Futurenet ist vorbereitet, aber deaktiviert.

declare(strict_types=1);

use Soneso\StellarSDK\Network;

const SKM_NETWORKS = [
    'public' => [
        'passphrase' => 'Public Global Stellar Network ; September 2015',
        'horizonUrl' => 'https://horizon.stellar.org',
        'enabled' => true,
    ],
    'testnet' => [
        'passphrase' => 'Test SDF Network ; September 2015',
        'horizonUrl' => 'https://horizon-testnet.stellar.org',
        'enabled' => true,
    ],
    'futurenet' => [
        'passphrase' => 'Test SDF Future Network ; October 2022',
        'horizonUrl' => 'https://horizon-futurenet.stellar.org',
        'enabled' => false,
    ],
];

const SKM_NETWORK_ALIASES = [
    'public' => 'public',
    'publicnet' => 'public',
    'testnet' => 'testnet',
    'test' => 'testnet',
    'futurenet' => 'futurenet',
];

/** Aktiviertes Backend-Netz ('public' | 'testnet') oder null. */
function skm_normalize_network(?string $raw): ?string {
    $id = SKM_NETWORK_ALIASES[strtolower(trim((string)$raw))] ?? null;
    return ($id !== null && SKM_NETWORKS[$id]['enabled']) ? $id : null;
}

/** Konfiguration fuer ein gespeichertes Netz; wirft bei unbekanntem Wert. */
function skm_network_config(string $id): array {
    $key = SKM_NETWORK_ALIASES[strtolower(trim($id))] ?? null;
    if ($key === null) {
        throw new InvalidArgumentException('unknown_network:' . $id);
    }
    return SKM_NETWORKS[$key];
}

function skm_horizon_url(string $id): string {
    return skm_network_config($id)['horizonUrl'];
}

function skm_network_obj(string $id): Network {
    return new Network(skm_network_config($id)['passphrase']);
}

/** Netz aus Query-Parametern; fehlend, unbekannt oder deaktiviert -> 'public'. */
function skm_network_from_query($raw): string {
    return skm_normalize_network(is_string($raw) ? $raw : null) ?? 'public';
}
