/**
 * Redaction for diagnostic logging.
 *
 * Verbose logging must never print credentials or other sensitive request
 * fields. This module is intentionally conservative: it redacts by key name
 * at any nesting depth, plus PEM private keys and Basic/Bearer tokens found
 * in arbitrary strings.
 *
 * Note: key-based redaction cannot catch a secret echoed inside free-form
 * text under an unrecognised key. Callers should treat verbose logs as
 * best-effort redacted, not guaranteed clean.
 */

const SENSITIVE_KEYS = new Set([
  'authorization',
  'apikey',
  'apisecret',
  'clientsecret',
  'email',
  'emailaddress',
  'mobile',
  'password',
  'passwd',
  'phonenumber',
  'phone',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretkey',
  'token',
  'accesstoken',
]);

const PEM_BEGIN = '-----BEGIN ';
const PEM_END = '-----END ';
const PEM_SUFFIX = 'PRIVATE KEY';

const AUTH_TOKEN = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}/gi;

const CIRCULAR = '[Circular]';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * Replace PEM private-key blocks with a placeholder.
 *
 * Implemented as a forward scan rather than a regex: a global regex with a
 * lazy block body rescans to the end from every "-----BEGIN" marker, which is
 * quadratic on hostile input (many BEGIN markers, no END).
 */
function redactPemKeys(value: string): string {
  let out = '';
  let pos = 0;
  let search = 0;

  for (;;) {
    const beginAt = value.indexOf(PEM_BEGIN, search);
    if (beginAt < 0) break;

    const labelStart = beginAt + PEM_BEGIN.length;
    const labelEnd = value.indexOf('-----', labelStart);
    if (labelEnd < 0) break;
    const label = value.slice(labelStart, labelEnd);

    if (!label.endsWith(PEM_SUFFIX)) {
      search = labelEnd + '-----'.length;
      continue;
    }

    // Find the next END marker whose label is also a private key.
    let endAt = value.indexOf(PEM_END, labelEnd + '-----'.length);
    let endLabelEnd = -1;
    while (endAt >= 0) {
      endLabelEnd = value.indexOf('-----', endAt + PEM_END.length);
      if (endLabelEnd < 0) break;
      const endLabel = value.slice(endAt + PEM_END.length, endLabelEnd);
      if (endLabel.endsWith(PEM_SUFFIX)) break;
      endAt = value.indexOf(PEM_END, endLabelEnd + '-----'.length);
    }
    // No usable END marker remains, so no later block can match either.
    if (endAt < 0 || endLabelEnd < 0) break;

    out += value.slice(pos, beginAt) + '<redacted PEM>';
    pos = endLabelEnd + '-----'.length;
    search = pos;
  }

  return out + value.slice(pos);
}

/** Redact PEM private keys and Basic/Bearer tokens embedded in a string. */
function redactString(value: string): string {
  return redactPemKeys(value).replace(AUTH_TOKEN, '$1 <redacted>');
}

function redactAuthorization(value: unknown): string {
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  const scheme = text.trim().split(/\s+/)[0];
  return /^[A-Za-z]+$/.test(scheme) ? `${scheme} <redacted>` : '<redacted>';
}

function redactSensitiveKey(key: string, value: unknown): unknown {
  return normalizeKey(key) === 'authorization'
    ? redactAuthorization(value)
    : '<redacted>';
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    return value.map(item => redactValue(item, seen));
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? redactSensitiveKey(key, child)
        : redactValue(child, seen);
    }
    return out;
  }
  return value;
}

/** Return a deep copy with sensitive values replaced. */
export function redactSensitive(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

export function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return redactSensitive(headers) as Record<string, unknown>;
}

/** True when the value contains a key that this module would redact. */
export function containsSensitiveData(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) {
      if (seen.has(node)) return false;
      seen.add(node);
      return node.some(visit);
    }
    if (node !== null && typeof node === 'object') {
      if (seen.has(node)) return false;
      seen.add(node);
      for (const [key, child] of Object.entries(node)) {
        if (isSensitiveKey(key) || visit(child)) return true;
      }
    }
    return false;
  };
  return visit(value);
}

/**
 * Format a value for a verbose log line, redacting it first and truncating
 * large payloads. JSON strings are parsed and pretty-printed so nested
 * fields can be redacted structurally.
 */
export function formatForLog(value: unknown, maxBytes = 4096): string {
  let text: string;

  if (typeof value === 'string') {
    try {
      text = JSON.stringify(redactSensitive(JSON.parse(value)), null, 2);
    } catch {
      text = redactString(value);
    }
  } else {
    try {
      text = JSON.stringify(redactSensitive(value), null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }

  const total = Buffer.byteLength(text);
  if (total <= maxBytes) return text;

  const sliced = Buffer.from(text).subarray(0, maxBytes).toString('utf8');
  return `${sliced}\n… (${total} bytes total)`;
}
