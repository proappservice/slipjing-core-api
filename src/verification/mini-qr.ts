/**
 * Thai bank slip "mini-QR" decoder (CLAUDE.md §7 step 2).
 *
 * Slip mini-QRs are EMVCo-style TLV strings: `TTLLVVV...` where TT = 2-digit
 * tag, LL = 2-digit length, V = value. The verification payload lives under
 * root tag 00 with nested TLV:
 *   00-00: API/service id, 00-01: sending bank code (3 digits),
 *   00-02: transaction reference.
 * Reference: BOT slip-verification QR layout as implemented by the major
 * upstream providers — validate against real slips before go-live.
 */

export interface MiniQrData {
  sendingBank: string;
  transRef: string;
}

export class InvalidQrError extends Error {}

interface TlvField {
  tag: string;
  value: string;
}

export function parseTlv(input: string): TlvField[] {
  const fields: TlvField[] = [];
  let i = 0;
  while (i < input.length) {
    if (i + 4 > input.length) throw new InvalidQrError('Truncated TLV header');
    const tag = input.slice(i, i + 2);
    const len = Number(input.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || Number.isNaN(len)) throw new InvalidQrError('Malformed TLV header');
    const value = input.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new InvalidQrError('TLV value shorter than declared length');
    fields.push({ tag, value });
    i += 4 + len;
  }
  return fields;
}

export function decodeMiniQr(payload: string): MiniQrData {
  const trimmed = payload.trim();
  if (trimmed.length < 8) throw new InvalidQrError('Payload too short to be a slip mini-QR');

  const root = parseTlv(trimmed);
  const envelope = root.find((f) => f.tag === '00');
  if (!envelope) throw new InvalidQrError('Missing root tag 00');

  const inner = parseTlv(envelope.value);
  const bank = inner.find((f) => f.tag === '01')?.value;
  const transRef = inner.find((f) => f.tag === '02')?.value;

  if (!bank || !/^\d{3}$/.test(bank)) throw new InvalidQrError('Missing or malformed sending bank code');
  if (!transRef || transRef.length < 6) throw new InvalidQrError('Missing or malformed transaction reference');

  return { sendingBank: bank, transRef };
}
