import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ShopGuard } from '../auth/shop.guard';
import { CreditsService } from './credits.service';

/** Public API (customer's api key). */
@Controller('v1/credits')
@UseGuards(ApiKeyGuard)
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('balance')
  async balance() {
    const balance = await this.credits.balance();
    return { balance: balance.toString() };
  }
}

/** Dashboard (owner session + selected shop). */
@Controller('shops/credits')
@UseGuards(ShopGuard)
export class ShopCreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('balance')
  async balance() {
    const balance = await this.credits.balance();
    return { balance: balance.toString() };
  }
}
