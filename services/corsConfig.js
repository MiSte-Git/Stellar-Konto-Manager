// Shared CORS origin allowlist for server.js (finding #9). Single source of
// truth for which frontend origins may call the backend cross-origin (was
// previously a wildcard '*' — finding B3), so the restricted route groups
// (multisig, admin+bugreport, global fallback) can't drift apart.
//
// G3: A request whose Origin header is not on the allowlist is rejected with
// 403 { ok: false, error: 'forbidden_origin' } (preflights included) instead of
// merely losing Access-Control-Allow-Origin and continuing to the handler.
// Requests without an Origin header (same-origin GET, scripts, monitoring) pass
// unchanged. PHP twin: api/cors.php (same fixed list, same normalization).

// Fest eingetragen, in beiden Backends gleich (api/cors.php).
const FIXED_APP_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://skm.steei.de',
]);

// Origin wie ein Browser ihn sendet: schema://host[:port], ohne Pfad, ohne
// Slash am Ende, Host in Kleinbuchstaben, Standardport weggelassen. Bewusst
// eigene Regex statt new URL(), damit api/cors.php (cors_normalize_origin)
// exakt dieselben Werte annimmt und ablehnt (URL wuerde z. B. Unicode-Hosts in
// Punycode umwandeln oder "https:host" ohne Slashes akzeptieren).
const ORIGIN_RE = /^(https?):\/\/([^/?#@\s]+)(?:[/?#].*)?$/i;
const HOST_RE = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/;

// G3-1: Trim wie PHP trim(): nur Leerzeichen, \t, \n, \r, NUL und \v. String.trim()
// entfernt zusaetzlich NBSP, BOM und weitere Unicode-Leerzeichen; ein PROD_ORIGIN mit
// BOM wurde so in Node akzeptiert und in PHP ignoriert. Gleiche Zeichenmenge in api/cors.php.
function trimAscii(value) {
  return value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const m = ORIGIN_RE.exec(trimAscii(value));
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  const pm = /^(.*?)(?::(\d{1,5}))?$/.exec(authority);
  const host = pm[1];
  if (!HOST_RE.test(host)) return null;
  let port = '';
  if (pm[2] !== undefined) {
    const n = Number(pm[2]);
    if (n < 1 || n > 65535) return null;
    const isDefault = (scheme === 'http' && n === 80) || (scheme === 'https' && n === 443);
    if (!isDefault) port = `:${n}`;
  }
  return `${scheme}://${host}${port}`;
}

// Baut die Allowlist aus festen Eintraegen, PROD_ORIGIN und (nur Node) der
// Origin aus PROD_API_URL. Ungueltige Werte werden ignoriert und laut geloggt.
// Die Liste entsteht einmal beim Laden des Moduls, das Log also einmal je Start.
function buildAllowedOrigins(env = process.env, log = console.error) {
  const origins = new Set(FIXED_APP_ORIGINS);
  const addFromEnv = (name) => {
    const raw = env[name];
    if (raw === undefined || trimAscii(String(raw)) === '') return;
    const origin = normalizeOrigin(String(raw));
    if (origin) {
      origins.add(origin);
    } else {
      log(`[cors] ${name} ist keine gueltige Origin und wird ignoriert: ${JSON.stringify(String(raw))}`);
    }
  };
  addFromEnv('PROD_ORIGIN');
  // Nur Node: PROD_API_URL ist die API-Adresse, gegen die das Frontend gebaut
  // wird (Frontend und API liegen auf demselben Host). PHP braucht das nicht,
  // dort steht skm.steei.de fest in der Liste und PROD_API_URL ist auf dem
  // Hosting nicht gesetzt (siehe api/cors.php).
  addFromEnv('PROD_API_URL');
  return origins;
}

const ALLOWED_APP_ORIGINS = buildAllowedOrigins();

/**
 * Builds an Express middleware that rejects requests from origins outside the
 * allowlist with 403 forbidden_origin (G3), sets Access-Control-Allow-Origin
 * (+ Vary, and Credentials if configured) for allowlisted origins, plus the
 * given methods/headers, and short-circuits OPTIONS preflights with 200.
 * Requests without an Origin header are passed through unchanged.
 */
function createCorsMiddleware({ methods, headers, credentials = false, allowedOrigins = ALLOWED_APP_ORIGINS }) {
  const methodsHeader = methods.join(',');
  const headersHeader = headers.join(', ');
  return function corsMiddleware(req, res, next) {
    // Mehrere CORS-Middlewares stehen hintereinander (Pfad-Gruppe, dann globaler
    // Fallback). Die erste, die einen Request behandelt, gilt: Die spaetere darf
    // weder Methods noch Headers (z. B. x-job-token) mit ihren engeren Werten
    // ueberschreiben. Wie PHP, wo jeder Endpunkt die Header genau einmal setzt.
    const locals = res.locals || (res.locals = {});
    if (locals.skmCorsHandled) return next();
    locals.skmCorsHandled = true;
    // Die Antwort haengt von Origin ab (erlaubt, abgewiesen, ohne): Caches muessen
    // sie je Origin getrennt halten, auch die 403 und Antworten ohne Origin.
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowedOrigins.has(origin)) {
        res.removeHeader('Access-Control-Allow-Origin');
        res.header('Cache-Control', 'no-store');
        return res.status(403).json({ ok: false, error: 'forbidden_origin' });
      }
      res.header('Access-Control-Allow-Origin', origin);
      if (credentials) res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Headers', headersHeader);
    res.header('Access-Control-Allow-Methods', methodsHeader);
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  };
}

module.exports = { ALLOWED_APP_ORIGINS, FIXED_APP_ORIGINS, normalizeOrigin, buildAllowedOrigins, createCorsMiddleware };
