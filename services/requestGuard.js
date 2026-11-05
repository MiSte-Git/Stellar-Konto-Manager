// Schutz aendernder Admin-Requests gegen CSRF (Review Runde 2, Befund G4).
//
// Bisher schuetzte allein SameSite=Lax am Admin-Session-Cookie. Eine Seite auf
// derselben Site bekommt das Cookie aber mitgeschickt. Darum gilt fuer Login,
// Logout und Bugreport-Update:
// - Origin muss vorhanden sein und exakt in ALLOWED_APP_ORIGINS stehen
//   (dieselbe Allowlist wie CORS, keine zweite Liste), sonst 403 forbidden_origin.
// - Requests mit Body brauchen Content-Type application/json (Parameter wie
//   charset erlaubt, Gross-/Kleinschreibung egal), sonst 415 unsupported_media_type.
// PHP-Pendant: api/requestGuard.php.
const { ALLOWED_APP_ORIGINS } = require('./corsConfig.js');

function isAllowedOrigin(origin) {
  return typeof origin === 'string' && origin !== '' && ALLOWED_APP_ORIGINS.has(origin);
}

function isJsonContentType(contentType) {
  if (typeof contentType !== 'string') return false;
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function requireAllowedOrigin(req, res, next) {
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  }
  return next();
}

function requireJsonContentType(req, res, next) {
  if (!isJsonContentType(req.headers['content-type'])) {
    return res.status(415).json({ ok: false, error: 'unsupported_media_type' });
  }
  return next();
}

module.exports = { isAllowedOrigin, isJsonContentType, requireAllowedOrigin, requireJsonContentType };
