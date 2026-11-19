<?php
// TOML-Parser fuer die stellar.toml (SEP-1) und home_domain-Normalisierung, genutzt von /facts und /logo
// (api/trade.php, api/assetLogo.php). Gegenstueck ist die Bibliothek `toml` (5.0.1) in services/tradeService.js.
//
// Review LP-4: Vorher las ein Zeilenparser nur [[CURRENCIES]] und uebersprang alles, was er nicht verstand.
// Dieselbe Datei ergab dann in Node und PHP verschiedene Logos (BOM, \u-Escapes, doppelte Keys, Syntaxfehler
// an anderer Stelle, Keys in Anfuehrungszeichen, """-Strings, Inline-Tabellen). Jetzt liest PHP die ganze
// Datei wie die Node-Bibliothek: TOML 1.0 mit den Escapes \e und \xHH, die die Bibliothek zusaetzlich kennt.
// Jeder Fehler irgendwo in der Datei macht die ganze Datei ungueltig (RuntimeException 'toml_invalid_format'),
// wie in Node. Werte wie in Node nach JSON: Datum mit Zeitzone als ISO in UTC mit Millisekunden, lokale Datums-
// und Zeitwerte als Text, inf/nan/Ueberlauf als null, ganze Zahlen ueber 2^53 - 1 ungueltig.
// Gemeinsame Faelle: tomlCases in test/assets/asset-logo.json.
declare(strict_types=1);

function normalize_home_domain(string $domain): string {
    $domain = trim($domain);
    $domain = preg_replace('/^https?:\/\//i', '', $domain) ?? $domain;
    $domain = preg_replace('/\/.*$/', '', $domain) ?? $domain;
    return $domain;
}

/** Tabelle waehrend des Parsens. explicit: per [kopf] angelegt; frozen: Inline-Tabelle oder per Punkt-Key. */
final class SkmTomlTable {
    public array $items = [];
    public int $level = 1;
    public bool $explicit = false;
    public bool $frozen = false;
    public bool $dotted = false;
}

final class SkmTomlArrayOfTables {
    /** @var SkmTomlTable[] */
    public array $tables = [];
    public int $level = 1;
}

// Wie MAX_DEPTH in der Node-Bibliothek (node_modules/toml/lib/parser.js): jeder Wert zaehlt eine Ebene, auch der
// innerste Skalar; ungueltig ab mehr als 500 (500 leere Arrays gehen, 500 Arrays um eine Zahl nicht). Arrays und
// Inline-Tabellen zaehlen gleich. Tabellenkoepfe und Punkt-Keys zaehlen wie dort nicht.
const SKM_TOML_MAX_DEPTH = 500;
// Zweite Grenze, in Node in parseCurrencySectionsFromToml (die Bibliothek hat sie nicht): hoechstens 1000 Ebenen in
// der gelesenen Struktur, Tabellen und Arrays zaehlen, die Wurzel ist Ebene 1, Skalare zaehlen nicht. Tabellenkoepfe
// und Punkt-Keys ([k.k.k...]) bauen sonst beliebig tiefe Tabellen; PHP stuerzte bei 100000 Ebenen ab
// (Speicherzugriffsfehler beim Umwandeln und Aufraeumen), Node scheiterte an JSON.stringify. Hier wird schon beim
// Anlegen geprueft, damit keine tiefere Struktur entsteht.
const SKM_TOML_MAX_STRUCTURE_DEPTH = 1000;
// Review ST-1/ST-3 (stellarToml): hoechstens 50000 Knoten (Wurzel, Tabellen, Arrays und Skalare, jeder Wert einmal) und
// hoechstens 2000 Keys je Tabelle, in Node in assertStructureDepth gleich gezaehlt. Ohne Knotengrenze fuehrten
// 1 MB tief verschachtelter Arrays zu "Allowed memory size exhausted" (nicht fangbar, HTTP 500); ohne Key-Grenze
// brauchten 32768 Keys mit gleichem PHP-Hash (DJBX33A) mehrere Sekunden.
const SKM_TOML_MAX_NODES = 50000;
const SKM_TOML_MAX_KEYS_PER_TABLE = 2000;

final class SkmTomlParser {
    private string $s;
    private int $depth = 0;
    private int $nodes = 1; // Wurzel
    private int $maxDepth;
    private int $maxStructureDepth;
    private int $maxNodes;
    private int $maxKeysPerTable;
    private int $n;
    private int $i = 0;
    private SkmTomlTable $root;
    private SkmTomlTable $current;

    // Grenzen nur fuer Tests (Gegenprobe ohne Grenze) aenderbar.
    public function __construct(string $text, int $maxDepth = SKM_TOML_MAX_DEPTH, int $maxStructureDepth = SKM_TOML_MAX_STRUCTURE_DEPTH,
            int $maxNodes = SKM_TOML_MAX_NODES, int $maxKeysPerTable = SKM_TOML_MAX_KEYS_PER_TABLE) {
        $this->maxDepth = $maxDepth;
        $this->maxStructureDepth = $maxStructureDepth;
        $this->maxNodes = $maxNodes;
        $this->maxKeysPerTable = $maxKeysPerTable;
        // BOM am Anfang wie die Node-Bibliothek ueberspringen.
        if (strncmp($text, "\xEF\xBB\xBF", 3) === 0) $text = substr($text, 3);
        $text = skm_utf8_scrub($text);
        $this->s = $text;
        $this->n = strlen($text);
        $this->root = new SkmTomlTable();
        $this->root->explicit = true;
        $this->current = $this->root;
    }

    private function fail(): never {
        throw new RuntimeException('toml_invalid_format');
    }

    private function countNode(): void {
        if (++$this->nodes > $this->maxNodes) $this->fail();
    }

    // Neuer Key in einer Tabelle: Key-Grenze je Tabelle.
    private function addItem(SkmTomlTable $t, string $k, $v): void {
        if (count($t->items) >= $this->maxKeysPerTable) $this->fail();
        $t->items[$k] = $v;
    }

    private function newTable(int $level): SkmTomlTable {
        if ($level > $this->maxStructureDepth) $this->fail();
        $this->countNode();
        $t = new SkmTomlTable();
        $t->level = $level;
        return $t;
    }

    private function peek(int $o = 0): string {
        return $this->i + $o < $this->n ? $this->s[$this->i + $o] : '';
    }

    private function startsWith(string $t): bool {
        return substr_compare($this->s, $t, $this->i, strlen($t)) === 0;
    }

    private function skipWs(): void {
        while ($this->i < $this->n && ($this->s[$this->i] === ' ' || $this->s[$this->i] === "\t")) $this->i++;
    }

    private function skipComment(): void {
        if ($this->peek() !== '#') return;
        while ($this->i < $this->n && $this->s[$this->i] !== "\n") {
            $c = ord($this->s[$this->i]);
            if ($this->s[$this->i] === "\r" && $this->peek(1) === "\n") break;
            if (($c < 0x20 && $c !== 0x09) || $c === 0x7f) $this->fail();
            $this->i++;
        }
    }

    // Zeilenende: \n oder \r\n. Ein \r allein ist ungueltig (wie Node).
    private function eatNewline(): bool {
        if ($this->peek() === "\n") { $this->i++; return true; }
        if ($this->peek() === "\r" && $this->peek(1) === "\n") { $this->i += 2; return true; }
        return false;
    }

    // Nach einem Ausdruck: Leerraum, Kommentar, dann Zeilenende oder Dateiende.
    private function endOfLine(): void {
        $this->skipWs();
        $this->skipComment();
        if ($this->i >= $this->n) return;
        if (!$this->eatNewline()) $this->fail();
    }

    public function parse(): stdClass {
        return skm_toml_plain_item($this->parseRaw());
    }

    /** Wurzeltabelle vor der Umwandlung (Tabellen noch als SkmTomlTable unterscheidbar). */
    public function parseRaw(): SkmTomlTable {
        while (true) {
            // Leerzeilen, Leerraum, Kommentare.
            while (true) {
                $this->skipWs();
                $this->skipComment();
                if (!$this->eatNewline()) break;
            }
            if ($this->i >= $this->n) break;
            if ($this->startsWith('[[')) {
                $this->i += 2;
                $this->skipWs();
                $path = $this->parseKeyPath();
                $this->skipWs();
                if (!$this->startsWith(']]')) $this->fail();
                $this->i += 2;
                $this->openArrayTable($path);
            } elseif ($this->peek() === '[') {
                $this->i++;
                $this->skipWs();
                $path = $this->parseKeyPath();
                $this->skipWs();
                if ($this->peek() !== ']') $this->fail();
                $this->i++;
                $this->openTable($path);
            } else {
                $this->parseKeyValue($this->current);
            }
            $this->endOfLine();
        }
        return $this->root;
    }

    /** @return string[] */
    private function parseKeyPath(): array {
        $path = [$this->parseKey()];
        while (true) {
            $save = $this->i;
            $this->skipWs();
            if ($this->peek() !== '.') { $this->i = $save; break; }
            $this->i++;
            $this->skipWs();
            $path[] = $this->parseKey();
            // Mehr Teile als Ebenen erlaubt: ueberschreitet die Strukturgrenze sicher, frueh abbrechen statt
            // 500000 Teile zu sammeln (1 MB [k.k.k...]).
            if (count($path) > $this->maxStructureDepth) $this->fail();
        }
        return $path;
    }

    private function parseKey(): string {
        $c = $this->peek();
        if ($c === '"') {
            if ($this->startsWith('"""')) $this->fail();
            return $this->parseBasicString();
        }
        if ($c === "'") {
            if ($this->startsWith("'''")) $this->fail();
            return $this->parseLiteralString();
        }
        if (!preg_match('/\G[A-Za-z0-9_-]+/', $this->s, $m, 0, $this->i)) $this->fail();
        $this->i += strlen($m[0]);
        return $m[0];
    }

    // Zwischenstufe eines Pfads: bestehende Tabelle, letzte Tabelle eines [[...]] oder neue implizite Tabelle.
    private function descend(SkmTomlTable $t, string $k, bool $forDotted = false): SkmTomlTable {
        if (!array_key_exists($k, $t->items)) {
            $nt = $this->newTable($t->level + 1);
            if ($forDotted) $nt->dotted = true;
            $this->addItem($t, $k, $nt);
            return $nt;
        }
        $v = $t->items[$k];
        if ($v instanceof SkmTomlTable) {
            if ($v->frozen) $this->fail();
            // Ein [kopf] darf unter einer per Punkt-Key angelegten Tabelle eine Untertabelle oeffnen (TOML 1.0, wie
            // Node, Review ST-4); die Tabelle selbst wiederzuoeffnen lehnt openTable ab.
            if ($forDotted && $v->explicit && !$v->dotted) $this->fail();
            return $v;
        }
        if ($v instanceof SkmTomlArrayOfTables && !$forDotted) return $v->tables[count($v->tables) - 1];
        $this->fail();
    }

    private function openTable(array $path): void {
        $t = $this->root;
        $last = array_pop($path);
        foreach ($path as $k) $t = $this->descend($t, $k);
        if (array_key_exists($last, $t->items)) {
            $v = $t->items[$last];
            if (!($v instanceof SkmTomlTable) || $v->explicit || $v->frozen || $v->dotted) $this->fail();
            $v->explicit = true;
            $this->current = $v;
            return;
        }
        $nt = $this->newTable($t->level + 1);
        $nt->explicit = true;
        $this->addItem($t, $last, $nt);
        $this->current = $nt;
    }

    private function openArrayTable(array $path): void {
        $t = $this->root;
        $last = array_pop($path);
        foreach ($path as $k) $t = $this->descend($t, $k);
        if (!array_key_exists($last, $t->items)) {
            if ($t->level + 1 > $this->maxStructureDepth) $this->fail();
            $this->countNode();
            $aot = new SkmTomlArrayOfTables();
            $aot->level = $t->level + 1;
            $this->addItem($t, $last, $aot);
        } else {
            $aot = $t->items[$last];
            if (!($aot instanceof SkmTomlArrayOfTables)) $this->fail();
        }
        $nt = $this->newTable($aot->level + 1);
        $nt->explicit = true;
        $aot->tables[] = $nt;
        $this->current = $nt;
    }

    private function parseKeyValue(SkmTomlTable $table): void {
        $path = $this->parseKeyPath();
        $this->skipWs();
        if ($this->peek() !== '=') $this->fail();
        $this->i++;
        $this->skipWs();
        // Pfad vor dem Wert aufloesen, damit die Ebene des Werts feststeht (Strukturgrenze).
        $t = $table;
        $last = array_pop($path);
        foreach ($path as $k) $t = $this->descend($t, $k, true);
        $value = $this->parseValue($t->level + 1);
        // Doppelter Key im selben Eintrag (oder Key, der eine Tabelle ueberschreibt): ungueltig, wie Node.
        if (array_key_exists($last, $t->items)) $this->fail();
        $this->addItem($t, $last, $value);
    }

    // $level: Ebene, die ein Array oder eine Inline-Tabelle an dieser Stelle haette.
    private function parseValue(int $level) {
        if (++$this->depth > $this->maxDepth) $this->fail();
        try {
            return $this->parseValueBody($level);
        } finally {
            $this->depth--;
        }
    }

    private function parseValueBody(int $level) {
        $c = $this->peek();
        // Arrays und Inline-Tabellen zaehlen in parseArray bzw. newTable, alles andere hier.
        if ($c !== '[' && $c !== '{') $this->countNode();
        if ($c === '"') return $this->startsWith('"""') ? $this->parseMultilineBasic() : $this->parseBasicString();
        if ($c === "'") return $this->startsWith("'''") ? $this->parseMultilineLiteral() : $this->parseLiteralString();
        if ($c === '[') return $this->parseArray($level);
        if ($c === '{') return $this->parseInlineTable($level);
        if ($this->startsWith('true')) { $this->i += 4; return true; }
        if ($this->startsWith('false')) { $this->i += 5; return false; }
        $dt = $this->parseDateTime();
        if ($dt !== null) return $dt;
        return $this->parseNumber();
    }

    private function parseArray(int $level): array {
        if ($level > $this->maxStructureDepth) $this->fail();
        $this->countNode();
        $this->i++; // [
        $out = [];
        while (true) {
            $this->skipArrayWs();
            if ($this->peek() === ']') { $this->i++; return $out; }
            $out[] = $this->parseValue($level + 1);
            $this->skipArrayWs();
            if ($this->peek() === ',') { $this->i++; continue; }
            if ($this->peek() === ']') { $this->i++; return $out; }
            $this->fail();
        }
    }

    private function skipArrayWs(): void {
        while (true) {
            $this->skipWs();
            $this->skipComment();
            if (!$this->eatNewline()) return;
        }
    }

    // Inline-Tabelle. Die Node-Bibliothek erlaubt Zeilenumbrueche und ein Komma am Ende, darum hier ebenso.
    private function parseInlineTable(int $level): SkmTomlTable {
        $t = $this->newTable($level);
        $this->i++; // {
        while (true) {
            $this->skipArrayWs();
            if ($this->peek() === '}') { $this->i++; break; }
            $this->parseKeyValue($t);
            $this->skipArrayWs();
            if ($this->peek() === ',') { $this->i++; continue; }
            if ($this->peek() === '}') { $this->i++; break; }
            $this->fail();
        }
        self::freeze($t);
        return $t;
    }

    private static function freeze(SkmTomlTable $t): void {
        $t->frozen = true;
        // Schon eingefrorene (innere Inline-Tabellen) nicht erneut durchlaufen, sonst quadratisch (Review ST-2).
        foreach ($t->items as $v) if ($v instanceof SkmTomlTable && !$v->frozen) self::freeze($v);
    }

    private function checkStringChar(int $c, bool $allowNewline): void {
        if ($c === 0x09) return;
        if ($allowNewline && ($c === 0x0a || $c === 0x0d)) return;
        if ($c < 0x20 || $c === 0x7f) $this->fail();
    }

    private function parseBasicString(): string {
        $this->i++; // "
        $out = '';
        while (true) {
            if ($this->i >= $this->n) $this->fail();
            $ch = $this->s[$this->i];
            if ($ch === '"') { $this->i++; return $out; }
            if ($ch === '\\') { $out .= $this->parseEscape(); continue; }
            $this->checkStringChar(ord($ch), false);
            $out .= $ch;
            $this->i++;
        }
    }

    private function parseMultilineBasic(): string {
        $this->i += 3;
        $this->eatNewline(); // Zeilenumbruch direkt nach """ zaehlt nicht
        $out = '';
        while (true) {
            if ($this->i >= $this->n) $this->fail();
            if ($this->startsWith('"""')) {
                // Bis zu zwei weitere " vor dem Ende gehoeren zum Inhalt.
                $q = 3;
                while ($q < 5 && $this->peek($q) === '"') $q++;
                $out .= str_repeat('"', $q - 3);
                $this->i += $q;
                return $out;
            }
            $ch = $this->s[$this->i];
            if ($ch === '\\') {
                // Backslash am Zeilenende: Umbruch und folgender Leerraum fallen weg.
                $j = $this->i + 1;
                while ($j < $this->n && ($this->s[$j] === ' ' || $this->s[$j] === "\t")) $j++;
                if ($j < $this->n && ($this->s[$j] === "\n" || ($this->s[$j] === "\r" && ($this->s[$j + 1] ?? '') === "\n"))) {
                    $this->i = $j;
                    while ($this->i < $this->n && in_array($this->s[$this->i], [' ', "\t", "\n", "\r"], true)) {
                        if ($this->s[$this->i] === "\r" && $this->peek(1) !== "\n") $this->fail();
                        $this->i++;
                    }
                    continue;
                }
                $out .= $this->parseEscape();
                continue;
            }
            if ($ch === "\r") {
                // \r\n im mehrzeiligen String wird wie in Node zu \n, ein \r allein ist ungueltig.
                if ($this->peek(1) !== "\n") $this->fail();
                $this->i++;
                continue;
            }
            $this->checkStringChar(ord($ch), true);
            $out .= $ch;
            $this->i++;
        }
    }

    private function parseLiteralString(): string {
        $this->i++; // '
        $out = '';
        while (true) {
            if ($this->i >= $this->n) $this->fail();
            $ch = $this->s[$this->i];
            if ($ch === "'") { $this->i++; return $out; }
            $this->checkStringChar(ord($ch), false);
            $out .= $ch;
            $this->i++;
        }
    }

    private function parseMultilineLiteral(): string {
        $this->i += 3;
        $this->eatNewline();
        $out = '';
        while (true) {
            if ($this->i >= $this->n) $this->fail();
            if ($this->startsWith("'''")) {
                $q = 3;
                while ($q < 5 && $this->peek($q) === "'") $q++;
                $out .= str_repeat("'", $q - 3);
                $this->i += $q;
                return $out;
            }
            $ch = $this->s[$this->i];
            if ($ch === "\r") {
                // \r\n im mehrzeiligen String wird wie in Node zu \n, ein \r allein ist ungueltig.
                if ($this->peek(1) !== "\n") $this->fail();
                $this->i++;
                continue;
            }
            $this->checkStringChar(ord($ch), true);
            $out .= $ch;
            $this->i++;
        }
    }

    private function parseEscape(): string {
        $e = $this->peek(1);
        $this->i += 2;
        $simple = ['b' => "\x08", 't' => "\t", 'n' => "\n", 'f' => "\x0c", 'r' => "\r", '"' => '"', '\\' => '\\', 'e' => "\x1b"];
        if (isset($simple[$e])) return $simple[$e];
        $len = ['x' => 2, 'u' => 4, 'U' => 8][$e] ?? 0;
        if ($len === 0) $this->fail();
        $hex = substr($this->s, $this->i, $len);
        if (strlen($hex) !== $len || !ctype_xdigit($hex)) $this->fail();
        $this->i += $len;
        $cp = hexdec($hex);
        if ($cp > 0x10ffff || ($cp >= 0xd800 && $cp <= 0xdfff)) $this->fail();
        return mb_chr_compat((int)$cp);
    }

    private function parseDateTime() {
        // Sekunden duerfen fehlen (wie die Node-Bibliothek, TOML 1.1), Ausgabe dann mit :00.
        $re = '/\G(\d{4})-(\d{2})-(\d{2})(?:([Tt ])(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?)?/';
        if (preg_match($re, $this->s, $m, PREG_UNMATCHED_AS_NULL, $this->i)) {
            // "1979-05-27 x": das Leerzeichen gehoert nicht zum Datum, wenn keine Uhrzeit folgt.
            $len = strlen($m[0]);
            [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
            // Eigene Pruefung statt checkdate (das lehnt Jahr 0000 ab, Review ST-6).
            if ($mo < 1 || $mo > 12 || $d < 1 || $d > skm_days_in_month($y, $mo)) $this->fail();
            $this->i += $len;
            if ($m[4] === null) return sprintf('%s-%s-%s', $m[1], $m[2], $m[3]);
            $m[7] ??= '00';
            [$h, $mi, $se] = [(int)$m[5], (int)$m[6], (int)$m[7]];
            if ($h > 23 || $mi > 59 || $se > 59) $this->fail();
            $frac = $m[8] ?? '';
            if ($m[9] === null) {
                // Lokale Datums-Uhrzeit: wie Node als Text, mit T.
                return "{$m[1]}-{$m[2]}-{$m[3]}T{$m[5]}:{$m[6]}:{$m[7]}{$frac}";
            }
            $offset = strtoupper($m[9]) === 'Z' ? 0 : ((int)substr($m[9], 1, 2) * 60 + (int)substr($m[9], 4, 2)) * ($m[9][0] === '-' ? -1 : 1);
            if ($m[9] !== 'Z' && $m[9] !== 'z' && ((int)substr($m[9], 1, 2) > 23 || (int)substr($m[9], 4, 2) > 59)) $this->fail();
            $ms = $frac === '' ? 0 : (int)substr(str_pad(substr($frac, 1), 3, '0'), 0, 3);
            // Ueber DateTimeImmutable statt gmmktime: gmmktime macht aus 0050 das Jahr 2050 (Review ST-6).
            $dt = (new DateTimeImmutable('@0'))->setDate($y, $mo, $d)->setTime($h, $mi, $se);
            if ($offset !== 0) $dt = $dt->modify(($offset > 0 ? '-' : '+') . abs($offset) . ' minutes');
            // Wie Date.toISOString: Jahr 0..9999 vierstellig, sonst mit Vorzeichen und sechs Stellen.
            $yy = (int)$dt->format('Y');
            $year = ($yy >= 0 && $yy <= 9999) ? sprintf('%04d', $yy) : sprintf('%+07d', $yy);
            return $year . $dt->format('-m-d\TH:i:s') . sprintf('.%03dZ', $ms);
        }
        if (preg_match('/\G(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?/', $this->s, $m, PREG_UNMATCHED_AS_NULL, $this->i)) {
            if ((int)$m[1] > 23 || (int)$m[2] > 59 || (int)($m[3] ?? 0) > 59) $this->fail();
            $this->i += strlen($m[0]);
            return "{$m[1]}:{$m[2]}:" . ($m[3] ?? '00') . ($m[4] ?? '');
        }
        return null;
    }

    // Muster mit \G direkt auf der Eingabe (vorher ein Ausschnitt von 400 Zeichen, laengere Zahlen fielen durch,
    // Review ST-5).
    private function matchAt(string $re, ?array &$m): bool {
        $r = preg_match($re, $this->s, $m, 0, $this->i);
        if ($r === false) $this->fail();
        return $r === 1;
    }

    private function parseNumber() {
        if ($this->matchAt('/\G[+-]?(?:inf|nan)/', $m)) {
            $this->i += strlen($m[0]);
            return null; // wie JSON.stringify(Infinity/NaN) in Node
        }
        // Laenge ohne fuehrende Nullen: 2^53 - 1 hat 14 Hex-, 18 Oktal- und 53 Binaerstellen (Review ST-5).
        $digits = fn(string $raw): string => ltrim(str_replace('_', '', $raw), '0');
        if ($this->matchAt('/\G0x([0-9A-Fa-f](?:_?[0-9A-Fa-f])*)/', $m)) {
            $d = $digits($m[1]);
            return $this->intFrom($m[0], strlen($d) > 14 ? null : hexdec($d === '' ? '0' : $d));
        }
        if ($this->matchAt('/\G0o([0-7](?:_?[0-7])*)/', $m)) {
            $d = $digits($m[1]);
            return $this->intFrom($m[0], strlen($d) > 18 ? null : octdec($d === '' ? '0' : $d));
        }
        if ($this->matchAt('/\G0b([01](?:_?[01])*)/', $m)) {
            $d = $digits($m[1]);
            return $this->intFrom($m[0], strlen($d) > 53 ? null : bindec($d === '' ? '0' : $d));
        }
        if (!$this->matchAt('/\G[+-]?(?:0|[1-9](?:_?\d)*)(\.\d(?:_?\d)*)?([eE][+-]?\d(?:_?\d)*)?/', $m)) $this->fail();
        $text = str_replace('_', '', $m[0]);
        $this->i += strlen($m[0]);
        if (($m[1] ?? '') === '' && ($m[2] ?? '') === '') {
            $digits = ltrim($text, '+-');
            // Wie Node: nicht verlustfrei als JavaScript-Zahl darstellbar ist ungueltig.
            if (strlen($digits) > 16 || (int)$digits > 9007199254740991) $this->fail();
            $v = (int)$digits;
            return $text[0] === '-' ? -$v : $v;
        }
        $f = (float)$text;
        if (is_infinite($f) || is_nan($f)) return null;
        // Ganzzahlige Gleitkommawerte schreibt Node ohne .0, json_encode ebenso; -0.0 ergibt in Node 0.
        return $f == 0.0 ? 0 : $f;
    }

    private function intFrom(string $raw, $value) {
        $this->i += strlen($raw);
        if (!is_int($value) || $value > 9007199254740991) $this->fail();
        return $value;
    }
}

// Ungueltiges UTF-8 wie Buffer.toString('utf8') in Node durch U+FFFD ersetzen, statt die Datei abzulehnen.
function skm_utf8_scrub(string $s): string {
    if (preg_match('//u', $s)) return $s;
    if (function_exists('mb_scrub')) {
        $prev = mb_substitute_character();
        mb_substitute_character(0xFFFD);
        $out = mb_scrub($s, 'UTF-8');
        mb_substitute_character($prev);
        return $out;
    }
    // Ohne mbstring: gueltige Folgen behalten; der laengste gueltige Anfang einer abgebrochenen Folge oder ein
    // einzelnes ungueltiges Byte wird je ein U+FFFD, wie Buffer.toString('utf8') in Node (Review-Hinweis: vorher
    // wurden auch gueltige Umlaute ersetzt). Gruppe 1 = ersetzen.
    $valid = '/[\x00-\x7F]|[\xC2-\xDF][\x80-\xBF]|\xE0[\xA0-\xBF][\x80-\xBF]|[\xE1-\xEC\xEE\xEF][\x80-\xBF]{2}'
        . '|\xED[\x80-\x9F][\x80-\xBF]|\xF0[\x90-\xBF][\x80-\xBF]{2}|[\xF1-\xF3][\x80-\xBF]{3}|\xF4[\x80-\x8F][\x80-\xBF]{2}'
        . '|(\xE0[\xA0-\xBF]|[\xE1-\xEC\xEE\xEF][\x80-\xBF]|\xED[\x80-\x9F]|\xF0[\x90-\xBF][\x80-\xBF]?'
        . '|[\xF1-\xF3][\x80-\xBF]{1,2}|\xF4[\x80-\x8F][\x80-\xBF]?|[\x80-\xFF])/s';
    return (string)preg_replace_callback($valid, fn($m) => isset($m[1]) ? "\u{FFFD}" : $m[0], $s);
}

function skm_days_in_month(int $y, int $mo): int {
    if ($mo === 2) return ($y % 4 === 0 && ($y % 100 !== 0 || $y % 400 === 0)) ? 29 : 28;
    return in_array($mo, [4, 6, 9, 11], true) ? 30 : 31;
}

function mb_chr_compat(int $cp): string {
    if (function_exists('mb_chr')) return (string)mb_chr($cp, 'UTF-8');
    return (string)iconv('UTF-32BE', 'UTF-8', pack('N', $cp));
}

/** Ganze stellar.toml (Tabellen als stdClass). RuntimeException 'toml_invalid_format' bei jedem Fehler in der Datei. */
function skm_toml_parse(string $text): stdClass {
    return (new SkmTomlParser($text))->parse();
}

function skm_toml_lower_key(string $k): string {
    return function_exists('mb_strtolower') ? mb_strtolower($k, 'UTF-8') : strtolower($k);
}

/**
 * Eintraege fuer JSON: jeder Eintrag als Objekt wie in Node, auch leer oder mit Keys "0", "1" (als Array waere
 * das sonst [...] statt {...}, Review ST-7). Innere Tabellen sind schon Objekte (skm_toml_plain_item).
 */
function skm_currencies_for_json(array $currencies): array {
    return array_map(fn($c) => (object)$c, $currencies);
}

/** Eintrag gehoert zu genau diesem Asset (Text-Werte, Schreibweise zaehlt). Gleich wie currencyMatches in Node. */
function skm_currency_matches($currency, array $asset): bool {
    return is_array($currency)
        && is_string($currency['code'] ?? null) && $currency['code'] === $asset['code']
        && is_string($currency['issuer'] ?? null) && $currency['issuer'] === $asset['issuer'];
}

/**
 * Eintraege aus allen Top-Level-Keys, die ohne Gross-/Kleinschreibung "currencies" heissen, in der Reihenfolge
 * ihres ersten Auftretens (wie Object.keys in Node). Ein Array (auch [[...]]) liefert seine Elemente, eine
 * Tabelle sich selbst; nur Tabellen zaehlen als Eintrag, ihre Keys werden kleingeschrieben (spaeterer Key
 * gewinnt bei Gleichheit, wie in Node). Ein Eintrag ist ein Array (Zugriff $c['code']), fuer JSON
 * skm_currencies_for_json. Gleich wie parseCurrencySectionsFromToml in services/tradeService.js.
 */
function parse_currency_sections_from_toml(string $tomlText, int $maxDepth = SKM_TOML_MAX_DEPTH, int $maxStructureDepth = SKM_TOML_MAX_STRUCTURE_DEPTH,
        int $maxNodes = SKM_TOML_MAX_NODES, int $maxKeysPerTable = SKM_TOML_MAX_KEYS_PER_TABLE): array {
    $root = (new SkmTomlParser($tomlText, $maxDepth, $maxStructureDepth, $maxNodes, $maxKeysPerTable))->parseRaw();
    $currencies = [];
    foreach ($root->items as $key => $node) {
        if (skm_toml_lower_key((string)$key) !== 'currencies') continue;
        $list = $node instanceof SkmTomlArrayOfTables ? $node->tables : (is_array($node) ? $node : [$node]);
        foreach ($list as $entry) {
            if (!($entry instanceof SkmTomlTable)) continue;
            $normalized = [];
            foreach ($entry->items as $k => $item) $normalized[skm_toml_lower_key((string)$k)] = skm_toml_plain_item($item);
            $currencies[] = $normalized;
        }
    }
    return $currencies;
}

/**
 * SkmTomlTable rekursiv als stdClass (JSON {} wie in Node, auch leer oder mit Keys "0", "1"), Arrays als Listen;
 * ganzzahlige Gleitkommawerte als int wie in JSON von Node.
 */
function skm_toml_plain_item($v) {
    if ($v instanceof SkmTomlTable) {
        $out = [];
        foreach ($v->items as $k => $item) $out[(string)$k] = skm_toml_plain_item($item);
        return (object)$out;
    }
    if ($v instanceof SkmTomlArrayOfTables) return array_map('skm_toml_plain_item', $v->tables);
    if (is_array($v)) return array_map('skm_toml_plain_item', $v);
    if (is_float($v) && floor($v) === $v && abs($v) <= 9007199254740991) return (int)$v;
    return $v;
}
