import { accountNumberMatches, receiverNameMatches } from './receiver-match';

describe('accountNumberMatches', () => {
  // ค่าจริงจากสลิป KBank → SCB (12 ก.ค. 2026)
  it('matches the real masked SCB value against the registered full number', () => {
    expect(accountNumberMatches('1062346113', 'xxx-x-x4611-x')).toBe(true);
  });

  it('rejects a different account', () => {
    expect(accountNumberMatches('9992346999', 'xxx-x-x4611-x')).toBe(false);
  });

  it('rejects when masked value is missing', () => {
    expect(accountNumberMatches('1062346113', null)).toBe(false);
  });
});

describe('receiverNameMatches', () => {
  // ธนาคารตอบชื่อพร้อมคำนำหน้า + นามสกุลย่อ (ค่าจริงจาก Slip2Go)
  it('matches a titled, surname-truncated bank name against the registered Thai name', () => {
    expect(receiverNameMatches('นาย ภาคภูมิ พ', 'ภาคภูมิ พูลนาผล')).toBe(true);
  });

  it('matches when the registered name also carries a title', () => {
    expect(receiverNameMatches('นาย ภาคภูมิ พ', 'นายภาคภูมิ พูลนาผล')).toBe(true);
  });

  it('matches the English name (Mr. prefix, case-insensitive)', () => {
    expect(receiverNameMatches('MR. PAKPOOM P', 'ภาคภูมิ พูลนาผล', 'Pakpoom Poolnaphol')).toBe(true);
  });

  it('rejects a different person', () => {
    expect(receiverNameMatches('นาย สมชาย ใ', 'ภาคภูมิ พูลนาผล')).toBe(false);
  });

  it('rejects overly short values instead of over-matching', () => {
    expect(receiverNameMatches('นาย', 'ภาคภูมิ พูลนาผล')).toBe(false);
  });
});
