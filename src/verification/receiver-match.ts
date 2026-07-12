/**
 * Receiver matching between the bank's (masked) values and the shop's
 * registered bank accounts (§6). Pure functions — unit-tested against
 * real provider output.
 */

/** Compare an expected/full account number against the bank's masked value (x/X = wildcard). */
export function accountNumberMatches(expected: string, masked?: string | null): boolean {
  if (!masked) return false;
  const exp = expected.replace(/[^0-9]/g, '');
  const mask = masked.replace(/[^0-9xX]/g, '');
  if (!exp || !mask || exp.length < mask.length) return false;
  const tail = exp.slice(-mask.length);
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i];
    if (m !== 'x' && m !== 'X' && m !== tail[i]) return false;
  }
  return true;
}

/** Thai/English honorific titles the banks prepend to display names. */
const TITLE_PREFIX = /^(นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|miss|ms\.?|บริษัท|บจก\.?|หจก\.?)/;

const cleanName = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, '').replace(TITLE_PREFIX, '');

/**
 * Banks return display names with a title and often truncate the surname
 * ("นาย ภาคภูมิ พ") — so after stripping titles, match on a prefix
 * relationship in either direction.
 */
export function receiverNameMatches(actual: string | null | undefined, nameTh: string, nameEn?: string | null): boolean {
  if (!actual) return false;
  const a = cleanName(actual);
  if (a.length < 3) return false;
  return [nameTh, nameEn ?? ''].filter(Boolean).some((n) => {
    const c = cleanName(n);
    return c.length >= 3 && (c.startsWith(a) || a.startsWith(c));
  });
}
