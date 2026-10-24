/**
 * Maximum number of characters of a string input echoed back into an error message.
 */
const MAX_DESCRIBED_STRING_LENGTH = 80;

/**
 * Describes an untrusted input value for use inside an error message, without
 * coercing objects. Template interpolation of an object calls its `toString`/`valueOf`,
 * which may be non-callable and throw, so objects, arrays, functions and symbols
 * are replaced by fixed labels.
 *
 * @param value - Untrusted input value taken from a validated payload.
 * @returns A safe, bounded string representation of the value.
 */
export function describeInput(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_DESCRIBED_STRING_LENGTH);
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[array]';
  switch (typeof value) {
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return String(value);
    case 'symbol':
      return '[symbol]';
    case 'function':
      return '[function]';
    default:
      return '[object]';
  }
}
