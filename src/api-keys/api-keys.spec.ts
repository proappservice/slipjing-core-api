import { hashApiKey, randomBase62 } from './api-keys.service';

describe('randomBase62', () => {
  it('produces the requested length from the base62 alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const key = randomBase62(32);
      expect(key).toHaveLength(32);
      expect(key).toMatch(/^[A-Za-z0-9]{32}$/);
    }
  });

  it('does not repeat across calls', () => {
    const keys = new Set(Array.from({ length: 100 }, () => randomBase62()));
    expect(keys.size).toBe(100);
  });
});

describe('hashApiKey', () => {
  it('is deterministic SHA-256 hex', () => {
    const key = 'sj_live_abcdefghijklmnopqrstuvwxyzABCDEF';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different keys', () => {
    expect(hashApiKey('sj_live_a')).not.toBe(hashApiKey('sj_live_b'));
  });
});
