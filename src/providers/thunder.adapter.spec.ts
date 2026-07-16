import { ConfigService } from '@nestjs/config';
import { ThunderAdapter } from './thunder.adapter';

// Response จริงที่จับจาก API เมื่อ 2026-07-16 (สลิป KBank→SCB 125 บาท) — ย่อ field ที่ไม่เกี่ยว
const REAL_SUCCESS = {
  success: true,
  data: {
    amountInSlip: 125,
    rawSlip: {
      payload: '0041000600000101030040220016193084321BOR044495102TH9104C4C0',
      transRef: '016193084321BOR04449',
      date: '2026-07-12T08:43:21+07:00',
      amount: { amount: 125, local: { amount: 125, currency: '764' } },
      sender: {
        bank: { id: '004', name: 'ธนาคารกสิกรไทย', short: 'KBANK' },
        account: { name: { th: 'นาย ภาคภูมิ พ', en: 'MR. PAKPOOM P' }, bank: { type: 'BANKAC', account: 'xxx-x-x2466-x' } },
      },
      receiver: {
        bank: { id: '014', name: 'ธนาคารไทยพาณิชย์', short: 'SCB' },
        account: { name: { th: 'นาย ภาคภูมิ พ', en: 'PAKPOOM P' }, bank: { type: 'BANKAC', account: 'xxx-x-x4611-x' } },
      },
    },
  },
  message: 'Bank slip verified successfully',
};

const adapter = () => new ThunderAdapter({ get: () => undefined } as unknown as ConfigService);

describe('ThunderAdapter.normalize', () => {
  it('maps a real success response to the normalized shape', () => {
    const r = adapter().normalize(REAL_SUCCESS, 'fallback');
    expect(r.verified).toBe(true);
    expect(r.transRef).toBe('016193084321BOR04449');
    expect(r.amount).toBe(125);
    expect(r.sendingBank).toBe('004');
    expect(r.receiver?.bankCode).toBe('014');
    expect(r.receiver?.accountMasked).toBe('xxx-x-x4611-x');
    expect(r.receiver?.name).toBe('นาย ภาคภูมิ พ');
    expect(r.raw).toBe(REAL_SUCCESS);
  });

  it('maps SLIP_NOT_FOUND to a non-verified result with our failure code', () => {
    const r = adapter().normalize({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'not found' } }, 'REF123');
    expect(r.verified).toBe(false);
    expect(r.failureCode).toBe('slip_not_found');
    expect(r.transRef).toBe('REF123');
  });

  it('maps VALIDATION_ERROR to invalid_payload', () => {
    const r = adapter().normalize({ success: false, error: { code: 'VALIDATION_ERROR' } }, 'REF123');
    expect(r.failureCode).toBe('invalid_payload');
  });
});
