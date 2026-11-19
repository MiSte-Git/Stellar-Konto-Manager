<?php
// Strenge Pruefung eines SVG-Logos fuer den Logo-Proxy (api/assetLogo.php). Gegenstueck zu services/svgLogo.js,
// gemeinsame Faelle in test/assets/asset-logo.json (svgCases).
//
// Kein XML-Parser (kein DOMDocument/simplexml, keine Entities, keine externen Ressourcen), sondern ein einfacher
// Tag-Scanner in einem Durchlauf ohne Rekursion, auf den Bytes. Jede Entscheidung haengt nur an ASCII-Zeichen,
// Gross-/Kleinschreibung nur fuer ASCII (strtr statt strtolower, das in PHP 8.1 noch vom Locale abhing).
//
// Ergebnis: 'ok', 'unsupportedType', 'invalidImage' (SVG, aber kein gueltiges UTF-8) oder 'unsafeSvg'. Regeln wie
// SVG_RULES in Node, fuer die Gegenprobe in den Tests einzeln abschaltbar ($disabledRules); im Betrieb nie.
declare(strict_types=1);

// pattern bewusst nicht (Review F-2), Begruendung in services/svgLogo.js.
const SKM_SVG_ELEMENTS = [
    'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'style', 'text', 'tspan',
];

// Verweis-Container und Grenzen wie in Node (Review F-2).
const SKM_SVG_REF_CONTAINERS = ['mask', 'clippath', 'symbol'];
const SKM_SVG_MAX_USE = 8;
const SKM_SVG_MAX_MASK_CLIP = 64;
const SKM_SVG_URL_ATTRS = ['fill', 'stroke', 'mask', 'clip-path', 'style'];

const SKM_SVG_RULES = [
    'utf8', 'control', 'prolog', 'markup', 'comment', 'elementAllowlist', 'elementName', 'attrSyntax', 'eventAttr',
    'href', 'entity', 'scheme', 'cssImport', 'cssExpression', 'cssUrl', 'cssFunctions', 'cssBackslash', 'cssComment',
    'cssRefs', 'refNesting', 'refCount', 'styleChildren', 'closeMatch', 'unclosed', 'epilog',
];

const SKM_SVG_CSS_FUNCTIONS = ['image-set(', 'image(', 'src(', 'cross-fade(', 'element('];
const SKM_SVG_SCHEMES = ['javascript:', 'vbscript:', 'data:'];

function skm_svg_lower(string $t): string {
    return strtr($t, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
}

// Inhalt der XML-Deklaration: nur einfache Zeichen; eine Angabe encoding nur als UTF-8 (wie declOk in Node).
function skm_svg_decl_ok(string $content): bool {
    if (!preg_match('/^[A-Za-z0-9 \t\r\n=.\'"_-]*$/D', $content)) return false;
    $t = str_replace([' ', "\t", "\r", "\n"], '', skm_svg_lower($content));
    if (strpos($t, 'encoding=') === false) return true;
    return strpos($t, 'encoding="utf-8"') !== false || strpos($t, "encoding='utf-8'") !== false;
}

function skm_svg_is_ws(string $c): bool {
    return $c === ' ' || $c === "\t" || $c === "\n" || $c === "\r";
}

/** Treffer eines Musters genau an Position $i, sonst null. preg-Fehler: fail-closed ueber den Aufrufer. */
function skm_svg_match_at(string $re, string $s, int $i): ?string {
    $r = preg_match($re, $s, $m, 0, $i);
    if ($r === false) throw new RuntimeException('svg_regex');
    return $r === 1 ? $m[0] : null;
}

final class SkmSvgCheck {
    private string $s;
    private int $n;
    private array $off;
    private int $refDepth = 0;
    private int $useCount = 0;
    private int $maskClipCount = 0;

    public function __construct(string $bytes, array $disabledRules) {
        $this->s = $bytes;
        $this->n = strlen($bytes);
        $this->off = array_fill_keys($disabledRules, true);
    }

    private function on(string $rule): bool {
        return !isset($this->off[$rule]);
    }

    private function entitiesOk(string $text): bool {
        if (!$this->on('entity')) return true;
        for ($k = strpos($text, '&'); $k !== false; $k = strpos($text, '&', $k + 1)) {
            if (($text[$k + 1] ?? '') === '#') return false;
            if (skm_svg_match_at('/\G&(?:amp|lt|gt|quot|apos);/', $text, $k) === null) return false;
        }
        return true;
    }

    private static function squash(string $text): string {
        return str_replace([' ', "\t", "\r", "\n"], '', skm_svg_lower($text));
    }

    // CSS in style-Inhalt und style-Attribut: url( nur direkt nach fill: oder stroke:, kein var( (Review F-2).
    private function cssRefsOk(string $text): bool {
        if (!$this->on('cssRefs')) return true;
        $t = self::squash($text);
        if (strpos($t, 'var(') !== false) return false;
        for ($k = strpos($t, 'url('); $k !== false; $k = strpos($t, 'url(', $k + 4)) {
            $head = substr($t, 0, $k);
            $a = strrpos($head, '{');
            $b = strrpos($head, ';');
            $from = max($a === false ? -1 : $a, $b === false ? -1 : $b) + 1;
            $prop = substr($t, $from, $k - $from);
            if ($prop !== 'fill:' && $prop !== 'stroke:') return false;
        }
        return true;
    }

    private function cssOk(string $text): bool {
        $t = self::squash($text);
        // Kein CSS-Kommentar (Review F-1): der Browser liest /* in einem String oder / * nicht als Kommentar.
        if ($this->on('cssComment') && strpos($t, '/*') !== false) return false;
        if ($this->on('cssBackslash') && strpos($t, '\\') !== false) return false;
        if ($this->on('scheme')) foreach (SKM_SVG_SCHEMES as $x) if (strpos($t, $x) !== false) return false;
        if ($this->on('cssImport') && strpos($t, '@import') !== false) return false;
        if ($this->on('cssExpression') && strpos($t, 'expression(') !== false) return false;
        if ($this->on('cssFunctions')) foreach (SKM_SVG_CSS_FUNCTIONS as $x) if (strpos($t, $x) !== false) return false;
        if ($this->on('cssUrl')) {
            for ($k = strpos($t, 'url('); $k !== false; $k = strpos($t, 'url(', $k + 4)) {
                $p = $k + 4;
                if (($t[$p] ?? '') === '"' || ($t[$p] ?? '') === "'") $p++;
                if (($t[$p] ?? '') !== '#') return false;
            }
        }
        return true;
    }

    // Kommentar ab $i (dort steht <!--). Index nach -->, oder -1 (ungueltig).
    private function skipComment(int $i): int {
        $end = strpos($this->s, '-->', $i + 4);
        if ($end === false) return $this->on('comment') ? -1 : $this->n;
        if ($this->on('comment') && strpos(substr($this->s, $i + 4, $end - $i - 4), '--') !== false) return -1;
        return $end + 3;
    }

    private function startsWith(string $t, int $i): bool {
        return substr_compare($this->s, $t, $i, strlen($t)) === 0;
    }

    private function ch(int $i): string {
        return $i < $this->n ? $this->s[$i] : '';
    }

    public function run(): string {
        $s = $this->s;
        $n = $this->n;
        $unsafe = 'unsafeSvg';

        // Vorspann: BOM, Leerraum, eine XML-Deklaration ganz am Anfang, dann Leerraum und Kommentare.
        $i = strncmp($s, "\xEF\xBB\xBF", 3) === 0 ? 3 : 0;
        $prologOk = true;
        $first = true;
        while (true) {
            while ($i < $n && skm_svg_is_ws($s[$i])) $i++;
            if ($first && $this->startsWith('<?xml', $i) && skm_svg_is_ws($this->ch($i + 5))) {
                $end = strpos($s, '?>', $i + 5);
                if ($end === false || !skm_svg_decl_ok(substr($s, $i + 5, $end - $i - 5))) {
                    $prologOk = false;
                    break;
                }
                $i = $end + 2;
                $first = false;
                continue;
            }
            $first = false;
            if ($this->startsWith('<!--', $i)) {
                $next = $this->skipComment($i);
                if ($next < 0) { $prologOk = false; break; }
                $i = $next;
                continue;
            }
            break;
        }
        $rootHere = $prologOk && skm_svg_lower(substr($s, $i, 4)) === '<svg' && preg_match('/^[ \t\r\n\/>]$/', $this->ch($i + 4)) === 1;
        $utf8Ok = fn() => preg_match('//u', $s) === 1;
        if (!$rootHere) {
            if (!preg_match('/<svg[ \t\r\n\/>]/i', $s, $m, PREG_OFFSET_CAPTURE)) return 'unsupportedType';
            if ($this->on('utf8') && !$utf8Ok()) return 'invalidImage';
            if ($this->on('prolog')) return $unsafe;
            $i = $m[0][1];
        } elseif ($this->on('utf8') && !$utf8Ok()) {
            return 'invalidImage';
        }
        if ($this->on('control') && preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $s)) return $unsafe;

        $stack = [];
        $rootClosed = false;
        while ($i < $n) {
            $top = $stack ? $stack[count($stack) - 1] : null;
            if ($s[$i] !== '<') {
                $k = strpos($s, '<', $i);
                if ($k === false) $k = $n;
                $text = substr($s, $i, $k - $i);
                if ($rootClosed) {
                    if ($this->on('epilog') && !preg_match('/^[ \t\r\n]*$/', $text)) return $unsafe;
                } else {
                    if (!$this->entitiesOk($text)) return $unsafe;
                    if ($top === 'style' && (!$this->cssOk($text) || !$this->cssRefsOk($text))) return $unsafe;
                }
                $i = $k;
                continue;
            }
            if ($this->startsWith('<!--', $i)) {
                if ($top === 'style' && $this->on('styleChildren')) return $unsafe;
                $next = $this->skipComment($i);
                if ($next < 0) return $unsafe;
                $i = $next;
                continue;
            }
            $c1 = $this->ch($i + 1);
            if ($c1 === '!' || $c1 === '?') {
                if ($this->on('markup')) return $unsafe;
                $closer = $this->startsWith('<![CDATA[', $i) ? ']]>' : ($c1 === '?' ? '?>' : '>');
                $end = strpos($s, $closer, $i + 2);
                if ($end === false) return $unsafe;
                $i = $end + strlen($closer);
                continue;
            }
            if ($rootClosed) {
                if ($this->on('epilog')) return $unsafe;
                break;
            }
            if ($top === 'style' && $c1 !== '/' && $this->on('styleChildren')) return $unsafe;
            if ($c1 === '/') {
                // Schliessender Tag.
                $j = $i + 2;
                $name = skm_svg_match_at('/\G[A-Za-z_][A-Za-z0-9._:-]*/', $s, $j);
                if ($name === null) return $unsafe;
                $j += strlen($name);
                while ($j < $n && skm_svg_is_ws($s[$j])) $j++;
                if ($this->ch($j) !== '>') return $unsafe;
                if (!$stack) return $unsafe;
                if ($this->on('closeMatch') && $top !== skm_svg_lower($name)) return $unsafe;
                if (in_array(array_pop($stack), SKM_SVG_REF_CONTAINERS, true)) $this->refDepth--;
                if (!$stack) $rootClosed = true;
                $i = $j + 1;
                continue;
            }
            // Start-Tag.
            $j = $i + 1;
            $name = skm_svg_match_at('/\G[A-Za-z_][A-Za-z0-9._:-]*/', $s, $j);
            if ($name === null) return $unsafe;
            $j += strlen($name);
            $lname = skm_svg_lower($name);
            if (strpos($lname, ':') !== false) {
                if ($this->on('elementName')) return $unsafe;
                $lname = substr($lname, strrpos($lname, ':') + 1);
            }
            if ($this->on('elementAllowlist') && !in_array($lname, SKM_SVG_ELEMENTS, true)) return $unsafe;
            if ($lname === 'use') {
                $this->useCount++;
                if ($this->on('refCount') && $this->useCount > SKM_SVG_MAX_USE) return $unsafe;
                if ($this->on('refNesting') && $this->refDepth > 0) return $unsafe;
            }
            $seen = [];
            $selfClose = false;
            while (true) {
                $hadWs = $j < $n && skm_svg_is_ws($s[$j]);
                while ($j < $n && skm_svg_is_ws($s[$j])) $j++;
                if ($j >= $n) return $unsafe; // Tag nicht geschlossen
                if ($this->startsWith('/>', $j)) { $selfClose = true; $j += 2; break; }
                if ($s[$j] === '>') { $j++; break; }
                if (!$hadWs && $this->on('attrSyntax')) return $unsafe;
                // Name mit hoechstens einem Praefix (Review F-3).
                $attr = skm_svg_match_at('/\G[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/', $s, $j);
                if ($attr === null) return $unsafe;
                $j += strlen($attr);
                while ($j < $n && skm_svg_is_ws($s[$j])) $j++;
                $value = '';
                if ($this->ch($j) !== '=') {
                    if ($this->on('attrSyntax')) return $unsafe;
                } else {
                    $j++;
                    while ($j < $n && skm_svg_is_ws($s[$j])) $j++;
                    $q = $this->ch($j);
                    if ($q === '"' || $q === "'") {
                        $end = strpos($s, $q, $j + 1);
                        if ($end === false) return $unsafe;
                        $value = substr($s, $j + 1, $end - $j - 1);
                        $j = $end + 1;
                    } else {
                        if ($this->on('attrSyntax')) return $unsafe;
                        $k = $j;
                        while ($k < $n && !skm_svg_is_ws($s[$k]) && $s[$k] !== '>' && !$this->startsWith('/>', $k)) $k++;
                        $value = substr($s, $j, $k - $j);
                        $j = $k;
                    }
                }
                $lattr = skm_svg_lower($attr);
                if ($this->on('attrSyntax') && (isset($seen[$lattr]) || strpos($value, '<') !== false)) return $unsafe;
                $seen[$lattr] = true;
                $local = ($p = strrpos($lattr, ':')) === false ? $lattr : substr($lattr, $p + 1);
                // on... auch hinter einem Praefix (x:onclick): wirkt dort zwar nicht, im Zweifel aber ablehnen.
                if ($this->on('eventAttr') && (strncmp($lattr, 'on', 2) === 0 || strncmp($local, 'on', 2) === 0)) return $unsafe;
                if ($this->on('href') && $local === 'href' && ($value[0] ?? '') !== '#') return $unsafe;
                if (!$this->entitiesOk($value) || !$this->cssOk($value)) return $unsafe;
                if ($lattr === 'style' && !$this->cssRefsOk($value)) return $unsafe;
                if (strpos(self::squash($value), 'url(') !== false) {
                    if ($this->on('cssRefs') && !in_array($lattr, SKM_SVG_URL_ATTRS, true)) return $unsafe;
                    if ($lattr === 'mask' || $lattr === 'clip-path') {
                        $this->maskClipCount++;
                        if ($this->on('refCount') && $this->maskClipCount > SKM_SVG_MAX_MASK_CLIP) return $unsafe;
                    }
                    if ($this->on('refNesting') && $this->refDepth > 0 && !in_array($lattr, ['fill', 'stroke', 'style'], true)) return $unsafe;
                }
            }
            if ($selfClose) {
                if (!$stack) $rootClosed = true;
            } else {
                $stack[] = $lname;
                if (in_array($lname, SKM_SVG_REF_CONTAINERS, true)) $this->refDepth++;
            }
            $i = $j;
        }
        if ($this->on('unclosed') && !$rootClosed) return $unsafe;
        return 'ok';
    }
}

/** Prueft ein SVG (hoechstens ASSET_LOGO_MAX_BYTES, das prueft der Aufrufer). $disabledRules nur fuer Tests. */
function skm_check_svg_logo(string $bytes, array $disabledRules = []): string {
    try {
        return (new SkmSvgCheck($bytes, $disabledRules))->run();
    } catch (RuntimeException $e) {
        return 'unsafeSvg'; // preg-Fehler: fail-closed
    }
}
