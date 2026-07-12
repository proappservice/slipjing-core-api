import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SessionGuard, ShopGuard } from '../auth/shop.guard';
import { TenantsService } from './tenants.service';

class CreateShopDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

class AddBankAccountDto {
  /** 3-digit Thai bank code, e.g. 004 = KBank, 014 = SCB. */
  @Matches(/^\d{3}$/)
  bank_code!: string;

  @Matches(/^\d{6,15}$/)
  account_number!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  account_name_th!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  account_name_en?: string;

  @IsOptional()
  @IsIn(['number', 'name', 'both'])
  verify_mode?: 'number' | 'name' | 'both';
}

type AuthedRequest = Request & { userId: string };

/** Pre-shop routes: only a session is needed (no X-Shop-Id yet). */
@Controller('shops')
export class ShopsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @UseGuards(SessionGuard)
  listMine(@Req() req: AuthedRequest) {
    return this.tenants.listMyShops(req.userId);
  }

  @Post()
  @UseGuards(SessionGuard)
  create(@Req() req: AuthedRequest, @Body() dto: CreateShopDto) {
    return this.tenants.createShop(req.userId, dto.name);
  }
}

/** Shop-scoped routes: ShopGuard sets tenant context from X-Shop-Id. */
@Controller('shops/bank-accounts')
@UseGuards(ShopGuard)
export class BankAccountsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.listBankAccounts();
  }

  @Post()
  add(@Body() dto: AddBankAccountDto) {
    return this.tenants.addBankAccount({
      bankCode: dto.bank_code,
      accountNumber: dto.account_number,
      accountNameTh: dto.account_name_th,
      accountNameEn: dto.account_name_en,
      verifyMode: dto.verify_mode,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.tenants.removeBankAccount(id);
    return { removed: true };
  }
}
