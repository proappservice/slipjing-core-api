import { decodeMiniQr, InvalidQrError, parseTlv } from './mini-qr';

/** Builds a TLV string: tag(2) + len(2) + value. */
const tlv = (tag: string, value: string) => `${tag}${value.length.toString().padStart(2, '0')}${value}`;

describe('parseTlv', () => {
  it('parses sequential tag/length/value fields', () => {
    const input = tlv('00', 'HELLO') + tlv('51', '12345');
    expect(parseTlv(input)).toEqual([
      { tag: '00', value: 'HELLO' },
      { tag: '51', value: '12345' },
    ]);
  });

  it('throws on truncated value', () => {
    expect(() => parseTlv('0009SHORT')).toThrow(InvalidQrError);
  });

  it('throws on malformed header', () => {
    expect(() => parseTlv('zz04abcd')).toThrow(InvalidQrError);
  });
});

describe('decodeMiniQr', () => {
  const validPayload = tlv('00', tlv('00', '01') + tlv('01', '014') + tlv('02', '0141A2K9X4TQ88'));

  it('extracts sending bank and transRef from a valid mini-QR', () => {
    expect(decodeMiniQr(validPayload)).toEqual({ sendingBank: '014', transRef: '0141A2K9X4TQ88' });
  });

  it('rejects an empty/garbage payload with InvalidQrError (no provider call, no charge)', () => {
    expect(() => decodeMiniQr('')).toThrow(InvalidQrError);
    expect(() => decodeMiniQr('not-a-qr')).toThrow(InvalidQrError);
  });

  it('rejects a payload missing the transaction reference', () => {
    const missingRef = tlv('00', tlv('00', '01') + tlv('01', '014'));
    expect(() => decodeMiniQr(missingRef)).toThrow(InvalidQrError);
  });

  it('rejects a non-numeric bank code', () => {
    const badBank = tlv('00', tlv('01', 'ABC') + tlv('02', '0141A2K9X4TQ88'));
    expect(() => decodeMiniQr(badBank)).toThrow(InvalidQrError);
  });
});
