import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 32 base62 chars from CSPRNG bytes (rejection-sampled to stay unbiased). */
export function randomBase62(length = 32): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 248) {
        // 248 = 62 * 4 → modulo bias-free
        out += BASE62[byte % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export const hashApiKey = (fullKey: string): string => createHash('sha256').update(fullKey).digest('hex');

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a key `sj_live_<32 base62>` / `sj_test_<32 base62>` (CLAUDE.md §4).
   * The full key is returned exactly once; only the SHA-256 hash is stored.
   */
  async create(name: string, mode: 'live' | 'test'): Promise<{ id: string; fullKey: string; keyPrefix: string }> {
    const fullKey = `sj_${mode}_${randomBase62()}`;
    const keyPrefix = fullKey.slice(0, 8);
    const created = await this.prisma.apiKey.create({
      data: {
        id: newId(),
        tenantId: this.prisma.tenantId(),
        name,
        keyPrefix,
        keyHash: hashApiKey(fullKey),
      },
    });
    return { id: created.id, fullKey, keyPrefix };
  }

  async list() {
    return this.prisma.apiKey.findMany({
      where: this.prisma.tenantWhere(),
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
  }

  async revoke(id: string): Promise<void> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, ...this.prisma.tenantWhere(), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw ApiError.notFound('API key not found or already revoked');
  }

  /** Rotate = revoke old + issue new with the same name, atomically enough for Phase 1. */
  async rotate(id: string): Promise<{ id: string; fullKey: string; keyPrefix: string }> {
    const existing = await this.prisma.apiKey.findFirst({ where: { id, ...this.prisma.tenantWhere() } });
    if (!existing) throw ApiError.notFound('API key not found');
    await this.revoke(id);
    const mode = existing.keyPrefix.startsWith('sj_test') ? 'test' : 'live';
    return this.create(existing.name, mode);
  }
}
