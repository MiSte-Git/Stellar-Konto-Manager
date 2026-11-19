// Strenge Pruefung eines SVG-Logos fuer den Logo-Proxy (services/assetLogo.js). Gegenstueck zu api/svgLogo.php,
// gemeinsame Faelle in test/assets/asset-logo.json (svgCases).
//
// Kein XML-Parser (keine Entities, keine externen Ressourcen), sondern ein einfacher Tag-Scanner in einem Durchlauf
// ohne Rekursion. Er arbeitet auf den Bytes (als latin1 gelesen, ein Zeichen je Byte, wie PHP auf dem Byte-String);
// jede Entscheidung haengt nur an ASCII-Zeichen, Gross-/Kleinschreibung nur fuer ASCII. Im Zweifel ablehnen.
//
// Ergebnis: 'ok', 'unsupportedType' (sieht nicht nach SVG aus), 'invalidImage' (SVG, aber kein gueltiges UTF-8)
// oder 'unsafeSvg'. Jede Regel hat einen Namen (SVG_RULES) und laesst sich fuer die Gegenprobe in den Tests
// einzeln abschalten (disabledRules); im Betrieb ist nie eine abgeschaltet.

// pattern bewusst nicht (Review F-2): ein schweres pattern als fill vieler Elemente (per Klasse) blockierte
// Chromium im <img> 6 bis 16 s. Gradienten sind billig und bleiben.
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'style', 'text', 'tspan',
]);

// Verweis-Container (Review F-2): darin keine weiteren Verweise, sonst wachsen Ketten exponentiell.
const REF_CONTAINERS = new Set(['mask', 'clippath', 'symbol']);
const MAX_USE = 8;
const MAX_MASK_CLIP = 64;
// Attribute, deren Wert url( enthalten darf (ausserhalb der Container); in Containern nur fill, stroke, style.
const URL_ATTRS = new Set(['fill', 'stroke', 'mask', 'clip-path', 'style']);

const SVG_RULES = Object.freeze([
  'utf8', // nur gueltiges UTF-8
  'control', // keine Steuerzeichen ausser Tab, LF, CR
  'prolog', // Wurzel svg direkt nach BOM, Leerraum, einer XML-Deklaration und Kommentaren
  'markup', // kein DOCTYPE, ENTITY, CDATA, keine Processing Instruction
  'comment', // Kommentare sauber geschlossen, ohne -- im Inhalt
  'elementAllowlist', // nur Elemente der Erlaubtliste
  'elementName', // Elementname ohne Namespace-Praefix
  'attrSyntax', // Werte in Anfuehrungszeichen, Leerraum zwischen Attributen, kein < im Wert, kein Attribut doppelt
  'eventAttr', // kein Attribut, das mit on beginnt
  'href', // href (auch mit Praefix) nur mit Wert, der mit # beginnt
  'entity', // nur &amp; &lt; &gt; &quot; &apos;, keine Zeichenreferenz &#
  'scheme', // kein javascript:, vbscript:, data:
  'cssImport', // kein @import
  'cssExpression', // kein expression(
  'cssUrl', // url( nur mit Ziel, das mit # beginnt
  'cssFunctions', // keine CSS-Funktionen, die fremde Bilder laden (image-set(, image(, src(, cross-fade(, element()
  'cssBackslash', // kein Backslash (CSS-Escapes koennten die Pruefungen umgehen)
  'cssComment', // kein CSS-Kommentar (/* auch mit Leerraum dazwischen); entfernen ging nicht, weil der Browser
  // /* in einem CSS-String oder / * nicht als Kommentar liest (Review F-1)
  'cssRefs', // url( in CSS nur direkt nach fill: oder stroke:, kein var(; als Attribut nur in fill, stroke, mask,
  // clip-path und style (Review F-2)
  'refNesting', // in mask, clipPath, symbol kein use, kein mask/clip-path, kein url( ausser fill/stroke (Review F-2)
  'refCount', // hoechstens 8 use und 64 mask/clip-path mit url( in der Datei (Review F-2)
  'styleChildren', // style enthaelt nur Text
  'closeMatch', // schliessender Tag passt zum offenen
  'unclosed', // am Ende kein Element mehr offen
  'epilog', // nach dem schliessenden svg nur Leerraum und Kommentare
]);

const CSS_FUNCTIONS = ['image-set(', 'image(', 'src(', 'cross-fade(', 'element('];
const SCHEMES = ['javascript:', 'vbscript:', 'data:'];
const NAME_RE = /[A-Za-z_][A-Za-z0-9._:-]*/y;
// Name mit hoechstens einem Praefix (Review F-3: href:= oder :href= rutschten an der href-Regel vorbei).
const ATTR_NAME_RE = /[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/y;
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/y;
const ROOT_SEARCH_RE = /<svg[ \t\r\n/>]/i;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/; // eslint-disable-line no-control-regex
const DECL_CONTENT_RE = /^[A-Za-z0-9 \t\r\n=.'"_-]*$/;

// Inhalt der XML-Deklaration: nur einfache Zeichen; eine Angabe encoding nur als UTF-8, damit niemand die Bytes
// anders deutet, als sie geprueft wurden.
function declOk(content) {
  if (!DECL_CONTENT_RE.test(content)) return false;
  const t = lowerAscii(content).replace(/[ \t\r\n]/g, '');
  if (!t.includes('encoding=')) return true;
  return t.includes('encoding="utf-8"') || t.includes("encoding='utf-8'");
}

const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const lowerAscii = (t) => t.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

function matchAt(re, s, i) {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? m[0] : null;
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prueft ein SVG. bytes: Buffer (hoechstens MAX_BYTES, das prueft der Aufrufer). disabledRules nur fuer Tests.
 */
function checkSvgLogo(bytes, disabledRules = []) {
  const off = new Set(disabledRules);
  const on = (rule) => !off.has(rule);
  const s = Buffer.from(bytes).toString('latin1');
  const n = s.length;
  const UNSAFE = 'unsafeSvg';

  // Entities: nur die fuenf vordefinierten, keine Zeichenreferenz.
  const entitiesOk = (text) => {
    if (!on('entity')) return true;
    for (let k = text.indexOf('&'); k >= 0; k = text.indexOf('&', k + 1)) {
      if (text[k + 1] === '#') return false;
      if (matchAt(ENTITY_RE, text, k) === null) return false;
    }
    return true;
  };

  // CSS- und URL-Pruefung fuer jeden Attributwert und jeden style-Inhalt: ASCII-klein, ohne ASCII-Leerraum,
  // ohne CSS-Kommentare.
  const squash = (text) => lowerAscii(text).replace(/[ \t\r\n]/g, '');
  const cssOk = (text) => {
    const t = squash(text);
    if (on('cssComment') && t.includes('/*')) return false;
    if (on('cssBackslash') && t.includes('\\')) return false;
    if (on('scheme') && SCHEMES.some((x) => t.includes(x))) return false;
    if (on('cssImport') && t.includes('@import')) return false;
    if (on('cssExpression') && t.includes('expression(')) return false;
    if (on('cssFunctions') && CSS_FUNCTIONS.some((x) => t.includes(x))) return false;
    if (on('cssUrl')) {
      for (let k = t.indexOf('url('); k >= 0; k = t.indexOf('url(', k + 4)) {
        let p = k + 4;
        if (t[p] === '"' || t[p] === "'") p += 1;
        if (t[p] !== '#') return false;
      }
    }
    return true;
  };

  // CSS in style-Inhalt und style-Attribut: url( nur direkt nach fill: oder stroke:, kein var( (Review F-2).
  const cssRefsOk = (text) => {
    if (!on('cssRefs')) return true;
    const t = squash(text);
    if (t.includes('var(')) return false;
    for (let k = t.indexOf('url('); k >= 0; k = t.indexOf('url(', k + 4)) {
      // Ganze Eigenschaft vor url(: ab dem letzten { oder ; (oder dem Anfang), also nicht xfill: oder -webkit-...fill:.
      const prop = t.slice(Math.max(t.lastIndexOf('{', k), t.lastIndexOf(';', k)) + 1, k);
      if (prop !== 'fill:' && prop !== 'stroke:') return false;
    }
    return true;
  };
  let refDepth = 0;
  let useCount = 0;
  let maskClipCount = 0;

  // Kommentar ab i (s beginnt dort mit <!--). Ergebnis: Index nach -->, oder -1 (ungueltig).
  const skipComment = (i) => {
    const end = s.indexOf('-->', i + 4);
    if (end < 0) return on('comment') ? -1 : n;
    if (on('comment') && s.slice(i + 4, end).includes('--')) return -1;
    return end + 3;
  };

  // Vorspann: BOM, Leerraum, eine XML-Deklaration ganz am Anfang, dann Leerraum und Kommentare.
  let i = s.startsWith('\xEF\xBB\xBF') ? 3 : 0;
  let prologOk = true;
  let first = true;
  for (;;) {
    while (i < n && isWs(s[i])) i += 1;
    if (first && s.startsWith('<?xml', i) && isWs(s[i + 5] || '')) {
      const end = s.indexOf('?>', i + 5);
      if (end < 0 || !declOk(s.slice(i + 5, end))) { prologOk = false; break; }
      i = end + 2;
      first = false;
      continue;
    }
    first = false;
    if (s.startsWith('<!--', i)) {
      const next = skipComment(i);
      if (next < 0) { prologOk = false; break; }
      i = next;
      continue;
    }
    break;
  }
  const rootHere = prologOk && lowerAscii(s.slice(i, i + 4)) === '<svg' && /[ \t\r\n/>]/.test(s[i + 4] || '');
  if (!rootHere) {
    const found = s.search(ROOT_SEARCH_RE);
    if (found < 0) return 'unsupportedType';
    if (on('utf8') && !isValidUtf8(bytes)) return 'invalidImage';
    if (on('prolog')) return UNSAFE;
    i = found;
  } else if (on('utf8') && !isValidUtf8(bytes)) {
    return 'invalidImage';
  }
  if (on('control') && CONTROL_RE.test(s)) return UNSAFE;

  const stack = [];
  let rootClosed = false;
  while (i < n) {
    if (s[i] !== '<') {
      // Text bis zum naechsten Tag.
      let k = s.indexOf('<', i);
      if (k < 0) k = n;
      const text = s.slice(i, k);
      if (rootClosed) {
        if (on('epilog') && !/^[ \t\r\n]*$/.test(text)) return UNSAFE;
      } else {
        if (!entitiesOk(text)) return UNSAFE;
        if (stack[stack.length - 1] === 'style' && (!cssOk(text) || !cssRefsOk(text))) return UNSAFE;
      }
      i = k;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      if (stack[stack.length - 1] === 'style' && on('styleChildren')) return UNSAFE;
      const next = skipComment(i);
      if (next < 0) return UNSAFE;
      i = next;
      continue;
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      if (on('markup')) return UNSAFE;
      const cdata = s.startsWith('<![CDATA[', i);
      const closer = cdata ? ']]>' : (s[i + 1] === '?' ? '?>' : '>');
      const end = s.indexOf(closer, i + 2);
      if (end < 0) return UNSAFE;
      i = end + closer.length;
      continue;
    }
    if (rootClosed) {
      if (on('epilog')) return UNSAFE;
      break;
    }
    if (stack[stack.length - 1] === 'style' && s[i + 1] !== '/' && on('styleChildren')) return UNSAFE;
    if (s[i + 1] === '/') {
      // Schliessender Tag.
      let j = i + 2;
      const name = matchAt(NAME_RE, s, j);
      if (name === null) return UNSAFE;
      j += name.length;
      while (j < n && isWs(s[j])) j += 1;
      if (s[j] !== '>') return UNSAFE;
      if (!stack.length) return UNSAFE;
      if (on('closeMatch') && stack[stack.length - 1] !== lowerAscii(name)) return UNSAFE;
      if (REF_CONTAINERS.has(stack.pop())) refDepth -= 1;
      if (!stack.length) rootClosed = true;
      i = j + 1;
      continue;
    }
    // Start-Tag.
    let j = i + 1;
    const name = matchAt(NAME_RE, s, j);
    if (name === null) return UNSAFE;
    j += name.length;
    let lname = lowerAscii(name);
    if (lname.includes(':')) {
      if (on('elementName')) return UNSAFE;
      lname = lname.slice(lname.lastIndexOf(':') + 1);
    }
    if (on('elementAllowlist') && !SVG_ELEMENTS.has(lname)) return UNSAFE;
    if (lname === 'use') {
      useCount += 1;
      if (on('refCount') && useCount > MAX_USE) return UNSAFE;
      if (on('refNesting') && refDepth > 0) return UNSAFE;
    }
    const seen = new Set();
    let selfClose = false;
    for (;;) {
      const hadWs = j < n && isWs(s[j]);
      while (j < n && isWs(s[j])) j += 1;
      if (j >= n) return UNSAFE; // Tag nicht geschlossen
      if (s.startsWith('/>', j)) { selfClose = true; j += 2; break; }
      if (s[j] === '>') { j += 1; break; }
      if (!hadWs && on('attrSyntax')) return UNSAFE;
      const attr = matchAt(ATTR_NAME_RE, s, j);
      if (attr === null) return UNSAFE;
      j += attr.length;
      while (j < n && isWs(s[j])) j += 1;
      let value = '';
      if (s[j] !== '=') {
        if (on('attrSyntax')) return UNSAFE;
      } else {
        j += 1;
        while (j < n && isWs(s[j])) j += 1;
        const q = s[j];
        if (q === '"' || q === "'") {
          const end = s.indexOf(q, j + 1);
          if (end < 0) return UNSAFE;
          value = s.slice(j + 1, end);
          j = end + 1;
        } else {
          if (on('attrSyntax')) return UNSAFE;
          let k = j;
          while (k < n && !isWs(s[k]) && s[k] !== '>' && !s.startsWith('/>', k)) k += 1;
          value = s.slice(j, k);
          j = k;
        }
      }
      const lattr = lowerAscii(attr);
      if (on('attrSyntax') && (seen.has(lattr) || value.includes('<'))) return UNSAFE;
      seen.add(lattr);
      const local = lattr.slice(lattr.lastIndexOf(':') + 1);
      // on... auch hinter einem Praefix (x:onclick): wirkt dort zwar nicht, im Zweifel aber ablehnen.
      if (on('eventAttr') && (lattr.startsWith('on') || local.startsWith('on'))) return UNSAFE;
      if (on('href') && local === 'href' && value[0] !== '#') return UNSAFE;
      if (!entitiesOk(value) || !cssOk(value)) return UNSAFE;
      if (lattr === 'style' && !cssRefsOk(value)) return UNSAFE;
      if (squash(value).includes('url(')) {
        if (on('cssRefs') && !URL_ATTRS.has(lattr)) return UNSAFE;
        if (lattr === 'mask' || lattr === 'clip-path') {
          maskClipCount += 1;
          if (on('refCount') && maskClipCount > MAX_MASK_CLIP) return UNSAFE;
        }
        if (on('refNesting') && refDepth > 0 && lattr !== 'fill' && lattr !== 'stroke' && lattr !== 'style') return UNSAFE;
      }
    }
    if (selfClose) {
      if (!stack.length) rootClosed = true;
    } else {
      stack.push(lname);
      if (REF_CONTAINERS.has(lname)) refDepth += 1;
    }
    i = j;
  }
  if (on('unclosed') && !rootClosed) return UNSAFE;
  return 'ok';
}

module.exports = { checkSvgLogo, SVG_RULES, SVG_ELEMENTS, MAX_USE, MAX_MASK_CLIP };
