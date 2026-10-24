// Redaction helper for log output. Never throws: hostile values degrade to markers.

const REDACTED = '[REDACTED]';
const REDACTED_PAN = '[REDACTED_PAN]';
const TRUNCATED = '[TRUNCATED]';
const CIRCULAR = '[CIRCULAR]';
const UNREADABLE = '[UNREADABLE]';
const MAX_DEPTH = 10;

const SENSITIVE_KEYS = new Set([
  'authorization', 'cookie', 'set-cookie', 'password', 'client_secret', 'clientsecret',
  'token', 'access_token', 'refresh_token', 'id_token', 'secret', 'api_key', 'apikey',
]);

// 13 to 19 digits, optionally separated by single spaces or dashes.
const PAN_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

export type LogLevel = 'info' | 'warn' | 'error';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('token');
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function redactString(value: string): string {
  if (/^bearer /i.test(value)) return REDACTED;
  return value.replace(PAN_CANDIDATE, match => (
    luhnValid(match.replace(/[ -]/g, '')) ? REDACTED_PAN : match
  ));
}

// Runs one read/copy step; a throwing getter or proxy trap becomes a marker instead of an exception.
function safeEntry(step: () => unknown): unknown {
  try {
    return step();
  } catch {
    return UNREADABLE;
  }
}

function walk(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.has(value)) return CIRCULAR;

  return safeEntry(() => {
    if (value instanceof Error) return redactString(`${value.name}: ${value.message}`);
    if (value instanceof Date) return value.toISOString();

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item, index) => safeEntry(() => walk(value[index], depth + 1, ancestors)));
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const entry = isSensitiveKey(key)
          ? REDACTED
          : safeEntry(() => walk((value as Record<string, unknown>)[key], depth + 1, ancestors));
        // defineProperty keeps keys such as "__proto__" as plain data.
        Object.defineProperty(out, key, { value: entry, enumerable: true, writable: true, configurable: true });
      }
      return out;
    } finally {
      ancestors.delete(value);
    }
  });
}

/**
 * Returns a redacted deep copy of `value`. The input is never mutated.
 * Sensitive keys become '[REDACTED]', bearer strings are masked, Luhn-valid card
 * numbers become '[REDACTED_PAN]', cycles become '[CIRCULAR]', and nesting past
 * depth 10 becomes '[TRUNCATED]'.
 */
export function redact(value: unknown): unknown {
  return walk(value, 0, new Set<object>());
}

/**
 * Writes one redacted JSON line: `{ ...fields, time, level, message }`.
 * Base keys win over field names. Error level goes to console.error.
 */
export function logEvent(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const redactedFields = redact(fields) as Record<string, unknown>;
  const line = JSON.stringify({
    ...redactedFields,
    time: new Date().toISOString(),
    level,
    message: String(redact(message)),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}
