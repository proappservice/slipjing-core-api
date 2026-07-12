import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { VerificationRequest } from '@prisma/client';
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiError } from '../common/errors';
import { VerificationService } from './verification.service';

class VerifyDto {
  /** Raw mini-QR string. (Multipart image upload lands in a later iteration.) */
  @IsString()
  @IsNotEmpty()
  payload!: string;

  @IsOptional()
  @IsNumber()
  expected_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  expected_receiver?: string;
}

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('verify')
  async verify(@Body() dto: VerifyDto, @Headers('idempotency-key') idempotencyKey?: string) {
    if (!idempotencyKey) throw ApiError.invalidRequest('Idempotency-Key header is required');
    const record = await this.verification.verify({
      payload: dto.payload,
      idempotencyKey,
      expectedAmount: dto.expected_amount,
      expectedReceiver: dto.expected_receiver,
    });
    return this.toResponse(record);
  }

  @Get('verify/:id')
  async getById(@Param('id') id: string) {
    return this.toResponse(await this.verification.getById(id));
  }

  @Get('usage')
  usage(@Query('from') from?: string, @Query('to') to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 3600 * 1000);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw ApiError.invalidRequest('from/to must be ISO dates');
    }
    return this.verification.usage(fromDate, toDate);
  }

  private toResponse(r: VerificationRequest) {
    return {
      id: r.id,
      status: r.status,
      trans_ref: r.transRef,
      sending_bank: r.sendingBank,
      amount: r.amount?.toString() ?? null,
      receiver_account: r.receiverAccountMasked,
      receiver_name: r.receiverName,
      checks: r.checks ?? {},
      duplicate_of: r.duplicateOfId,
      error_code: r.errorCode,
      created_at: r.createdAt.toISOString(),
    };
  }
}
