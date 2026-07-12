import { Body, Controller, Delete, Param, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ShopGuard } from '../auth/shop.guard';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(['live', 'test'])
  mode?: 'live' | 'test';
}

/** Dashboard-facing API key management (behind social-login session + shop). */
@Controller('shops/api-keys')
@UseGuards(ShopGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list() {
    return this.apiKeys.list();
  }

  @Post()
  async create(@Body() dto: CreateApiKeyDto) {
    const { id, fullKey, keyPrefix } = await this.apiKeys.create(dto.name, dto.mode ?? 'live');
    // The ONLY response that ever contains the full key (CLAUDE.md §4).
    return { id, key: fullKey, key_prefix: keyPrefix, warning: 'Store this key now — it will not be shown again.' };
  }

  @Post(':id/rotate')
  async rotate(@Param('id') id: string) {
    const { id: newId, fullKey, keyPrefix } = await this.apiKeys.rotate(id);
    // Same one-time-full-key envelope as create.
    return { id: newId, key: fullKey, key_prefix: keyPrefix, warning: 'Store this key now — it will not be shown again.' };
  }

  @Delete(':id')
  async revoke(@Param('id') id: string) {
    await this.apiKeys.revoke(id);
    return { revoked: true };
  }
}
