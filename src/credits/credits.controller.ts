import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CreditsService } from './credits.service';

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
